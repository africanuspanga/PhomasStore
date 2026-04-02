import {
  ADMIN_EMAIL,
  adminMetadata,
  hasSupabaseAdminConfig,
  hasSupabaseAuthConfig,
  parseJsonBody,
  signInWithPassword,
  updateUserById,
  validatePassword,
} from "./_shared";

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
