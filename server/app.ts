import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { registerRoutes } from "./routes.js";
import { log } from "./logger.js";

let cachedVercelAppPromise: Promise<Express> | null = null;

function applyCommonMiddleware(app: Express) {
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }

        if (logLine.length > 80) {
          logLine = logLine.slice(0, 79) + "…";
        }

        log(logLine);
      }
    });

    next();
  });
}

function applyErrorHandler(app: Express) {
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    log(`Unhandled error: ${message}`, "express");
  });
}

export async function createServerApp() {
  const app = express();
  applyCommonMiddleware(app);

  const server = await registerRoutes(app);
  applyErrorHandler(app);

  if (app.get("env") === "development") {
    const { setupVite } = await import("./vite.js");
    await setupVite(app, server);
  } else {
    const { serveStatic } = await import("./vite.js");
    serveStatic(app);
  }

  return { app, server };
}

export function getVercelApp() {
  if (!cachedVercelAppPromise) {
    cachedVercelAppPromise = (async () => {
      const app = express();
      applyCommonMiddleware(app);
      await registerRoutes(app);
      applyErrorHandler(app);
      return app;
    })();
  }

  return cachedVercelAppPromise;
}
