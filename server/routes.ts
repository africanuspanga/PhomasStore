import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { ecountApi } from "./ecountApi";
import { insertUserSchema, loginSchema, insertOrderSchema } from "@shared/schema";
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { randomUUID } from "crypto";
import { createClient } from '@supabase/supabase-js';

// Validate and configure Cloudinary
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.warn('⚠️  Cloudinary environment variables not set. Image uploads will fail.');
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Initialize Supabase client for server-side auth verification
const supabaseUrl = process.env.SUPABASE_URL || 'https://xvomxojbfhovbhbbkuoh.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2b214b2piZmhvdmJoYmJrdW9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5NjY5NTksImV4cCI6MjA3MzU0Mjk1OX0.Th3j5bG7kDgJC9J8jHezRzPVLoI0DhPnE5KB_Fb2f10'

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

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

// Authentication middleware using Supabase JWT verification
const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const token = authHeader.substring(7);
  
  try {
    // Verify JWT token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.log('🔐 Auth verification failed:', error?.message || 'No user');
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    // Fetch user profile from database to get role and additional info
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile) {
      console.log('🔐 Profile fetch failed:', profileError?.message || 'No profile');
      return res.status(401).json({ message: 'User profile not found' });
    }

    // Attach user info to request
    (req as any).userId = user.id;
    (req as any).userEmail = user.email;
    (req as any).userRole = profile.user_type === 'admin' ? 'admin' : 'client';
    (req as any).userProfile = profile;
    
    console.log(`🔐 Auth successful for user: ${user.email} (${profile.user_type})`);
    next();
  } catch (error) {
    console.error('🔐 Auth middleware error:', error);
    return res.status(401).json({ message: 'Authentication failed' });
  }
};

// Admin authorization middleware
const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if ((req as any).userRole !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// Rate limiting for eCount operations (per documentation)
const bulkOperationRateLimit = new Map<string, number>();
const readOperationRateLimit = new Map<string, number>();
const saveOperationRateLimit = new Map<string, number>();

const BULK_RATE_LIMIT = 10 * 60 * 1000; // 10 minutes in milliseconds
const READ_RATE_LIMIT = 1000; // 1 second for single reads
const SAVE_RATE_LIMIT = 10 * 1000; // 10 seconds for save operations

const enforceBulkRateLimit = (operation: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).userId;
    const key = `${userId}-${operation}`;
    const now = Date.now();
    const lastCall = bulkOperationRateLimit.get(key) || 0;
    const timeSinceLastCall = now - lastCall;
    
    if (timeSinceLastCall < BULK_RATE_LIMIT) {
      const waitTime = BULK_RATE_LIMIT - timeSinceLastCall;
      const waitMinutes = Math.ceil(waitTime / (60 * 1000));
      
      console.log(`🚫 Rate limit hit for ${operation} by user ${userId}`);
      return res.status(429).json({ 
        error: 'Rate limit exceeded',
        message: `Bulk operations limited to 1 per 10 minutes. Please wait ${waitMinutes} minutes.`,
        retryAfter: waitTime
      });
    }
    
    // Update rate limit tracker
    bulkOperationRateLimit.set(key, now);
    next();
  };
};

// Rate limiter for single eCount reads (1 request per second)
const enforceReadRateLimit = (req: Request, res: Response, next: NextFunction) => {
  const userId = (req as any).userId;
  const key = `${userId}-read`;
  const now = Date.now();
  const lastCall = readOperationRateLimit.get(key) || 0;
  const timeSinceLastCall = now - lastCall;
  
  if (timeSinceLastCall < READ_RATE_LIMIT) {
    console.log(`🚫 Read rate limit hit by user ${userId}`);
    return res.status(429).json({ 
      error: 'Rate limit exceeded',
      message: 'eCount read operations limited to 1 per second.',
      retryAfter: READ_RATE_LIMIT - timeSinceLastCall
    });
  }
  
  readOperationRateLimit.set(key, now);
  next();
};

// Rate limiter for eCount save operations (10 seconds)
const enforceSaveRateLimit = (req: Request, res: Response, next: NextFunction) => {
  const userId = (req as any).userId;
  const key = `${userId}-save`;
  const now = Date.now();
  const lastCall = saveOperationRateLimit.get(key) || 0;
  const timeSinceLastCall = now - lastCall;
  
  if (timeSinceLastCall < SAVE_RATE_LIMIT) {
    const waitSeconds = Math.ceil((SAVE_RATE_LIMIT - timeSinceLastCall) / 1000);
    console.log(`🚫 Save rate limit hit by user ${userId}`);
    return res.status(429).json({ 
      error: 'Rate limit exceeded',
      message: `eCount save operations limited to 1 per 10 seconds. Please wait ${waitSeconds} seconds.`,
      retryAfter: SAVE_RATE_LIMIT - timeSinceLastCall
    });
  }
  
  saveOperationRateLimit.set(key, now);
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
  // Note: Authentication is now handled by Supabase on the frontend

  // Products - Pure eCount Integration (No Hybrid System)
  app.get("/api/products", requireAuth, async (req, res) => {
    try {
      // Get ALL product data directly from eCount - no local storage
      const ecountProducts = await ecountApi.getAllProductsFromEcount();
      
      console.log(`🚀 Pure eCount catalog: ${ecountProducts.length} products from ERP`);
      
      res.json(ecountProducts);
    } catch (error) {
      console.error('❌ Failed to get eCount products:', error);
      res.status(500).json({ error: 'Failed to fetch products from eCount ERP' });
    }
  });

  app.get("/api/products/:id", requireAuth, enforceReadRateLimit, async (req, res) => {
    try {
      // Pure eCount integration - get ALL products from eCount ERP only
      const ecountProducts = await ecountApi.getAllProductsFromEcount();
      const product = ecountProducts.find(p => p.id === req.params.id);
      
      if (!product) {
        console.log(`🔍 Product ${req.params.id} not found in eCount ERP`);
        return res.status(404).json({ 
          message: "Product not found in eCount ERP",
          productId: req.params.id
        });
      }
      
      console.log(`✅ Product ${req.params.id} found in eCount ERP`);
      res.json(product);
    } catch (error) {
      console.error('❌ Failed to fetch product from eCount:', error);
      res.status(500).json({ 
        message: "Failed to fetch product from eCount ERP", 
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Order routes - now with eCount integration and rate limiting
  app.post("/api/orders", requireAuth, enforceSaveRateLimit, async (req, res) => {
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

  // Note: Logout is now handled by Supabase on the frontend

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

  // Admin bulk sync routes - protected with authentication AND rate limiting
  app.post("/api/admin/bulk-sync-products", requireAuth, requireAdmin, enforceBulkRateLimit('bulk-sync-products'), async (req, res) => {
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

  app.post("/api/admin/bulk-sync-inventory", requireAuth, requireAdmin, enforceBulkRateLimit('bulk-sync-inventory'), async (req, res) => {
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

  app.post("/api/admin/clear-cache", requireAuth, requireAdmin, enforceBulkRateLimit('clear-cache'), async (req, res) => {
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
