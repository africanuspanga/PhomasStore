const ECOUNT_COMPANY_CODE = process.env.ECOUNT_COMPANY_CODE;
const ECOUNT_AUTH_KEY = process.env.ECOUNT_AUTH_KEY;
const ECOUNT_USER_ID = process.env.ECOUNT_USER_ID;
const ECOUNT_ZONE = process.env.ECOUNT_ZONE || "IA";
const ECOUNT_WAREHOUSE_CODE = process.env.ECOUNT_WAREHOUSE_CODE || "00001";
const ECOUNT_CUSTOMER_CODE = process.env.ECOUNT_CUSTOMER_CODE || "10839";

function generateProductName(productCode: string): string {
  if (productCode.startsWith("LYOFIA")) return `LYOFIA Medical Test Kit - ${productCode}`;
  if (productCode.startsWith("ABS")) return `ABS Medical Component - ${productCode}`;
  if (productCode.startsWith("HS-")) return `Medical Instrument - ${productCode}`;
  if (productCode.startsWith("PDL-")) return `PDL Medical Supply - ${productCode}`;
  if (/^\d+$/.test(productCode)) return `Medical Product ${productCode}`;
  return `Medical Supply - ${productCode}`;
}

function getCategoryFromCode(productCode: string): string {
  if (productCode.startsWith("LYOFIA")) return "Laboratory Tests";
  if (productCode.startsWith("ABS")) return "Medical Components";
  if (productCode.startsWith("HS-")) return "Medical Instruments";
  if (productCode.startsWith("PDL-")) return "Medical Supplies";
  if (/^\d+$/.test(productCode)) return "General Medical";
  return "Medical Supplies";
}

async function getZone(): Promise<string> {
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

async function loginToEcount(zone: string) {
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
  const requestUrl = `https://oapi${zone}.ecount.com/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus?SESSION_ID=${encodeURIComponent(session.sessionId)}`;

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

function transformProducts(products: any[]) {
  return products.map((product) => {
    const productCode = product.PROD_CD || product.ITEM_CODE || product.ITEM_CD || "";
    const quantity = parseInt(product.BAL_QTY || "0", 10) || 0;

    return {
      id: productCode,
      name: generateProductName(productCode),
      packaging: "Standard",
      referenceNumber: productCode,
      price: "25000",
      imageUrl: null,
      category: getCategoryFromCode(productCode),
      availableQuantity: quantity,
      isLowStock: quantity < 10,
      isExpiringSoon: false,
      hasRealTimeData: true,
      lastUpdated: new Date().toISOString(),
      description: "",
      specification: "",
    };
  });
}

export default async function handler(_req: any, res: any) {
  try {
    const products = await fetchEcountProducts();
    return res.status(200).json(transformProducts(products));
  } catch (error) {
    console.error("Standalone products TS endpoint failed:", error);
    return res.status(500).json({
      message: "Failed to fetch products",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
