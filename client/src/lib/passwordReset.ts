import { supabase } from "@/lib/supabase";

const PRODUCTION_SITE_URL = "https://shop.phomasdiagnosticstz.com";

function normalizeSiteUrl(value: string) {
  const trimmedValue = value.trim().replace(/\/+$/, "");
  if (!trimmedValue) {
    return PRODUCTION_SITE_URL;
  }

  return /^https?:\/\//i.test(trimmedValue)
    ? trimmedValue
    : `https://${trimmedValue}`;
}

function getPasswordResetRedirectUrl() {
  const configuredSiteUrl =
    import.meta.env.VITE_SITE_URL ||
    import.meta.env.VITE_PUBLIC_SITE_URL ||
    import.meta.env.VITE_APP_URL;
  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(currentOrigin);
  const siteUrl = normalizeSiteUrl(configuredSiteUrl || (isLocalOrigin ? currentOrigin : PRODUCTION_SITE_URL));

  return `${siteUrl}/auth/confirm?type=recovery`;
}

export async function sendPasswordResetEmail(email: string) {
  const redirectTo = getPasswordResetRedirectUrl();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) {
    throw new Error(error.message);
  }
}
