import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { ecountApi } from "./ecountApi";
import { insertUserSchema, loginSchema, insertOrderSchema } from "@shared/schema";

// Helper functions for product transformation
function generateProductName(productCode: string): string {
  // Medical supply name patterns based on product codes
  if (productCode.startsWith('LYOFIA')) return `LYOFIA Medical Test Kit - ${productCode}`;
  if (productCode.startsWith('ABS')) return `ABS Medical Component - ${productCode}`;
  if (productCode.startsWith('HS-')) return `Medical Instrument - ${productCode}`;
  if (productCode.startsWith('PDL-')) return `PDL Medical Supply - ${productCode}`;
  if (productCode.match(/^\d+$/)) return `Medical Product ${productCode}`;
  return `Medical Supply - ${productCode}`;
}

function getCategoryFromCode(productCode: string): string {
  if (productCode.startsWith('LYOFIA')) return 'Laboratory Tests';
  if (productCode.startsWith('ABS')) return 'Medical Components';
  if (productCode.startsWith('HS-')) return 'Medical Instruments';
  if (productCode.startsWith('PDL-')) return 'Medical Supplies';
  if (productCode.match(/^\d+$/)) return 'General Medical';
  return 'Medical Supplies';
}

function getProductImage(productCode: string): string {
  // Default medical supply image
  return 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&h=300';
}

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

  // Product routes - Hybrid approach: local metadata + eCount inventory
  app.get("/api/products", async (req, res) => {
    try {
      // Get base products from storage (rich metadata: names, descriptions, images)
      const baseProducts = await storage.getProductsWithInventory();
      
      // Get real-time inventory quantities from eCount
      try {
        const inventoryMap = await ecountApi.getInventoryBalance();
        console.log(`📊 Got real-time inventory for ${inventoryMap.size} items from eCount`);
        
        // Merge: Use storage metadata + eCount quantities
        const hybridProducts = baseProducts.map(product => {
          const ecountQuantity = inventoryMap.get(product.id);
          return {
            ...product,
            availableQuantity: ecountQuantity !== undefined ? ecountQuantity : product.availableQuantity,
            isLowStock: ecountQuantity !== undefined ? ecountQuantity < 10 : product.isLowStock,
            // Mark products that have real eCount data
            hasRealTimeData: ecountQuantity !== undefined
          };
        });
        
        // Also add any eCount-only products not in our catalog
        inventoryMap.forEach((quantity, productCode) => {
          const existsInCatalog = baseProducts.some(p => p.id === productCode);
          if (!existsInCatalog && quantity > 0) {
            hybridProducts.push({
              id: productCode,
              name: generateProductName(productCode),
              packaging: 'Standard',
              referenceNumber: productCode,
              price: '25000',
              imageUrl: getProductImage(productCode),
              category: getCategoryFromCode(productCode),
              availableQuantity: quantity,
              isLowStock: quantity < 10,
              isExpiringSoon: false,
              hasRealTimeData: true
            });
          }
        });
        
        console.log(`✅ Hybrid catalog: ${hybridProducts.length} products (${hybridProducts.filter(p => p.hasRealTimeData).length} with live eCount data)`);
        res.json(hybridProducts);
        
      } catch (ecountError) {
        console.error('eCount inventory failed, using storage data only:', ecountError);
        res.json(baseProducts);
      }
    } catch (error) {
      console.error('Failed to fetch products:', error);
      res.status(500).json({ message: "Failed to fetch products", error });
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
