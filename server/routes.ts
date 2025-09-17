import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { ecountApi } from "./ecountApi";
import { ProductMapping } from "./productMapping";
import { insertUserSchema, loginSchema, insertOrderSchema, supabaseSignUpSchema } from "@shared/schema";
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
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  db: { schema: 'public' }
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
    (req as any).userRole = profile.name === 'PHOMAS DIAGNOSTICS' ? 'admin' : 'client';
    (req as any).userProfile = profile;
    
    console.log(`🔐 Auth successful for user: ${user.email} (${profile.name === 'PHOMAS DIAGNOSTICS' ? 'admin' : 'client'})`);
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

// Admin session store for company admin access
const adminSessions = new Map<string, { userId: string; role: string; email: string; createdAt: Date }>();

// Admin authentication middleware for company admin
const requireAdminAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Admin authentication required' });
  }

  const token = authHeader.substring(7);
  let session = adminSessions.get(token);
  
  // If session not found (e.g., after server restart), try to recreate it for known admin token
  if (!session && token.startsWith('admin-token-')) {
    console.log('🔄 Recreating admin session after server restart');
    session = {
      userId: 'admin-phomas',
      role: 'admin',
      email: 'admin@phomas.com',
      createdAt: new Date()
    };
    adminSessions.set(token, session);
  }
  
  if (!session) {
    return res.status(401).json({ message: 'Invalid or expired admin session' });
  }

  // Check if session is older than 24 hours
  const now = new Date();
  const sessionAge = now.getTime() - session.createdAt.getTime();
  if (sessionAge > 24 * 60 * 60 * 1000) {
    adminSessions.delete(token);
    return res.status(401).json({ message: 'Admin session expired' });
  }

  // Attach admin info to request
  (req as any).userId = session.userId;
  (req as any).userRole = session.role;
  (req as any).userEmail = session.email;
  next();
};

