import fs from "node:fs";
import postgres from "postgres";

const DEFAULT_CUSTOMER_CODE = "10839";
const DEFAULT_BATCH_LIMIT = 1;
const DEFAULT_RETRY_BASE_DELAY_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_MAX_DELAY_MS = 60 * 60 * 1000;
const DEFAULT_SPACING_MS = 22 * 1000;
const DEFAULT_CLAIM_LOCK_MS = 15 * 60 * 1000;
const DEFAULT_ORDER_DATE_TIME_ZONE = "Africa/Dar_es_Salaam";

function parseEnvFile(filePath) {
  const env = {};

  if (!filePath || !fs.existsSync(filePath)) {
    return env;
  }

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (trimmed.startsWith("export ")) {
      trimmed = trimmed.slice("export ".length).trim();
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    let value = match[2].trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[match[1]] = value;
  }

  return env;
}

function applyEnvFile() {
  const envFileArg = process.argv.find((arg) => arg.startsWith("--env-file="));
  const envFile = envFileArg?.split("=").slice(1).join("=") || process.env.ECOUNT_ENV_FILE;
  const parsedEnv = parseEnvFile(envFile);

  for (const [key, value] of Object.entries(parsedEnv)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function requireEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeIoDateMode(value) {
  return String(value || "blank").trim().toLowerCase() === "order-date" ? "order-date" : "blank";
}

function formatEcountDate(dateLike = new Date(), timeZone = DEFAULT_ORDER_DATE_TIME_ZONE) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;

  const buildDate = (zone) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(safeDate);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}${values.month}${values.day}`;
  };

  let formatted;
  try {
    formatted = buildDate(timeZone);
  } catch {
    formatted = buildDate("UTC");
  }

  if (!/^\d{8}$/.test(formatted)) {
    throw new Error(`Unable to format eCount date as YYYYMMDD: ${formatted}`);
  }

  return formatted;
}

function getSaleOrderIoDates(order, config) {
  const orderDate = formatEcountDate(order.created_at || new Date(), config.orderDateTimeZone);

  if (config.ioDateMode === "order-date") {
    return {
      payloadIoDate: orderDate,
      recordedIoDate: orderDate,
    };
  }

  return {
    payloadIoDate: "",
    recordedIoDate: formatEcountDate(new Date(), config.orderDateTimeZone),
  };
}

function normalizeProductCode(code) {
  if (!code) {
    return "";
  }

  const normalized = code
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  return normalized.replace(/^0+(?=\d)/, "");
}

function getProductCodeLookupCandidates(code) {
  if (!code) {
    return [];
  }

  const raw = code.toString().trim();
  if (!raw) {
    return [];
  }

  const uppercase = raw.toUpperCase();
  const noWhitespace = uppercase.replace(/\s+/g, "");
  const noHyphenOrWhitespace = uppercase.replace(/[-\s]/g, "");
  const normalized = normalizeProductCode(uppercase);

  return Array.from(new Set([
    raw,
    uppercase,
    noWhitespace,
    noHyphenOrWhitespace,
    normalized,
  ].filter(Boolean)));
}

function getSaleOrderUploadSerial(order) {
  const seed = `${order.id}:${order.order_number}`;
  let hash = 0;

  for (let index = 0; index < seed.length; index++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(index);
    hash |= 0;
  }

  return String((Math.abs(hash) % 9999) + 1).padStart(4, "0");
}

async function postJson(url, body, headers = {}) {
  const started = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    // Keep json null and surface a preview in the caller.
  }

  return {
    response,
    json,
    text,
    ms: Date.now() - started,
  };
}

async function loginToEcount(config) {
  const zoneResult = await postJson("https://oapi.ecount.com/OAPI/V2/Zone", {
    COM_CODE: config.companyCode,
  });
  const zone = zoneResult.json?.Data?.ZONE || zoneResult.json?.Data?.Zone || config.zone;

  if (!zoneResult.response.ok || String(zoneResult.json?.Status) !== "200") {
    throw new Error(`Zone API failed (${zoneResult.response.status}): ${zoneResult.json?.Error?.Message || zoneResult.text.slice(0, 200)}`);
  }

  const loginResult = await postJson(`https://oapi${zone}.ecount.com/OAPI/V2/OAPILogin`, {
    COM_CODE: config.companyCode,
    USER_ID: config.userId,
    API_CERT_KEY: config.authKey,
    LAN_TYPE: "en-US",
    ZONE: zone,
  });
  const loginData = loginResult.json?.Data || {};
  const datas = loginData.Datas || {};
  const sessionId = datas.SESSION_ID || loginData.SESSION_ID;

  if (!loginResult.response.ok || String(loginResult.json?.Status) !== "200" || !sessionId) {
    const code = loginData.Code ? ` (Code ${loginData.Code})` : "";
    const message =
      loginData.Message ||
      loginResult.json?.Error?.Message ||
      loginResult.json?.Errors?.[0]?.Message ||
      loginResult.text.slice(0, 200);
    throw new Error(`Login failed${code}: ${message}`);
  }

  const sessionGuid = datas.session_guid || loginData.session_guid;
  const setCookie = datas.SET_COOKIE;
  let cookie = "";
  if (setCookie && sessionGuid) {
    cookie = `ECOUNT_SessionId=${sessionGuid}=${setCookie}; SVID=Login-L${zone}05_4bc5c`;
  } else if (setCookie) {
    cookie = `ECOUNT_SessionId=${setCookie}; SVID=Login-L${zone}05_4bc5c`;
  } else {
    cookie = `ECOUNT_SessionId=${sessionId}; SVID=Login-L${zone}05_4bc5c`;
  }

  return { zone, sessionId, cookie };
}

