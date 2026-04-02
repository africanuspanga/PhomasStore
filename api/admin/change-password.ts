import {
  ADMIN_EMAIL,
  adminMetadata,
  createSupabaseAdminClient,
  createSupabaseAuthClient,
  isAdminUser,
  parseJsonBody,
  validatePassword,
} from "./_shared";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Admin authentication required" });
    }

    const token = authHeader.slice(7);
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

    const authClient = createSupabaseAuthClient();
    const adminClient = createSupabaseAdminClient();

    if (!authClient) {
      return res.status(503).json({ message: "Supabase auth is not configured on the server" });
    }

    if (!adminClient) {
      return res.status(503).json({ message: "Supabase admin API is not configured on the server" });
    }

    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData.user) {
      return res.status(401).json({ message: "Invalid or expired admin session" });
    }

    if (!isAdminUser(userData.user) || userData.user.email !== ADMIN_EMAIL) {
      return res.status(403).json({ message: "Admin access required" });
    }

    const { error: verifyError } = await authClient.auth.signInWithPassword({
      email: userData.user.email!,
      password: oldPassword,
    });

    if (verifyError) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(userData.user.id, {
      password: newPassword,
      user_metadata: adminMetadata(userData.user),
    });

    if (updateError) {
      console.error("Admin password change failed:", updateError.message);
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
