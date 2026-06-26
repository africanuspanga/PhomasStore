import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "0.0.0.0";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_LOG_BYTES = 256 * 1024;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.ECOUNT_ORDER_SYNC_WORKER_HOST || DEFAULT_HOST;
const port = Number.parseInt(process.env.ECOUNT_ORDER_SYNC_WORKER_PORT || String(DEFAULT_PORT), 10);
const workerSecret = process.env.ECOUNT_ORDER_SYNC_WORKER_SECRET || process.env.ORDER_SYNC_WORKER_SECRET;

let activeRun = null;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function appendLimited(current, chunk) {
  const next = current + chunk;
  return next.length > MAX_LOG_BYTES ? next.slice(next.length - MAX_LOG_BYTES) : next;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function getProvidedSecret(req) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }

  const headerSecret = req.headers["x-worker-secret"];
  return Array.isArray(headerSecret) ? headerSecret[0] : headerSecret;
}

async function readJsonBody(req) {
  let raw = "";

  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) {
      throw new Error("Request body is too large");
    }
  }

  if (!raw.trim()) {
    return {};
  }

  return JSON.parse(raw);
}

function parseWorkerSummary(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}\s*$/);
    return match ? JSON.parse(match[0]) : null;
  }
}

function runOrderSync({ limit, orderId }) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      ECOUNT_ORDER_SYNC_LIMIT: String(Math.min(parsePositiveInt(limit, 1), 10)),
    };

    if (orderId) {
      env.ECOUNT_ORDER_SYNC_ORDER_ID = orderId;
    } else {
      delete env.ECOUNT_ORDER_SYNC_ORDER_ID;
    }

    const child = spawn(process.execPath, ["scripts/ecount-order-sync.mjs"], {
      cwd: projectRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk.toString());
    });

    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk.toString());
    });

    child.on("error", reject);
    child.on("close", (code) => {
      let summary = null;

      try {
        summary = parseWorkerSummary(stdout || stderr);
      } catch {
        summary = null;
      }

      if (code !== 0) {
        const error = new Error(summary?.error || stderr.trim() || `Worker exited with code ${code}`);
        error.code = code;
        error.summary = summary;
        error.stderr = stderr;
        error.stdout = stdout;
        reject(error);
        return;
      }

      resolve({ summary, stdout, stderr });
    });
  });
}

if (!workerSecret) {
  console.error("Missing ECOUNT_ORDER_SYNC_WORKER_SECRET. Refusing to start order sync worker HTTP server.");
  process.exit(1);
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && requestUrl.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "ecount-order-sync-worker",
      busy: Boolean(activeRun),
    });
    return;
  }

  if (requestUrl.pathname !== "/sync") {
    sendJson(res, 404, { ok: false, message: "Not found" });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }

  if (getProvidedSecret(req) !== workerSecret) {
    sendJson(res, 401, { ok: false, message: "Invalid worker secret" });
    return;
  }

  if (activeRun) {
    sendJson(res, 409, {
      ok: false,
      message: "Order sync worker is already running",
    });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const limit = Math.min(parsePositiveInt(body.limit, 1), 10);
    const orderId = String(body.orderId || "").trim();

    activeRun = runOrderSync({ limit, orderId });
    const result = await activeRun;
    const summary = result.summary || {
      ok: true,
      checked: 0,
      synced: 0,
      failed: 0,
      skipped: 0,
      results: [],
    };

    sendJson(res, 200, {
      ok: true,
      message: `Order sync worker processed: ${summary.synced || 0} synced, ${summary.failed || 0} failed, ${summary.skipped || 0} skipped`,
      data: summary,
    });
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      message: "Order sync worker failed",
      error: error instanceof Error ? error.message : String(error),
      data: error?.summary || null,
      stderr: error?.stderr ? String(error.stderr).slice(-1200) : undefined,
    });
  } finally {
    activeRun = null;
  }
});

server.listen(port, host, () => {
  console.log(`eCount order sync worker listening on ${host}:${port}`);
});
