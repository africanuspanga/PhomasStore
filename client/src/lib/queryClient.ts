import { QueryClient, QueryFunction } from "@tanstack/react-query";

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
  
  // This app uses localStorage-based authentication
  // Check for both admin and customer tokens
  const token = localStorage.getItem("phomas_admin_token") || localStorage.getItem("phomas_auth_token");
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
    
    // This app uses localStorage-based authentication
    // Check for both admin and customer tokens
    const token = localStorage.getItem("phomas_admin_token") || localStorage.getItem("phomas_auth_token");
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
