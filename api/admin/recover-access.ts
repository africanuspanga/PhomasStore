import {
  ADMIN_EMAIL,
  adminMetadata,
  createUser,
  findAdminUser,
  hasSupabaseAdminConfig,
  parseJsonBody,
  updateUserById,
  validatePassword,
} from "./_shared";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const body = parseJsonBody(req);
    const recoveryToken = body.recoveryToken || req.headers["x-admin-recovery-token"];
    const configuredRecoveryToken = process.env.ADMIN_RECOVERY_TOKEN;
    const email = body.email || ADMIN_EMAIL;
    const newPassword = body.newPassword;

    if (!configuredRecoveryToken) {
      return res.status(503).json({ message: "Admin recovery is not configured on the server" });
    }

    if (!recoveryToken || recoveryToken !== configuredRecoveryToken) {
      return res.status(401).json({ message: "Invalid recovery token" });
    }

    if (email !== ADMIN_EMAIL) {
      return res.status(400).json({ message: "Recovery is only allowed for the configured admin account" });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    if (!hasSupabaseAdminConfig()) {
      return res.status(503).json({ message: "Supabase admin API is not configured on the server" });
    }

    const { user: existingUser, error: findError } = await findAdminUser(email);
    if (findError) {
      console.error("Admin recovery user lookup failed:", findError);
      return res.status(500).json({ message: "Failed to look up admin account" });
    }

    if (existingUser) {
      const result = await updateUserById(existingUser.id, {
        password: newPassword,
        user_metadata: adminMetadata(existingUser),
      });

      if (!result.ok) {
        console.error("Admin recovery password update failed:", result.error);
        return res.status(500).json({ message: "Failed to reset admin password" });
      }
    } else {
      const result = await createUser({
        email,
        password: newPassword,
        email_confirm: true,
        user_metadata: adminMetadata(),
      });

      if (!result.ok) {
        console.error("Admin recovery user creation failed:", result.error);
        return res.status(500).json({ message: "Failed to create admin account" });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Admin password reset successfully. You can now sign in with the new password.",
    });
  } catch (error) {
    console.error("Admin recovery invocation failed:", error);
    return res.status(500).json({ message: "Failed to recover admin access" });
  }
}
