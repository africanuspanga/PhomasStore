import { authenticateAdminRequest } from "../_auth.ts";
import { ProductMapping } from "../../../server/productMapping.ts";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const auth = await authenticateAdminRequest(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ message: auth.message });
    }

    await ProductMapping.ensureLoaded();

    return res.status(200).json({
      success: true,
      data: ProductMapping.getStats(),
    });
  } catch (error) {
    console.error("Standalone product-mapping status endpoint failed:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get product mapping status",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
