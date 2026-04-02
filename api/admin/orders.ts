import { authenticateAdminRequest } from "./_auth.ts";
import { storage } from "../../server/storage.ts";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const auth = await authenticateAdminRequest(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ message: auth.message });
  }

  try {
    const orders = await storage.getAllOrders();
    return res.status(200).json(orders);
  } catch (error) {
    console.error("Standalone admin orders endpoint failed:", error);
    return res.status(500).json({
      message: "Failed to fetch all orders",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
