import fs from "fs";
import path from "path";
import * as XLSX from "xlsx/xlsx.mjs";

const ECOUNT_COMPANY_CODE = process.env.ECOUNT_COMPANY_CODE;
const ECOUNT_AUTH_KEY = process.env.ECOUNT_AUTH_KEY;
const ECOUNT_USER_ID = process.env.ECOUNT_USER_ID;
const ECOUNT_ZONE = process.env.ECOUNT_ZONE || "IA";
const ECOUNT_WAREHOUSE_CODE = process.env.ECOUNT_WAREHOUSE_CODE || "00001";
const ECOUNT_CUSTOMER_CODE = process.env.ECOUNT_CUSTOMER_CODE || "10839";

let excelCache = null;

function normalizeProductCode(code) {
  return (code || "")
    .toString()
    .trim()
    .replace(/[-\s]/g, "")
    .replace(/^0+/, "")
    .toUpperCase();
}

function generateProductName(productCode) {
  if (productCode.startsWith("LYOFIA")) return `LYOFIA Medical Test Kit - ${productCode}`;
  if (productCode.startsWith("ABS")) return `ABS Medical Component - ${productCode}`;
  if (productCode.startsWith("HS-")) return `Medical Instrument - ${productCode}`;
  if (productCode.startsWith("PDL-")) return `PDL Medical Supply - ${productCode}`;
  if (/^\d+$/.test(productCode)) return `Medical Product ${productCode}`;
  return `Medical Supply - ${productCode}`;
}

function getCategoryFromCode(productCode) {
  if (productCode.startsWith("LYOFIA")) return "Laboratory Tests";
  if (productCode.startsWith("ABS")) return "Medical Components";
  if (productCode.startsWith("HS-")) return "Medical Instruments";
  if (productCode.startsWith("PDL-")) return "Medical Supplies";
  if (/^\d+$/.test(productCode)) return "General Medical";
  return "Medical Supplies";
}

function resolveExcelPath() {
  const defaultPath = path.join(process.cwd(), "attached_assets", "All Items_1763921800571.xlsx");
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }

  const assetsDir = path.join(process.cwd(), "attached_assets");
  if (!fs.existsSync(assetsDir)) {
    return null;
  }

  const candidates = fs.readdirSync(assetsDir)
    .filter((name) => /\.(xlsx|xls|csv)$/i.test(name))
    .map((name) => {
      const fullPath = path.join(assetsDir, name);
      const stats = fs.statSync(fullPath);
      return { fullPath, mtimeMs: stats.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0]?.fullPath || null;
}

function loadExcelMap() {
  if (excelCache) {
    return excelCache;
  }

  const excelPath = resolveExcelPath();
  const map = new Map();
  const allProducts = [];

  if (!excelPath || !fs.existsSync(excelPath)) {
    excelCache = { map, allProducts };
    return excelCache;
  }

  try {
    XLSX.set_fs(fs);
    const workbook = XLSX.readFile(excelPath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

    let headerRowIndex = -1;
    let columnMap = null;

    for (let i = 0; i < Math.min(15, rawRows.length); i += 1) {
      const row = rawRows[i] || [];
      const rowText = row.map((cell) => cell?.toString()?.toLowerCase()?.trim() || "");
      const codeCol = rowText.findIndex((cell) =>
        (cell.includes("item") && cell.includes("code")) ||
        (cell.includes("product") && cell.includes("code")) ||
        cell === "itemcode" ||
        cell === "prod_cd" ||
        cell === "code");
      const nameCol = rowText.findIndex((cell) =>
        (cell.includes("item") && cell.includes("name")) ||
        (cell.includes("product") && cell.includes("name")) ||
        cell === "itemname" ||
        cell === "name");

      if (codeCol >= 0 && nameCol >= 0) {
        headerRowIndex = i;
        columnMap = {
          code: codeCol,
          name: nameCol,
          uom: (() => {
            const idx = rowText.findIndex((cell) => cell === "uom" || cell === "unit");
            return idx === -1 ? nameCol + 1 : idx;
          })(),
          price: (() => {
            const idx = rowText.findIndex((cell) =>
              cell.includes("price") ||
              cell.includes("sales") ||
              cell.includes("amount") ||
              cell.includes("rate"));
            return idx === -1 ? nameCol + 2 : idx;
          })(),
        };
        break;
      }
    }

    if (!columnMap || headerRowIndex === -1) {
      excelCache = { map, allProducts };
      return excelCache;
    }

    for (let i = headerRowIndex + 1; i < rawRows.length; i += 1) {
      const row = rawRows[i] || [];
      const originalCode = row[columnMap.code]?.toString()?.trim();
      const name = row[columnMap.name]?.toString()?.trim();

      if (!originalCode || !name) {
        continue;
      }

      const priceValue = row[columnMap.price];
      const numericPrice = typeof priceValue === "number"
        ? priceValue
        : parseFloat(priceValue?.toString()?.replace(/[^0-9.-]/g, "") || "0");
      const product = {
        originalCode,
        name,
        uom: row[columnMap.uom]?.toString()?.trim() || "Standard",
        price: Number.isFinite(numericPrice) && numericPrice > 0 ? numericPrice : 25000,
        category: getCategoryFromCode(originalCode),
      };

      map.set(normalizeProductCode(originalCode), product);
      allProducts.push(product);
    }
  } catch (error) {
    console.error("Failed to read Excel mapping in products-read:", error);
  }

  excelCache = { map, allProducts };
  return excelCache;
}

async function getZone() {
  if (ECOUNT_ZONE) {
    return ECOUNT_ZONE;
  }

  try {
    const response = await fetch("https://oapi.ecount.com/OAPI/V2/Zone", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ COM_CODE: ECOUNT_COMPANY_CODE }),
    });
    const result = await response.json().catch(() => null);
    return result?.Data?.ZONE || result?.Data?.Zone || "IA";
  } catch {
    return "IA";
  }
}

