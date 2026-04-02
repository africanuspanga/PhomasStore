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
    const safeUsers = users.map((user: any) => {
      const metadata = user.user_metadata || {};

      return {
        id: user.id,
        email: user.email || "",
        companyName: metadata.name || metadata.company_name || "Unknown Company",
        role: user.email === ADMIN_EMAIL ? "admin" : "client",
        createdAt: user.created_at ? new Date(user.created_at) : new Date(),
        userType: metadata.user_type || "individual",
        phone: metadata.phone || "",
        address: metadata.address || "",
        brelaNumber: metadata.brela_number || "",
        tinNumber: metadata.tin_number || "",
        emailConfirmed: !!user.email_confirmed_at,
        lastSignIn: user.last_sign_in_at ? new Date(user.last_sign_in_at) : null,
      };
    });

    safeUsers.sort((a: any, b: any) => {
      if (a.role === "admin" && b.role !== "admin") return -1;
      if (b.role === "admin" && a.role !== "admin") return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return res.status(200).json(safeUsers);
  } catch (error) {
    console.error("Standalone admin users endpoint failed:", error);
    return res.status(500).json({
      message: "Failed to fetch users",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
