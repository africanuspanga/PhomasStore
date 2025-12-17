import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// Helper to get the best available auth token
async function getAuthToken(): Promise<string | null> {
  // First check for admin token (in-memory admin sessions)
  const adminToken = localStorage.getItem("phomas_admin_token");
  if (adminToken) return adminToken;
  
  // Check for stored customer token
  const customerToken = localStorage.getItem("phomas_auth_token");
  if (customerToken) return customerToken;
  
  // Finally, get token from Supabase session (for Supabase Auth users)
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return session.access_token;
    }
  } catch (error) {
    console.log('Could not get Supabase session token');
  }
  
  return null;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorMessage = res.statusText;
    
    try {
      // Clone the response so we can try different parsing methods
      const clonedRes = res.clone();
      const errorData = await clonedRes.json();
      errorMessage = errorData.error || errorData.erpError || errorData.message || JSON.stringify(errorData);
    } catch (jsonError) {
      // If JSON parsing fails, try to get text
      try {
        const text = await res.text();
        if (text) errorMessage = text;
      } catch (textError) {
        // Use status text as last resort
        errorMessage = res.statusText;
      }
    }
    
    const error = new Error(`${res.status}: ${errorMessage}`);
    console.error('API Error Details:', { status: res.status, message: errorMessage });
    throw error;
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {};
  
  if (data && !(data instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  
  // Get auth token from admin sessions, localStorage, or Supabase session
  const token = await getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  
  const res = await fetch(url, {
    method,
    headers,
    body: data instanceof FormData ? data : (data ? JSON.stringify(data) : undefined),
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const headers: Record<string, string> = {};
    
    // Get auth token from admin sessions, localStorage, or Supabase session
    const token = await getAuthToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    
    const res = await fetch(queryKey.join("/") as string, {
      headers,
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
