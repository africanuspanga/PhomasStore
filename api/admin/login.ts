const ADMIN_EMAIL = "admin@phomas.com";
const EMERGENCY_ADMIN_PASSWORD = "Tanganyika@1961";
const EMERGENCY_ADMIN_SESSION_TOKEN = "phomas-emergency-admin-session-9f2df5ef-6958-47ea-92ed-ec0bdf4cc6f3";

function parseJsonBody(req: any) {
  if (!req?.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

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

    if (email !== ADMIN_EMAIL || password !== EMERGENCY_ADMIN_PASSWORD) {
      return res.status(401).json({ message: "Invalid admin credentials" });
    }

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
  } catch (error) {
    console.error("Emergency admin login invocation failed:", error);
    return res.status(500).json({ message: "Admin login failed" });
  }
}
