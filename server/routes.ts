import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { ecountApi } from "./ecountApi";
import { insertUserSchema, loginSchema, insertOrderSchema } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  // Authentication routes
  app.post("/api/auth/register", async (req, res) => {
    try {
      const userData = insertUserSchema.parse(req.body);
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(userData.email);
      if (existingUser) {
        return res.status(400).json({ message: "User with this email already exists" });
      }
      
      const user = await storage.createUser(userData);
      res.json({ 
        success: true, 
        user: { 
          id: user.id, 
          email: user.email, 
          companyName: user.companyName, 
          role: user.role 
        } 
      });
    } catch (error) {
      res.status(400).json({ message: "Invalid user data", error });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      
      const user = await storage.getUserByEmail(email);
      if (!user || user.password !== password) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      
      res.json({ 
        success: true, 
        user: { 
          id: user.id, 
          email: user.email, 
          companyName: user.companyName, 
          role: user.role 
        } 
      });
    } catch (error) {
      res.status(400).json({ message: "Invalid login data", error });
    }
  });

  // Product routes - now using eCount API
  app.get("/api/products", async (req, res) => {
    try {
      // Get products from eCount API
      const products = await ecountApi.getProducts();
      
      // Get real-time inventory levels
      const inventoryMap = await ecountApi.getInventoryBalance();
      
      // Merge product data with inventory
      const productsWithInventory = products.map(product => ({
        ...product,
        availableQuantity: inventoryMap.get(product.id) || 0,
        isLowStock: (inventoryMap.get(product.id) || 0) < 10,
        isExpiringSoon: false // Can be enhanced later
      }));
      
      res.json(productsWithInventory);
    } catch (error) {
      console.error('Failed to fetch products from eCount:', error);
      // Fallback to mock data if eCount API fails
      try {
        const fallbackProducts = await storage.getProductsWithInventory();
        res.json(fallbackProducts);
      } catch (fallbackError) {
        res.status(500).json({ message: "Failed to fetch products", error });
      }
    }
  });

  app.get("/api/products/:id", async (req, res) => {
    try {
      // Get all products from eCount and find the specific one
      const products = await ecountApi.getProducts();
      const product = products.find(p => p.id === req.params.id);
      
      if (!product) {
        // Fallback to storage if not found in eCount
        const fallbackProduct = await storage.getProduct(req.params.id);
        if (!fallbackProduct) {
          return res.status(404).json({ message: "Product not found" });
        }
        
        const inventory = await storage.getInventoryByProductId(fallbackProduct.id);
        return res.json({
          ...fallbackProduct,
          availableQuantity: inventory?.availableQuantity || 0,
          expirationDate: inventory?.expirationDate?.toISOString(),
        });
      }
      
      // Get real-time inventory for this product
      const inventoryMap = await ecountApi.getInventoryBalance();
      const availableQuantity = inventoryMap.get(product.id) || 0;
      
      res.json({
        ...product,
        availableQuantity,
        isLowStock: availableQuantity < 10,
        isExpiringSoon: false
      });
    } catch (error) {
      console.error('Failed to fetch product from eCount:', error);
      res.status(500).json({ message: "Failed to fetch product", error });
    }
  });

  // Order routes - now with eCount integration
  app.post("/api/orders", async (req, res) => {
    try {
      const orderData = insertOrderSchema.parse(req.body);
      
      // Create order in local storage first
      const order = await storage.createOrder(orderData);
      
      // Then try to create it in eCount ERP
      try {
        const ecountOrderId = await ecountApi.createSalesOrder(order);
        console.log(`Order ${order.orderNumber} created in eCount with ID: ${ecountOrderId}`);
        
        // Could update order status to indicate eCount sync success
        res.json({ 
          success: true, 
          order: {
            ...order,
            ecountOrderId
          }
        });
      } catch (ecountError) {
        console.error('Failed to create order in eCount:', ecountError);
        // Still return success for local order, but log the eCount failure
        res.json({ 
          success: true, 
          order,
          warning: "Order created locally but failed to sync with ERP"
        });
      }
    } catch (error) {
      res.status(400).json({ message: "Failed to create order", error });
    }
  });

  app.get("/api/orders/user/:userId", async (req, res) => {
    try {
      const orders = await storage.getOrdersByUserId(req.params.userId);
      res.json(orders);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch orders", error });
    }
  });

  app.get("/api/orders", async (req, res) => {
    try {
      const orders = await storage.getAllOrders();
      res.json(orders);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch all orders", error });
    }
  });

  // Admin routes
  app.get("/api/admin/users", async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      // Remove passwords from response
      const safeUsers = users.map(user => ({
        id: user.id,
        email: user.email,
        companyName: user.companyName,
        role: user.role,
        createdAt: user.createdAt,
      }));
      res.json(safeUsers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users", error });
    }
  });

  app.get("/api/admin/inventory", async (req, res) => {
    try {
      const inventory = await storage.getAllInventory();
      res.json(inventory);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch inventory", error });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