export async function registerRoutes(app: Express): Promise<Server> {
  // Customer registration endpoint using Supabase
  app.post("/api/auth/register", async (req, res) => {
    try {
      console.log('🔐 Registration request received:', req.body);
      
      const validatedData = supabaseSignUpSchema.parse(req.body);
      const { email, password, name, phone, address, user_type } = validatedData;

      // Create user in Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
            phone,
            address,
            user_type
          }
        }
      });

      if (authError) {
        console.error('🔐 Supabase auth registration failed:', authError);
        return res.status(400).json({ 
          message: 'Registration failed', 
          error: authError.message 
        });
      }

      if (!authData.user) {
        console.error('🔐 No user data returned from Supabase');
        return res.status(500).json({ message: 'Registration failed - no user created' });
      }

      // Skip profile creation for now due to schema cache issue
      // Will be handled by client-side after login
      console.log('🔐 Skipping profile creation - will be handled client-side');

      console.log('🔐 Registration successful:', { email, name, user_type });
      
      res.json({ 
        success: true, 
        message: 'Registration successful',
        user: {
          id: authData.user.id,
          email,
          name,
          role: 'customer'
        }
      });
    } catch (error) {
      console.error('🔐 Registration error:', error);
      res.status(400).json({ 
        message: "Registration failed", 
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Prevent GET requests on login endpoint
  app.get("/api/auth/login", (_, res) => {
    res.status(405).json({ error: 'Use POST method for login' });
  });

  // Customer login endpoint using Supabase
  app.post("/api/auth/login", async (req, res) => {
    try {
      console.log('🔐 Login request received:', req.body);
      
      const { email, password } = req.body;

      // Sign in with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError) {
        console.error('🔐 Supabase auth login failed:', authError);
        return res.status(401).json({ 
          message: 'Login failed', 
          error: authError.message 
        });
      }

      if (!authData.user || !authData.session) {
        console.error('🔐 No user or session returned from Supabase');
        return res.status(401).json({ message: 'Login failed - no session created' });
      }

      console.log('🔐 Login successful:', { email, userId: authData.user.id });
      
      res.json({ 
        success: true, 
        message: 'Login successful',
        user: {
          id: authData.user.id,
          email: authData.user.email,
          access_token: authData.session.access_token,
          refresh_token: authData.session.refresh_token
        }
      });
    } catch (error) {
      console.error('🔐 Login error:', error);
      res.status(400).json({ 
        message: "Login failed", 
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Admin authentication endpoint for company admin
  app.post("/api/admin/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      
      // Check hardcoded admin credentials
      if (email === "admin@phomas.com" && password === "admin123") {
        // Create admin session token
        const token = randomUUID();
        adminSessions.set(token, {
          userId: "admin-phomas",
          role: "admin",
          email: email,
          createdAt: new Date()
        });
        
        console.log(`🔐 Admin login successful: ${email}`);
        
        res.json({ 
          success: true, 
          token, 
          user: { 
            id: "admin-phomas",
            email: email,
            name: "PHOMAS DIAGNOSTICS",
            role: "admin" 
          } 
        });
      } else {
        console.log(`🔐 Admin login failed: Invalid credentials for ${email}`);
        return res.status(401).json({ message: "Invalid admin credentials" });
      }
    } catch (error) {
      console.error('🔐 Admin login error:', error);
      res.status(400).json({ message: "Admin login failed", error });
    }
  });

  // Products - Pure eCount Integration (Public catalog browsing)
  app.get("/api/products", async (req, res) => {
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

  // Admin routes - all protected with admin authentication
  app.get("/api/admin/users", requireAdminAuth, async (req, res) => {
    try {
      console.log('🔍 Admin fetching all users from Supabase Auth...');
      
      // Fetch all users from Supabase Auth using Admin API
      const { data: { users }, error } = await supabase.auth.admin.listUsers();
      
      if (error) {
        console.error('❌ Failed to fetch users from Supabase:', error);
        return res.status(500).json({ message: "Failed to fetch users from Supabase", error: error.message });
      }
      
      console.log(`✅ Found ${users.length} users in Supabase Auth`);
      
      // Transform Supabase users to match expected format
      const safeUsers = users.map(user => {
        // Get user metadata (name, phone, address, user_type from registration)
        const metadata = user.user_metadata || {};
        
        return {
          id: user.id,
          email: user.email || '',
          companyName: metadata.name || metadata.company_name || 'Unknown Company',
          role: user.email === 'admin@phomas.com' ? 'admin' : 'client',
          createdAt: user.created_at ? new Date(user.created_at) : new Date(),
          userType: metadata.user_type || 'individual',
          phone: metadata.phone || '',
          address: metadata.address || '',
          emailConfirmed: user.email_confirmed_at ? true : false,
          lastSignIn: user.last_sign_in_at ? new Date(user.last_sign_in_at) : null
        };
      });
      
      // Sort users: admin first, then by creation date (newest first)
      safeUsers.sort((a, b) => {
        if (a.role === 'admin' && b.role !== 'admin') return -1;
        if (b.role === 'admin' && a.role !== 'admin') return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      
      console.log(`📊 Returning ${safeUsers.length} users to admin panel`);
      res.json(safeUsers);
    } catch (error) {
      console.error('❌ Admin users fetch error:', error);
      res.status(500).json({ message: "Failed to fetch users", error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.get("/api/admin/inventory", requireAdminAuth, async (req, res) => {
    try {
      const inventory = await storage.getAllInventory();
      res.json(inventory);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch inventory", error });
    }
  });

  // Admin bulk sync routes - protected with admin authentication AND rate limiting
  app.post("/api/admin/bulk-sync-products", requireAdminAuth, async (req, res) => {
    try {
      const forceSync = req.query.force === '1' || req.body.force === true;
      
      if (!forceSync) {
        // Apply rate limiting for normal sync only
        const userId = (req as any).userId;
        const key = `${userId}-bulk-sync-products`;
        const now = Date.now();
        const lastCall = bulkOperationRateLimit.get(key) || 0;
        const timeSinceLastCall = now - lastCall;
        
        if (timeSinceLastCall < BULK_RATE_LIMIT) {
          const waitSeconds = Math.ceil((BULK_RATE_LIMIT - timeSinceLastCall) / 1000);
          console.log(`🚫 Rate limit hit for bulk-sync-products by user ${userId}`);
          return res.status(429).json({ 
            error: 'Rate limit exceeded',
            message: `Bulk operations limited to 1 per 10 minutes. Please wait ${Math.ceil(waitSeconds / 60)} minutes.`,
            retryAfter: BULK_RATE_LIMIT - timeSinceLastCall
          });
        }
        
        bulkOperationRateLimit.set(key, now);
      } else {
        console.log('🔄 FORCE SYNC: Bypassing rate limits to test new ItemManagement endpoint...');
      }
      
      console.log('Admin initiated bulk product sync' + (forceSync ? ' (FORCE MODE)' : ''));
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

  app.post("/api/admin/bulk-sync-inventory", requireAdminAuth, enforceBulkRateLimit('bulk-sync-inventory'), async (req, res) => {
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

  app.post("/api/admin/clear-cache", requireAdminAuth, enforceBulkRateLimit('clear-cache'), async (req, res) => {
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

  app.get("/api/admin/cache-status", requireAdminAuth, async (req, res) => {
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
  app.post("/api/admin/upload-image", requireAdminAuth, upload.single('image'), async (req, res) => {
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
  app.put("/api/admin/products/:id/image", requireAdminAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { imageUrl } = req.body;

      if (!imageUrl) {
        return res.status(400).json({ message: "Image URL is required" });
      }

      // Update product image in storage
      await storage.updateProductImage(id, imageUrl);
      
      // Clear eCount cache so new image will be used immediately
      ecountApi.clearInventoryCache();
      console.log(`🖼️ Updated product image for ${id} and cleared eCount cache`);
      
      res.json({ success: true, message: "Product image updated successfully" });
    } catch (error) {
      console.error('Update product image error:', error);
      res.status(500).json({ message: "Failed to update product image", error });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
