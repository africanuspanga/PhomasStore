export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@phomas.com";

const resolvedSupabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const resolvedSupabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const resolvedSupabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const authBaseUrl = resolvedSupabaseUrl ? `${resolvedSupabaseUrl.replace(/\/$/, "")}/auth/v1` : null;

type SupabaseFetchOptions = {
  method?: string;
  body?: Record<string, unknown>;
  bearerToken?: string;
  useServiceRole?: boolean;
};

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

export function adminMetadata(existingUser?: any) {
  return {
    ...(existingUser?.user_metadata || {}),
    name: existingUser?.user_metadata?.name || "PHOMAS DIAGNOSTICS",
    role: "admin",
    user_type: "admin",
    approved: true,
  };
}

export function hasSupabaseAuthConfig() {
  return !!authBaseUrl && !!resolvedSupabaseAnonKey;
}

export function hasSupabaseAdminConfig() {
  return !!authBaseUrl && !!resolvedSupabaseServiceRoleKey;
}

async function supabaseFetch(path: string, options: SupabaseFetchOptions = {}) {
  if (!authBaseUrl) {
    return { ok: false, status: 503, data: null, error: "Supabase URL is not configured on the server" };
  }

  const apiKey = options.useServiceRole ? resolvedSupabaseServiceRoleKey : resolvedSupabaseAnonKey;
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      data: null,
      error: options.useServiceRole
        ? "Supabase service role key is not configured on the server"
        : "Supabase anon key is not configured on the server",
    };
  }

  const headers: Record<string, string> = {
    apikey: apiKey,
    Authorization: `Bearer ${options.bearerToken || apiKey}`,
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const response = await fetch(`${authBaseUrl}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    let data: any = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    const error =
      data?.msg ||
      data?.error_description ||
      data?.error ||
      data?.message ||
      (!response.ok ? response.statusText : null);

    return {
      ok: response.ok,
      status: response.status,
      data,
      error,
    };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      data: null,
      error: error instanceof Error ? error.message : "Supabase request failed",
    };
  }
}

export async function signInWithPassword(email: string, password: string) {
  return supabaseFetch("/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
}

export async function getUserFromAccessToken(token: string) {
  return supabaseFetch("/user", {
    method: "GET",
    bearerToken: token,
  });
}

export async function listUsers() {
  return supabaseFetch("/admin/users?page=1&per_page=1000", {
    method: "GET",
    useServiceRole: true,
  });
}

export async function updateUserById(userId: string, payload: Record<string, unknown>) {
  return supabaseFetch(`/admin/user/${userId}`, {
    method: "PUT",
    body: payload,
    useServiceRole: true,
  });
}

export async function createUser(payload: Record<string, unknown>) {
  return supabaseFetch("/admin/users", {
    method: "POST",
    body: payload,
    useServiceRole: true,
  });
}

export async function findAdminUser(email = ADMIN_EMAIL) {
  const result = await listUsers();
  if (!result.ok) {
    return { user: null, error: result.error || "Failed to list Supabase users" };
  }

  const users = Array.isArray(result.data?.users) ? result.data.users : [];
  const user = users.find((candidate: any) => candidate.email?.toLowerCase() === email.toLowerCase()) || null;

  return { user, error: null };
}
