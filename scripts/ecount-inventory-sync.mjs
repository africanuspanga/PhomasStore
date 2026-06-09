import { randomUUID } from "node:crypto";
import fs from "node:fs";
import postgres from "postgres";

const DEFAULT_CUSTOMER_CODE = "10839";

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

function parseRows(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      return parseRows(JSON.parse(value));
    } catch {
      return [];
    }
  }

  if (typeof value === "object") {
    for (const key of ["Datas", "Result", "Rows", "List"]) {
      const rows = parseRows(value[key]);
      if (rows.length > 0) {
        return rows;
      }
    }
    return [value];
  }

  return [];
}

function parseNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "0").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function getProductCode(row) {
  return String(
    row.PROD_CD ||
    row.ITEM_CODE ||
    row.ITEM_CD ||
    row.PROD_CODE ||
    row.ItemCode ||
    row.itemCode ||
    ""
  ).trim();
}

function getWarehouseCode(row) {
  return String(row.WH_CODE || row.WH_CD || row.WAREHOUSE_CODE || row.WAREHOUSE_CD || "").trim();
}

function getQuantity(row) {
  const quantityKeys = [
    "BAL_QTY",
    "BALANCE_QTY",
    "INV_QTY",
    "STOCK_QTY",
    "AVAILABLE_QTY",
    "AVAIL_QTY",
    "available_qty",
    "stock_qty",
    "balance_qty",
    "qty",
    "QTY",
  ];

  for (const key of quantityKeys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return parseNumber(row[key]);
    }
  }

  return 0;
}

function normalizeInventoryRows(rows, warehouseCode) {
  const grouped = new Map();

  for (const row of rows) {
    const productCode = getProductCode(row);
    if (!productCode) {
      continue;
    }

    const rowWarehouseCode = getWarehouseCode(row);
    if (rowWarehouseCode && warehouseCode && rowWarehouseCode !== warehouseCode) {
      continue;
    }

    const existing = grouped.get(productCode);
    const quantity = getQuantity(row);

    if (existing) {
      existing.availableQuantity += quantity;
      existing.sourceRows += 1;
    } else {
      grouped.set(productCode, {
        productCode,
        productName: row.PROD_DES || row.ITEM_NAME || row.ITEM_NM || `eCount Product - ${productCode}`,
        availableQuantity: quantity,
        sourceRows: 1,
      });
    }
  }

  return Array.from(grouped.values());
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

async function fetchInventory(config, session) {
  const baseDate = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const inventoryResult = await postJson(
    `https://oapi${session.zone}.ecount.com/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus?SESSION_ID=${encodeURIComponent(session.sessionId)}`,
    {
      COM_CODE: config.companyCode,
      SESSION_ID: session.sessionId,
      API_CERT_KEY: config.authKey,
      BASE_DATE: baseDate,
      CUST_CODE: config.customerCode,
      WH_CODE: config.warehouseCode,
      ITEM_CODE: "",
      Page: "1",
      PageSize: "1000",
    },
    session.cookie ? { Cookie: session.cookie } : {}
  );

  if (!inventoryResult.response.ok || String(inventoryResult.json?.Status) !== "200") {
    throw new Error(`Inventory API failed (${inventoryResult.response.status}/${inventoryResult.json?.Status || "no-status"}): ${inventoryResult.json?.Error?.Message || inventoryResult.text.slice(0, 200)}`);
  }

  return normalizeInventoryRows(parseRows(inventoryResult.json?.Data), config.warehouseCode);
}

async function ensureTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id varchar PRIMARY KEY,
      name text NOT NULL,
      packaging text NOT NULL,
      reference_number text NOT NULL UNIQUE,
      price numeric(10, 2) NOT NULL,
      image_url text,
      category text
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS inventory (
      id varchar PRIMARY KEY,
      product_id varchar NOT NULL REFERENCES products(id),
      available_quantity integer NOT NULL,
      expiration_date timestamp
    )
  `;
}

async function persistInventory(config, inventoryRows) {
  const sql = postgres(config.databaseUrl, { prepare: false });

  try {
    await ensureTables(sql);

    await sql.begin(async (transaction) => {
      await transaction`DELETE FROM inventory`;

      for (const item of inventoryRows) {
        await transaction`
          INSERT INTO products (id, name, packaging, reference_number, price, image_url, category)
          VALUES (${item.productCode}, ${item.productName}, 'Standard', ${item.productCode}, 0, NULL, 'Medical Supplies')
          ON CONFLICT (id) DO NOTHING
        `;
        await transaction`
          INSERT INTO inventory (id, product_id, available_quantity, expiration_date)
          VALUES (${randomUUID()}, ${item.productCode}, ${Math.max(0, Math.floor(item.availableQuantity))}, NULL)
        `;
      }
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
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
  };

  const session = await loginToEcount(config);
  const inventoryRows = await fetchInventory(config, session);
  await persistInventory(config, inventoryRows);

  const inStockCount = inventoryRows.filter((item) => item.availableQuantity > 0).length;
  const totalQuantity = inventoryRows.reduce((sum, item) => sum + item.availableQuantity, 0);

  console.log(JSON.stringify({
    ok: true,
    syncedAt: new Date().toISOString(),
    productCount: inventoryRows.length,
    inStockProductCount: inStockCount,
    totalAvailableQuantity: totalQuantity,
    sample: inventoryRows.slice(0, 8),
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    syncedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
