import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
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

  // Product routes
  app.get("/api/products", async (req, res) => {
    try {
      const products = await storage.getProductsWithInventory();
      res.json(products);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch products", error });
    }
  });

  app.get("/api/products/:id", async (req, res) => {
    try {
      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      const inventory = await storage.getInventoryByProductId(product.id);
      res.json({
        ...product,
        availableQuantity: inventory?.availableQuantity || 0,
        expirationDate: inventory?.expirationDate?.toISOString(),
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch product", error });
    }
  });

  // Order routes
  app.post("/api/orders", async (req, res) => {
    try {
      const orderData = insertOrderSchema.parse(req.body);
      const order = await storage.createOrder(orderData);
      res.json({ success: true, order });
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
