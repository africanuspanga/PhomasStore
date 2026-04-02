import { createClient } from "@supabase/supabase-js";

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@phomas.com";

const resolvedSupabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const resolvedSupabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const resolvedSupabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function parseJsonBody(req: any) {
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

export function createSupabaseAuthClient() {
  if (!resolvedSupabaseUrl || !resolvedSupabaseAnonKey) {
    return null;
  }

  return createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: { schema: "public" },
  });
}

export function createSupabaseAdminClient() {
  if (!resolvedSupabaseUrl || !resolvedSupabaseServiceRoleKey) {
    return null;
  }

  return createClient(resolvedSupabaseUrl, resolvedSupabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: { schema: "public" },
  });
}

export function isAdminUser(user: any) {
  return user?.email === ADMIN_EMAIL ||
    user?.user_metadata?.role === "admin" ||
    user?.user_metadata?.user_type === "admin";
}

export function validatePassword(password: string | undefined) {
  if (!password) return "Password is required";
  if (password.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter";
  if (!/[a-z]/.test(password)) return "Password must contain at least one lowercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain at least one number";
  return null;
}

export async function findAdminUser(adminClient: ReturnType<typeof createSupabaseAdminClient>, email = ADMIN_EMAIL) {
  if (!adminClient) {
    return { user: null, error: "Supabase admin API is not configured on the server" };
  }

  const { data, error } = await adminClient.auth.admin.listUsers();
  if (error) {
    return { user: null, error: error.message };
  }

  const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase()) || null;
  return { user, error: null };
}

export function adminMetadata(existingUser?: any) {
  return {
    ...(existingUser?.user_metadata || {}),
    name: existingUser?.user_metadata?.name || "PHOMAS DIAGNOSTICS",
    role: "admin",
    user_type: "admin",
    approved: true,
  };
}
