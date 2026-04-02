import { ecountApi } from "../server/ecountApi.ts";

export default async function handler(_req: any, res: any) {
  try {
    const products = await ecountApi.getAllProductsFromEcount();
    return res.status(200).json(products);
  } catch (error) {
    console.error("Standalone products endpoint failed:", error);
    return res.status(500).json({
      message: "Failed to fetch products from eCount ERP",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
