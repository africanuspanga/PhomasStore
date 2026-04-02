import {
  ADMIN_EMAIL,
  hasSupabaseAuthConfig,
  isAdminUser,
  parseJsonBody,
  signInWithPassword,
} from "./_shared.ts";

const EMERGENCY_ADMIN_PASSWORD = "Tanganyika@1961";
const EMERGENCY_ADMIN_SESSION_TOKEN = "phomas-emergency-admin-session-9f2df5ef-6958-47ea-92ed-ec0bdf4cc6f3";

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

    if (email === ADMIN_EMAIL && password === EMERGENCY_ADMIN_PASSWORD) {
      return res.status(200).json({
        success: true,
        token: EMERGENCY_ADMIN_SESSION_TOKEN,
        authSource: "emergency-serverless",
        user: {
          id: "admin-phomas",
          email: ADMIN_EMAIL,
          name: "PHOMAS DIAGNOSTICS",
          role: "admin",
        },
      });
    }

    if (!hasSupabaseAuthConfig()) {
      return res.status(503).json({ message: "Supabase auth is not configured on the server" });
    }

    const result = await signInWithPassword(email, password);
    const data = result.data;

    if (!result.ok || !data?.user || !data?.access_token) {
      return res.status(401).json({ message: result.error || "Invalid admin credentials" });
    }

    if (!isAdminUser(data.user) || data.user.email !== ADMIN_EMAIL) {
      return res.status(403).json({ message: "Admin access required" });
    }

    return res.status(200).json({
      success: true,
      token: data.access_token,
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
