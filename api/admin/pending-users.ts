import { authenticateAdminRequest } from "./_auth.ts";
import { ADMIN_EMAIL, hasSupabaseAdminConfig, listUsers } from "./_shared.ts";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const auth = await authenticateAdminRequest(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ message: auth.message });
  }

  if (!hasSupabaseAdminConfig()) {
    return res.status(503).json({ message: "Supabase admin API is not configured on the server" });
  }

  try {
    const result = await listUsers();
    if (!result.ok) {
      return res.status(result.status || 500).json({ message: result.error || "Failed to fetch users from Supabase" });
    }

    const users = Array.isArray(result.data?.users) ? result.data.users : [];
    const pendingUsers = users
      .filter((user: any) => {
        const metadata = user.user_metadata || {};
        return metadata.approved !== true && user.email !== ADMIN_EMAIL;
      })
      .map((user: any) => {
        const metadata = user.user_metadata || {};
        return {
          id: user.id,
          email: user.email || "",
          companyName: metadata.name || metadata.company_name || "Unknown Company",
          phone: metadata.phone || "",
          address: metadata.address || "",
          userType: metadata.user_type || "individual",
          brelaNumber: metadata.brela_number || "",
          tinNumber: metadata.tin_number || "",
          createdAt: user.created_at ? new Date(user.created_at) : new Date(),
        };
      });

    pendingUsers.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return res.status(200).json(pendingUsers);
  } catch (error) {
    console.error("Standalone pending users endpoint failed:", error);
    return res.status(500).json({
      message: "Failed to fetch pending users",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
