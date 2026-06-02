import { supabase } from "@/lib/supabase";

export async function sendPasswordResetEmail(email: string) {
  const redirectTo = `${window.location.origin}/auth/confirm?type=recovery`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) {
    throw new Error(error.message);
  }
}