async function loginToEcount(zone) {
  const loginUrl = `https://oapi${zone}.ecount.com/OAPI/V2/OAPILogin`;
  const response = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    body: JSON.stringify({
      COM_CODE: ECOUNT_COMPANY_CODE,
      USER_ID: ECOUNT_USER_ID,
      API_CERT_KEY: ECOUNT_AUTH_KEY,
      LAN_TYPE: "en-US",
      ZONE: zone,
    }),
  });

  const result = await response.json().catch(() => null);
  const sessionId = result?.Data?.Datas?.SESSION_ID;
  const sessionGuid = result?.Data?.Datas?.session_guid;
  const setCookie = result?.Data?.Datas?.SET_COOKIE;

  if (!(result?.Status === "200" || result?.Status === 200) || !sessionId) {
    throw new Error(result?.Error?.Message || "eCount login failed");
  }

  let cookies = "";
  if (setCookie && sessionGuid) {
    cookies = `ECOUNT_SessionId=${sessionGuid}=${setCookie}; SVID=Login-L${zone}05_4bc5c`;
  } else if (setCookie) {
    cookies = `ECOUNT_SessionId=${setCookie}; SVID=Login-L${zone}05_4bc5c`;
  } else {
    cookies = `ECOUNT_SessionId=${sessionId}; SVID=Login-L${zone}05_4bc5c`;
  }

  return { zone, sessionId, cookies };
}

async function fetchEcountProducts() {
  if (!ECOUNT_COMPANY_CODE || !ECOUNT_AUTH_KEY || !ECOUNT_USER_ID) {
    throw new Error("eCount environment variables are not configured on the server");
  }

  const zone = await getZone();
  const session = await loginToEcount(zone);
  const endpoint = "/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus";
  const requestUrl = `https://oapi${zone}.ecount.com${endpoint}?SESSION_ID=${encodeURIComponent(session.sessionId)}`;

  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Cookie: session.cookies,
    },
    body: JSON.stringify({
      COM_CODE: ECOUNT_COMPANY_CODE,
      SESSION_ID: session.sessionId,
      API_CERT_KEY: ECOUNT_AUTH_KEY,
      BASE_DATE: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
      CUST_CODE: ECOUNT_CUSTOMER_CODE,
      WH_CODE: ECOUNT_WAREHOUSE_CODE,
      ITEM_CODE: "",
    }),
  });

  const result = await response.json().catch(() => null);
  const products = result?.Data?.Datas || result?.Data?.Result || [];
  if (!(result?.Status === "200" || result?.Status === 200) || !Array.isArray(products)) {
    throw new Error(result?.Error?.Message || "Failed to fetch products from eCount");
  }

  return products;
}

function transformProducts(products, excelMap) {
  return products.map((product) => {
    const productCode = product.PROD_CD || product.ITEM_CODE || product.ITEM_CD || "";
    const quantity = parseInt(product.BAL_QTY || "0", 10) || 0;
    const mapped = excelMap.get(normalizeProductCode(productCode));

    return {
      id: productCode,
      name: mapped?.name || generateProductName(productCode),
      packaging: mapped?.uom || "Standard",
      referenceNumber: productCode,
      price: (mapped?.price || 25000).toString(),
      imageUrl: null,
      category: mapped?.category || getCategoryFromCode(productCode),
      availableQuantity: quantity,
      isLowStock: quantity < 10,
      isExpiringSoon: false,
      hasRealTimeData: true,
      lastUpdated: new Date().toISOString(),
      description: mapped?.name || "",
      specification: mapped?.uom || "",
    };
  });
}

function fallbackProducts(allProducts) {
  return allProducts.map((product) => ({
    id: product.originalCode,
    name: product.name,
    packaging: product.uom || "Standard",
    referenceNumber: product.originalCode,
    price: (product.price || 25000).toString(),
    imageUrl: null,
    category: product.category || "Medical Supplies",
    availableQuantity: 0,
    isLowStock: true,
    isExpiringSoon: false,
    hasRealTimeData: false,
    lastUpdated: new Date().toISOString(),
    description: product.name,
    specification: product.uom || "",
  }));
}

export default async function handler(_req, res) {
  try {
    const { map, allProducts } = loadExcelMap();

    try {
      const products = await fetchEcountProducts();
      return res.status(200).json(transformProducts(products, map));
    } catch (error) {
      console.error("Products-read live eCount fetch failed, using fallback if available:", error);

      if (allProducts.length > 0) {
        return res.status(200).json(fallbackProducts(allProducts));
      }

      throw error;
    }
  } catch (error) {
    console.error("Standalone products JS endpoint failed:", error);
    return res.status(500).json({
      message: "Failed to fetch products",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
