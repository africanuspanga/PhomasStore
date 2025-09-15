import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { ecountApi } from "./ecountApi";
import { insertUserSchema, loginSchema, insertOrderSchema } from "@shared/schema";
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { randomUUID } from "crypto";

// Validate and configure Cloudinary
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.warn('⚠️  Cloudinary environment variables not set. Image uploads will fail.');
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Session store for authentication
const activeSessions = new Map<string, { userId: string; role: string; createdAt: Date }>();

// Configure multer with proper validation
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1 // Only one file at a time
  },
  fileFilter: (req, file, cb) => {
    // Only allow image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Authentication middleware
const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const token = authHeader.substring(7);
  const session = activeSessions.get(token);
  
  if (!session) {
    return res.status(401).json({ message: 'Invalid or expired session' });
  }

  // Check if session is older than 24 hours
  const now = new Date();
  const sessionAge = now.getTime() - session.createdAt.getTime();
  if (sessionAge > 24 * 60 * 60 * 1000) {
    activeSessions.delete(token);
    return res.status(401).json({ message: 'Session expired' });
  }

  // Attach user info to request
  (req as any).userId = session.userId;
  (req as any).userRole = session.role;
  next();
};

// Admin authorization middleware
const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if ((req as any).userRole !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

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
      
      // Create session token
      const token = randomUUID();
      activeSessions.set(token, {
        userId: user.id,
        role: user.role,
        createdAt: new Date()
      });
      
      res.json({ 
        success: true, 
        token, // Send token to client
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

  // Product routes - Hybrid approach: local metadata + cached eCount inventory
  app.get("/api/products", async (req, res) => {
    try {
      // Get base products from storage (rich metadata: names, descriptions, images)
      const baseProducts = await storage.getProductsWithInventory();
      
      // Get cached inventory quantities from eCount (with 1-hour caching)
      try {
        const inventoryMap = await ecountApi.getCachedInventoryData();
        console.log(`📊 Got cached inventory for ${inventoryMap.size} items from eCount`);
        
        // Merge: Use storage metadata + cached eCount quantities
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

  // Logout route
  app.post("/api/auth/logout", requireAuth, async (req, res) => {
    try {
      const authHeader = req.headers.authorization!;
      const token = authHeader.substring(7);
      activeSessions.delete(token);
      res.json({ success: true, message: "Logged out successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to logout", error });
    }
  });

  // Admin routes - all protected with authentication and admin authorization
  app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
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

  app.get("/api/admin/inventory", requireAuth, requireAdmin, async (req, res) => {
    try {
      const inventory = await storage.getAllInventory();
      res.json(inventory);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch inventory", error });
    }
  });

  // Admin bulk sync routes - protected
  app.post("/api/admin/bulk-sync-products", requireAuth, requireAdmin, async (req, res) => {
    try {
      console.log('Admin initiated bulk product sync');
      const result = await ecountApi.bulkSyncProducts();
      
      res.json({
        success: true,
        message: 'Bulk product sync completed successfully',
        data: {
          productsCount: result.Data?.Datas?.length || 0,
          status: result.Status,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Admin bulk product sync failed:', error);
      res.status(500).json({
        success: false,
        message: 'Bulk product sync failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.post("/api/admin/bulk-sync-inventory", requireAuth, requireAdmin, async (req, res) => {
    try {
      console.log('Admin initiated bulk inventory sync');
      const result = await ecountApi.bulkSyncInventory();
      
      res.json({
        success: true,
        message: 'Bulk inventory sync completed successfully',
        data: {
          inventoryCount: result.Data?.Datas?.length || 0,
          status: result.Status,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Admin bulk inventory sync failed:', error);
      res.status(500).json({
        success: false,
        message: 'Bulk inventory sync failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.post("/api/admin/clear-cache", requireAuth, requireAdmin, async (req, res) => {
    try {
      console.log('Admin clearing inventory cache');
      ecountApi.clearInventoryCache();
      
      res.json({
        success: true,
        message: 'Inventory cache cleared successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Admin cache clear failed:', error);
      res.status(500).json({
        success: false,
        message: 'Cache clear failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.get("/api/admin/cache-status", requireAuth, requireAdmin, async (req, res) => {
    try {
      const cacheStatus = ecountApi.getCacheStatus();
      
      res.json({
        success: true,
        data: cacheStatus
      });
    } catch (error) {
      console.error('Admin cache status failed:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get cache status',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Image upload route for admin - protected
  app.post("/api/admin/upload-image", requireAuth, requireAdmin, upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No image file provided" });
      }

      // Upload to Cloudinary
      const result = await new Promise<any>((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          {
            resource_type: "image",
            folder: "phomas-products", // Organize images in a folder
            transformation: [
              { width: 800, height: 600, crop: "limit" }, // Optimize size
              { quality: "auto" }, // Auto quality
              { format: "auto" } // Auto format (WebP when supported)
            ]
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        ).end(req.file!.buffer);
      });

      res.json({
        success: true,
        imageUrl: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height
      });
    } catch (error) {
      console.error('Image upload error:', error);
      res.status(500).json({ message: "Failed to upload image", error });
    }
  });

  // Update product image route for admin - protected
  app.put("/api/admin/products/:id/image", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { imageUrl } = req.body;

      if (!imageUrl) {
        return res.status(400).json({ message: "Image URL is required" });
      }

      // Update product image in storage
      await storage.updateProductImage(id, imageUrl);
      
      res.json({ success: true, message: "Product image updated successfully" });
    } catch (error) {
      console.error('Update product image error:', error);
      res.status(500).json({ message: "Failed to update product image", error });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