async function ensureOrderRetryColumns(sql) {
  await sql`
    ALTER TABLE public.orders
      ADD COLUMN IF NOT EXISTS erp_sync_attempts integer,
      ADD COLUMN IF NOT EXISTS erp_last_sync_attempt_at timestamp,
      ADD COLUMN IF NOT EXISTS erp_next_sync_attempt_at timestamp
  `;

  await sql`
    UPDATE public.orders
    SET erp_sync_attempts = COALESCE(erp_sync_attempts, 0)
  `;

  await sql`
    ALTER TABLE public.orders
      ALTER COLUMN erp_sync_attempts SET DEFAULT 0,
      ALTER COLUMN erp_sync_attempts SET NOT NULL
  `;
}

async function loadProductMappings(sql) {
  const rows = await sql`
    SELECT normalized_code, original_code, name, price, uom, category
    FROM public.product_mappings
  `;
  const mappings = new Map();

  for (const row of rows) {
    const entry = {
      normalizedCode: row.normalized_code,
      originalCode: row.original_code,
      name: row.name,
      price: Number.parseFloat(String(row.price ?? "0")) || 0,
      uom: row.uom || "",
      category: row.category || "",
    };

    for (const candidate of getProductCodeLookupCandidates(row.original_code)) {
      mappings.set(candidate, entry);
    }
    for (const candidate of getProductCodeLookupCandidates(row.normalized_code)) {
      mappings.set(candidate, entry);
    }
  }

  return mappings;
}

function getMappedProduct(mappings, productCode) {
  for (const candidate of getProductCodeLookupCandidates(productCode)) {
    const mapping = mappings.get(candidate);
    if (mapping) {
      return mapping;
    }
  }

  return null;
}

function parseOrderItems(order) {
  const parsed = typeof order.items === "string" ? JSON.parse(order.items) : order.items;
  if (!Array.isArray(parsed)) {
    throw new Error(`Order ${order.order_number} has invalid items payload`);
  }

  return parsed;
}

