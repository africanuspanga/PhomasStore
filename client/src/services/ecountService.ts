import { apiRequest } from "@/lib/queryClient";
import type { ProductWithInventory, InsertUser, LoginUser, InsertOrder, Order, User } from "@shared/schema";

// This service layer abstracts API calls for easy eCOUNT integration
// When eCOUNT API credentials are available, only this file needs to be modified

export const ecountService = {
  // Product operations
  async getProducts(): Promise<ProductWithInventory[]> {
    const response = await apiRequest("GET", "/api/products");
    return await response.json();
  },

  async getProduct(id: string): Promise<ProductWithInventory> {
    const response = await apiRequest("GET", `/api/products/${id}`);
    return await response.json();
  },

  // Authentication operations
  async register(userData: InsertUser): Promise<{ success: boolean; user: User }> {
    const response = await apiRequest("POST", "/api/auth/register", userData);
    return await response.json();
  },

  async login(credentials: LoginUser): Promise<{ success: boolean; user: User; token: string }> {
    const response = await apiRequest("POST", "/api/auth/login", credentials);
    return await response.json();
  },

  async logout(): Promise<{ success: boolean; message: string }> {
    const response = await apiRequest("POST", "/api/auth/logout", {});
    return await response.json();
  },

  // Order operations
  async placeOrder(orderData: InsertOrder): Promise<{ success: boolean; order: Order }> {
    const response = await apiRequest("POST", "/api/orders", orderData);
    return await response.json();
  },

  async getOrdersByUserId(userId: string): Promise<Order[]> {
    const response = await apiRequest("GET", `/api/orders/user/${userId}`);
    return await response.json();
  },

  // Admin operations
  async getAllUsers(): Promise<User[]> {
    const response = await apiRequest("GET", "/api/admin/users");
    return await response.json();
  },

  async getAllOrders(): Promise<Order[]> {
    const response = await apiRequest("GET", "/api/orders");
    return await response.json();
  },

  async getInventoryAlerts(): Promise<any[]> {
    const response = await apiRequest("GET", "/api/admin/inventory");
    return await response.json();
  },
};

// Future eCOUNT integration example:
/*
export const ecountService = {
  async getProducts(): Promise<ProductWithInventory[]> {
    // Replace with actual eCOUNT API call
    const response = await fetch(`${ECOUNT_API_BASE}/products`, {
      headers: {
        'Authorization': `Bearer ${ECOUNT_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    // Transform eCOUNT response to match our interface
    return transformEcountProducts(data);
  },
  
  async placeOrder(orderData: InsertOrder): Promise<{ success: boolean; order: Order }> {
    // Transform our order format to eCOUNT format
    const ecountOrderData = transformToEcountOrder(orderData);
    
    const response = await fetch(`${ECOUNT_API_BASE}/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ECOUNT_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(ecountOrderData)
    });
    
    const result = await response.json();
    return transformEcountOrderResponse(result);
  }
};
*/
