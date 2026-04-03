import { authenticateAdminRequest } from "./_auth.ts";
import { ecountApi } from "../../server/ecountApi.ts";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const auth = await authenticateAdminRequest(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ message: auth.message });
    }

    return res.status(200).json({
      success: true,
      data: ecountApi.getCacheStatus(),
    });
  } catch (error) {
    console.error("Standalone cache-status endpoint failed:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get cache status",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