function buildSaleOrderPayload(order, mappings, config) {
  const items = parseOrderItems(order);
  const unmapped = [];
  const mappedItems = [];
  const ioDates = getSaleOrderIoDates(order, config);
  const uploadSerial = getSaleOrderUploadSerial(order);
  const customerCode = config.customerCode;
  const customerName = "Online Store Sales";
  const receiverName = order.customer_name || order.customer_company || customerName;

  for (const item of items) {
    const mapping = getMappedProduct(mappings, item.productId);

    if (!mapping) {
      unmapped.push(item.productId);
      continue;
    }

    const quantity = Number.parseInt(String(item.quantity ?? "0"), 10);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Order ${order.order_number} has invalid quantity for ${item.productId}`);
    }

    mappedItems.push({
      productId: item.productId,
      productName: mapping.name,
      quantity,
      price: mapping.price,
    });
  }

  if (unmapped.length > 0) {
    throw new Error(`Cannot submit order: ${unmapped.length} products lack eCount mapping. Unmapped: ${unmapped.slice(0, 3).join(", ")}${unmapped.length > 3 ? "..." : ""}`);
  }

  return {
    ioDate: ioDates.recordedIoDate,
    submittedIoDate: ioDates.payloadIoDate,
    ioDateMode: config.ioDateMode,
    itemCount: mappedItems.length,
    totalValue: mappedItems.reduce((sum, item) => sum + (item.quantity * item.price), 0),
    payload: {
      SaleOrderList: mappedItems.map((item) => ({
        BulkDatas: {
          IO_DATE: ioDates.payloadIoDate,
          UPLOAD_SER_NO: uploadSerial,
          CUST: customerCode,
          CUST_DES: customerName,
          EMP_CD: "",
          WH_CD: config.warehouseCode,
          IO_TYPE: "",
          EXCHANGE_TYPE: "",
          EXCHANGE_RATE: "",
          PJT_CD: "",
          DOC_NO: "",
          TTL_CTT: "",
          REF_DES: `WEB-${order.order_number}`,
          COLL_TERM: "",
          AGREE_TERM: "",
          TIME_DATE: "",
          REMARKS_WIN: `Online order ${order.order_number} - ${receiverName}`,
          U_MEMO1: "",
          U_MEMO2: "",
          U_MEMO3: "",
          U_MEMO4: "",
          U_MEMO5: "",
          ADD_TXT_01_T: "",
          ADD_TXT_02_T: "",
          ADD_TXT_03_T: "",
          ADD_TXT_04_T: "",
          ADD_TXT_05_T: "",
          ADD_TXT_06_T: "",
          ADD_TXT_07_T: "",
          ADD_TXT_08_T: "",
          ADD_TXT_09_T: "",
          ADD_TXT_10_T: "",
          ADD_NUM_01_T: "",
          ADD_NUM_02_T: "",
          ADD_NUM_03_T: "",
          ADD_NUM_04_T: "",
          ADD_NUM_05_T: "",
          ADD_CD_01_T: "",
          ADD_CD_02_T: "",
          ADD_CD_03_T: "",
          ADD_DATE_01_T: "",
          ADD_DATE_02_T: "",
          ADD_DATE_03_T: "",
          U_TXT1: "",
          ADD_LTXT_01_T: "",
          ADD_LTXT_02_T: "",
          ADD_LTXT_03_T: "",
          PROD_CD: item.productId,
          PROD_DES: item.productName,
          SIZE_DES: "",
          UQTY: "",
          QTY: item.quantity.toString(),
          PRICE: item.price.toString(),
          USER_PRICE_VAT: "",
          SUPPLY_AMT: (item.quantity * item.price).toString(),
          SUPPLY_AMT_F: "",
          VAT_AMT: "",
          ITEM_TIME_DATE: "",
          REMARKS: `Order from Phomas Online Store - ${order.order_number}`,
          ITEM_CD: "",
          P_REMARKS1: "",
          P_REMARKS2: "",
          P_REMARKS3: "",
          ADD_TXT_01: "",
          ADD_TXT_02: "",
          ADD_TXT_03: "",
          ADD_TXT_04: "",
          ADD_TXT_05: "",
          ADD_TXT_06: "",
          REL_DATE: "",
          REL_NO: "",
          P_AMT1: "",
          P_AMT2: "",
          ADD_NUM_01: "",
          ADD_NUM_02: "",
          ADD_NUM_03: "",
          ADD_NUM_04: "",
          ADD_NUM_05: "",
          ADD_CD_01: "",
          ADD_CD_02: "",
          ADD_CD_03: "",
          ADD_CD_NM_01: "",
          ADD_CD_NM_02: "",
          ADD_CD_NM_03: "",
          ADD_CDNM_01: "",
          ADD_CDNM_02: "",
          ADD_CDNM_03: "",
          ADD_DATE_01: "",
          ADD_DATE_02: "",
          ADD_DATE_03: "",
        },
      })),
    },
  };
}

function getRetryDelayMs(attempts, config) {
  const safeAttempts = Math.max(0, attempts - 1);
  return Math.min(config.retryMaxDelayMs, config.retryBaseDelayMs * (2 ** safeAttempts));
}

function getEcountErrorMessage(result) {
  return result?.Error?.Message ||
    result?.Errors?.[0]?.Message ||
    result?.Data?.Message ||
    "Unknown Sales Order API error";
}

function parseResultDetails(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    try {
      return parseResultDetails(JSON.parse(trimmed));
    } catch {
      return [trimmed];
    }
  }

  return [value];
}

function getValidationMessages(result) {
  return parseResultDetails(result?.Data?.ResultDetails).map((detail) => {
    if (typeof detail === "string") {
      return detail;
    }

    const errors = parseResultDetails(detail?.Errors)
      .map((error) => {
        if (typeof error === "string") {
          return error;
        }

        const column = error?.ColCd ? `${error.ColCd}: ` : "";
        return `${column}${error?.Message || JSON.stringify(error)}`;
      })
      .filter(Boolean)
      .join(", ");

    if (detail?.TotalError && errors) {
      return `${detail.TotalError} (${errors})`;
    }

    return detail?.Message || detail?.TotalError || JSON.stringify(detail);
  });
}

async function submitSaleOrder(config, session, order, mappings) {
  const saleOrder = buildSaleOrderPayload(order, mappings, config);
  const result = await postJson(
    `https://oapi${session.zone}.ecount.com/OAPI/V2/SaleOrder/SaveSaleOrder?SESSION_ID=${encodeURIComponent(session.sessionId)}`,
    {
      COM_CODE: config.companyCode,
      SESSION_ID: session.sessionId,
      API_CERT_KEY: config.authKey,
      ...saleOrder.payload,
    },
    session.cookie ? { Cookie: session.cookie } : {}
  );

  if (!result.response.ok || String(result.json?.Status) !== "200") {
    throw new Error(`Sales Order API failed (${result.response.status}/${result.json?.Status || "no-status"}): ${getEcountErrorMessage(result.json) || result.text.slice(0, 200)}`);
  }

  if ((result.json?.Data?.FailCnt || 0) > 0) {
    const messages = getValidationMessages(result.json);
    throw new Error(`eCount validation error (${result.json.Data.FailCnt} items failed): ${messages.join("; ") || "eCount validation failed"}. Sent IO_DATE=${saleOrder.submittedIoDate || "(blank; eCount current date)"}`);
  }

  const docNo =
    result.json?.Data?.SlipNos?.[0] ||
    result.json?.Data?.DOC_NO ||
    result.json?.Data?.Datas?.[0]?.DOC_NO ||
    `PENDING-${order.order_number}`;

  return {
    docNo,
    ioDate: saleOrder.ioDate,
    itemCount: saleOrder.itemCount,
    totalValue: saleOrder.totalValue,
  };
}

