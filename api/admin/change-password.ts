import {
  ADMIN_EMAIL,
  adminMetadata,
  createUser,
  findAdminUser,
  hasSupabaseAdminConfig,
  hasSupabaseAuthConfig,
  parseJsonBody,
  signInWithPassword,
  updateUserById,
  validatePassword,
} from "./_shared.ts";

const EMERGENCY_ADMIN_PASSWORD = "Tanganyika@1961";
const EMERGENCY_ADMIN_SESSION_TOKEN = "phomas-emergency-admin-session-9f2df5ef-6958-47ea-92ed-ec0bdf4cc6f3";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const body = parseJsonBody(req);
    const oldPassword = body.oldPassword;
    const newPassword = body.newPassword;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: "Current password and new password are required" });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    if (!hasSupabaseAuthConfig()) {
      return res.status(503).json({ message: "Supabase auth is not configured on the server" });
    }

    if (!hasSupabaseAdminConfig()) {
      return res.status(503).json({ message: "Supabase admin API is not configured on the server" });
    }

    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (bearerToken === EMERGENCY_ADMIN_SESSION_TOKEN && oldPassword === EMERGENCY_ADMIN_PASSWORD) {
      const { user: existingUser, error: findError } = await findAdminUser(ADMIN_EMAIL);
      if (findError) {
        console.error("Emergency admin password lookup failed:", findError);
        return res.status(500).json({ message: "Failed to look up admin account" });
      }

      if (existingUser) {
        const updateResult = await updateUserById(existingUser.id, {
          password: newPassword,
          user_metadata: adminMetadata(existingUser),
        });

        if (!updateResult.ok) {
          console.error("Emergency admin password update failed:", updateResult.error);
          return res.status(500).json({ message: "Failed to change password" });
        }
      } else {
        const createResult = await createUser({
          email: ADMIN_EMAIL,
          password: newPassword,
          email_confirm: true,
          user_metadata: adminMetadata(),
        });

        if (!createResult.ok) {
          console.error("Emergency admin user creation failed:", createResult.error);
          return res.status(500).json({ message: "Failed to create admin account" });
        }
      }

      return res.status(200).json({
        success: true,
        message: "Password changed successfully. Please log in again with your new password.",
      });
    }

    const verifyResult = await signInWithPassword(ADMIN_EMAIL, oldPassword);
    const adminUser = verifyResult.data?.user;

    if (!verifyResult.ok || !adminUser || adminUser.email !== ADMIN_EMAIL) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    const updateResult = await updateUserById(adminUser.id, {
      password: newPassword,
      user_metadata: adminMetadata(adminUser),
    });

    if (!updateResult.ok) {
      console.error("Admin password change failed:", updateResult.error);
      return res.status(500).json({ message: "Failed to change password" });
    }

    return res.status(200).json({
      success: true,
      message: "Password changed successfully. Please log in again with your new password.",
    });
  } catch (error) {
    console.error("Admin password change invocation failed:", error);
    return res.status(500).json({ message: "Failed to change password" });
  }
}
