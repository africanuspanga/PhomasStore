import { authenticateAdminRequest } from "./_auth.ts";
import { listUsers, parseJsonBody, updateUserById } from "./_shared.ts";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const auth = await authenticateAdminRequest(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ message: auth.message });
    }

    const body = parseJsonBody(req);
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const usersResult = await listUsers();
    if (!usersResult.ok) {
      console.error("Approve user list lookup failed:", usersResult.error);
      return res.status(usersResult.status).json({
        message: usersResult.error || "Failed to fetch users from Supabase",
      });
    }

    const users = Array.isArray(usersResult.data?.users) ? usersResult.data.users : [];
    const currentUser = users.find((user: any) => user.id === userId);

    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const updatedMetadata = {
      ...(currentUser.user_metadata || {}),
      approved: true,
    };

    const updateResult = await updateUserById(userId, {
      user_metadata: updatedMetadata,
    });

    if (!updateResult.ok) {
      console.error("Approve user update failed:", updateResult.error);
      return res.status(updateResult.status).json({
        message: updateResult.error || "Failed to approve user",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User approved successfully",
      user: updateResult.data?.user || null,
    });
  } catch (error) {
    console.error("Approve user invocation failed:", error);
    return res.status(500).json({
      message: "Failed to approve user",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