async function getDueOrders(sql, limit, orderId = "") {
  if (orderId) {
    return await sql`
      SELECT *
      FROM public.orders
      WHERE id = ${orderId}
        AND COALESCE(erp_sync_status, 'pending') IN ('pending', 'failed')
        AND (erp_next_sync_attempt_at IS NULL OR erp_next_sync_attempt_at <= now())
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
  }

  return await sql`
    SELECT *
    FROM public.orders
    WHERE COALESCE(erp_sync_status, 'pending') IN ('pending', 'failed')
      AND (erp_next_sync_attempt_at IS NULL OR erp_next_sync_attempt_at <= now())
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
}

async function claimOrderForSync(sql, order, config) {
  const attempts = Number(order.erp_sync_attempts || 0) + 1;
  const lockExpiresAt = new Date(Date.now() + config.claimLockMs);

  const rows = await sql`
    UPDATE public.orders
    SET
      erp_sync_status = 'pending',
      erp_sync_attempts = ${attempts},
      erp_last_sync_attempt_at = now(),
      erp_next_sync_attempt_at = ${lockExpiresAt}
    WHERE id = ${order.id}
      AND COALESCE(erp_sync_status, 'pending') IN ('pending', 'failed')
      AND (erp_next_sync_attempt_at IS NULL OR erp_next_sync_attempt_at <= now())
    RETURNING *
  `;

  if (rows.length === 0) {
    return null;
  }

  return {
    order: rows[0],
    attempts,
  };
}

async function markSynced(sql, order, attempts, result) {
  await sql`
    UPDATE public.orders
    SET
      erp_doc_number = ${result.docNo},
      erp_io_date = ${result.ioDate},
      erp_sync_status = 'synced',
      erp_sync_error = NULL,
      erp_sync_attempts = ${attempts},
      erp_last_sync_attempt_at = now(),
      erp_next_sync_attempt_at = NULL
    WHERE id = ${order.id}
  `;
}

async function markFailed(sql, order, attempts, error, config) {
  const nextDelayMs = getRetryDelayMs(attempts, config);
  const nextAttemptAt = new Date(Date.now() + nextDelayMs);

  await sql`
    UPDATE public.orders
    SET
      erp_sync_status = 'failed',
      erp_sync_error = ${error instanceof Error ? error.message : String(error)},
      erp_sync_attempts = ${attempts},
      erp_last_sync_attempt_at = now(),
      erp_next_sync_attempt_at = ${nextAttemptAt}
    WHERE id = ${order.id}
  `;

  return nextAttemptAt;
}

async function main() {
  applyEnvFile();

  const config = {
    companyCode: requireEnv("ECOUNT_COMPANY_CODE"),
    authKey: requireEnv("ECOUNT_AUTH_KEY"),
    userId: requireEnv("ECOUNT_USER_ID"),
    zone: requireEnv("ECOUNT_ZONE"),
    warehouseCode: requireEnv("ECOUNT_WAREHOUSE_CODE"),
    customerCode: process.env.ECOUNT_CUSTOMER_CODE || DEFAULT_CUSTOMER_CODE,
    databaseUrl: requireEnv("DATABASE_URL"),
    limit: parsePositiveInt(process.env.ECOUNT_ORDER_SYNC_LIMIT, DEFAULT_BATCH_LIMIT),
    orderId: String(process.env.ECOUNT_ORDER_SYNC_ORDER_ID || "").trim(),
    spacingMs: parsePositiveInt(process.env.ECOUNT_ORDER_SYNC_SPACING_MS, DEFAULT_SPACING_MS),
    claimLockMs: parsePositiveInt(process.env.ECOUNT_ORDER_SYNC_CLAIM_LOCK_MS, DEFAULT_CLAIM_LOCK_MS),
    retryBaseDelayMs: parsePositiveInt(process.env.ORDER_SYNC_RETRY_BASE_DELAY_MS, DEFAULT_RETRY_BASE_DELAY_MS),
    retryMaxDelayMs: parsePositiveInt(process.env.ORDER_SYNC_RETRY_MAX_DELAY_MS, DEFAULT_RETRY_MAX_DELAY_MS),
    orderDateTimeZone: process.env.ECOUNT_ORDER_DATE_TIMEZONE || DEFAULT_ORDER_DATE_TIME_ZONE,
    ioDateMode: normalizeIoDateMode(process.env.ECOUNT_ORDER_IO_DATE_MODE),
  };

  const sql = postgres(config.databaseUrl, { prepare: false });
  const summary = {
    ok: true,
    syncedAt: new Date().toISOString(),
    checked: 0,
    synced: 0,
    failed: 0,
    skipped: 0,
    results: [],
  };

  try {
    await ensureOrderRetryColumns(sql);

    const [mappings, orders] = await Promise.all([
      loadProductMappings(sql),
      getDueOrders(sql, config.limit, config.orderId),
    ]);

    summary.checked = orders.length;

    if (orders.length === 0) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    if (mappings.size === 0) {
      throw new Error("No product mappings found in product_mappings table. Upload the product mapping Excel before syncing orders.");
    }

    const session = await loginToEcount(config);

    for (let index = 0; index < orders.length; index++) {
      const order = orders[index];
      const claim = await claimOrderForSync(sql, order, config);

      if (!claim) {
        summary.skipped++;
        summary.results.push({
          orderId: order.id,
          orderNumber: order.order_number,
          status: "skipped",
          message: "Order was already claimed by another worker",
        });
        continue;
      }

      try {
        const result = await submitSaleOrder(config, session, claim.order, mappings);
        await markSynced(sql, claim.order, claim.attempts, result);
        summary.synced++;
        summary.results.push({
          orderId: claim.order.id,
          orderNumber: claim.order.order_number,
          status: "synced",
          erpDocNumber: result.docNo,
          itemCount: result.itemCount,
          totalValue: result.totalValue,
        });
      } catch (error) {
        const nextAttemptAt = await markFailed(sql, claim.order, claim.attempts, error, config);
        summary.failed++;
        summary.results.push({
          orderId: claim.order.id,
          orderNumber: claim.order.order_number,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          nextAttemptAt: nextAttemptAt.toISOString(),
        });
      }

      if (index < orders.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, config.spacingMs));
      }
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    syncedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
