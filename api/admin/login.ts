import {
  ADMIN_EMAIL,
  createSupabaseAuthClient,
  isAdminUser,
  parseJsonBody,
} from "./_shared";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const body = parseJsonBody(req);
    const email = body.email;
    const password = body.password;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const authClient = createSupabaseAuthClient();
    if (!authClient) {
      return res.status(503).json({ message: "Supabase auth is not configured on the server" });
    }

    const { data, error } = await authClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user || !data.session) {
      return res.status(401).json({ message: error?.message || "Invalid admin credentials" });
    }

    if (!isAdminUser(data.user) || data.user.email !== ADMIN_EMAIL) {
      return res.status(403).json({ message: "Admin access required" });
    }

    return res.status(200).json({
      success: true,
      token: data.session.access_token,
      authSource: "supabase-serverless",
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata?.name || "PHOMAS DIAGNOSTICS",
        role: "admin",
      },
    });
  } catch (error) {
    console.error("Admin login invocation failed:", error);
    return res.status(500).json({ message: "Admin login failed" });
  }
}
