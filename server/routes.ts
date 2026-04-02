import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { ecountApi } from "./ecountApi";
import { ProductMapping } from "./productMapping";
import { insertUserSchema, loginSchema, insertOrderSchema, supabaseSignUpSchema, adminSessions as adminSessionsTable, adminPasswordChangeSchema } from "@shared/schema";
import { eq, lt } from "drizzle-orm";
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { randomUUID } from "crypto";
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

const BCRYPT_ROUNDS = 12;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@phomas.com';
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
const resolvedSupabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const resolvedSupabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const resolvedSupabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || resolvedSupabaseAnonKey;

// Validate and configure Cloudinary
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.warn('⚠️  Cloudinary environment variables not set. Image uploads will fail.');
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Automatically create unsigned upload preset for direct frontend uploads
const ensureUploadPreset = async () => {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    return;
  }
  
  const presetName = process.env.CLOUDINARY_UPLOAD_PRESET || 'phomas_products';
  
  try {
    // Check if preset already exists
    const existingPresets = await cloudinary.api.upload_presets();
    const presetExists = existingPresets.presets.some((preset: any) => preset.name === presetName);
    
    if (!presetExists) {
      await cloudinary.api.create_upload_preset({
        name: presetName,
        unsigned: true,
        folder: 'phomas-products',
        allowed_formats: ['jpg', 'png', 'gif', 'webp'],
        transformation: [
          { quality: 'auto' },
          { format: 'auto' }
        ]
      });
      console.log(`✅ Created Cloudinary upload preset: ${presetName}`);
    } else {
      console.log(`✅ Cloudinary upload preset already exists: ${presetName}`);
    }
  } catch (error) {
    console.error('⚠️ Failed to create Cloudinary upload preset:', error);
  }
};

// Initialize upload preset
ensureUploadPreset();

// Initialize Supabase client for server-side auth verification
if (!resolvedSupabaseUrl || !resolvedSupabaseServiceKey) {
  console.warn('⚠️  Supabase Auth not fully configured - some features may be limited');
}

const supabase = createClient(
  resolvedSupabaseUrl || 'https://placeholder.supabase.co',
  resolvedSupabaseServiceKey || 'placeholder-key',
  {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  db: { schema: 'public' }
});

const supabaseAdminClient = resolvedSupabaseUrl && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(resolvedSupabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      db: { schema: 'public' }
    })
  : null;

const createSupabaseAuthClient = () => {
  const authKey = resolvedSupabaseAnonKey || resolvedSupabaseServiceKey;

  if (!resolvedSupabaseUrl || !authKey) {
    return null;
  }

  return createClient(resolvedSupabaseUrl, authKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    db: { schema: 'public' }
  });
};

const isSupabaseAdminUser = (user: any) => {
  return user?.email === ADMIN_EMAIL ||
    user?.user_metadata?.role === 'admin' ||
    user?.user_metadata?.user_type === 'admin';
};

let adminCredentialInitPromise: Promise<void> | null = null;

const ensureAdminCredentialsInitialized = async () => {
  if (!adminCredentialInitPromise) {
    adminCredentialInitPromise = (async () => {
      if (!storage.getDb()) {
        console.warn('⚠️ Admin credential bootstrap skipped: database not configured');
        return;
      }

      const existingCredential = await storage.getAdminCredential(ADMIN_EMAIL);

      if (existingCredential) {
        console.log('🔐 Admin credentials already exist in database');
        return;
      }

      const passwordHash = await bcrypt.hash(ADMIN_DEFAULT_PASSWORD, BCRYPT_ROUNDS);
      await storage.initAdminCredential(ADMIN_EMAIL, passwordHash);
      console.log('🔐 Admin credentials initialized for bootstrap admin account');
    })();
  }

  try {
    await adminCredentialInitPromise;
  } catch (error) {
    adminCredentialInitPromise = null;
    throw error;
  }
};

const getSupabaseAdminClientOrRespond = (res: Response) => {
  if (!supabaseAdminClient) {
    res.status(503).json({ message: "Supabase admin API is not configured on the server" });
    return null;
  }

  return supabaseAdminClient;
};

const invalidateAdminSessions = async (email: string) => {
  const db = storage.getDb();
  if (!db) {
    return;
  }

  await db.delete(adminSessionsTable).where(eq(adminSessionsTable.email, email));
  console.log(`🔐 All admin sessions invalidated for ${email}`);
};

const upsertDatabaseAdminPassword = async (email: string, password: string) => {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const existingCredential = await storage.getAdminCredential(email);

  if (existingCredential) {
    await storage.updateAdminPassword(email, passwordHash);
  } else {
    await storage.initAdminCredential(email, passwordHash);
  }
};

const syncSupabaseAdminPassword = async (email: string, password: string) => {
  if (!supabaseAdminClient) {
    return { available: false as const, action: "skipped" as const };
  }

  const { data: { users }, error } = await supabaseAdminClient.auth.admin.listUsers();
  if (error) {
    throw new Error(error.message);
  }

  const existingUser = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
  const userMetadata = {
    ...(existingUser?.user_metadata || {}),
    name: existingUser?.user_metadata?.name || "PHOMAS DIAGNOSTICS",
    role: "admin",
    user_type: "admin",
    approved: true,
  };

  if (existingUser) {
    const { error: updateError } = await supabaseAdminClient.auth.admin.updateUserById(existingUser.id, {
      password,
      user_metadata: userMetadata,
    });

    if (updateError) {
      throw new Error(updateError.message);
    }

    return { available: true as const, action: "updated" as const };
  }

  const { error: createError } = await supabaseAdminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: userMetadata,
  });

  if (createError) {
    throw new Error(createError.message);
  }

  return { available: true as const, action: "created" as const };
};

const verifyAdminPassword = async (email: string, password: string) => {
  const credential = await storage.getAdminCredential(email);

  if (credential) {
    const passwordValid = await bcrypt.compare(password, credential.passwordHash);
    if (passwordValid) {
      return { valid: true as const, source: "database" as const };
    }
  }

  const supabaseAuthClient = createSupabaseAuthClient();
  if (supabaseAuthClient) {
    try {
      const { data, error } = await supabaseAuthClient.auth.signInWithPassword({
        email,
        password
      });

      if (!error && data.user && isSupabaseAdminUser(data.user)) {
        return { valid: true as const, source: "supabase" as const };
      }
    } catch (supabaseError) {
      console.error('🔐 Supabase admin password verification failed:', supabaseError);
    }
  }

  return { valid: false as const, source: null };
};

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

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit
    files: 1
  }
});

// Helper function to test inventory with different API keys and URLs
async function testInventoryWithKey(params: {
  apiKey: string;
  baseUrl: string;
  itemCode: string;
  label: string;
}): Promise<any> {
  const { apiKey, baseUrl, itemCode, label } = params;
  
  console.log(`\n🧪 Testing: ${label}`);
  console.log(`   API Key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);
  console.log(`   Base URL: ${baseUrl}`);
  
  try {
    // Step 1: Get Zone (use production zone endpoint which works regardless)
    const zoneResponse = await fetch(`https://oapiIA.ecount.com/OAPI/V2/Zone?AUTH_KEY=${apiKey}&COM_CODE=902378`);
    const zoneData = await zoneResponse.json();
    
    if (zoneData.Status !== "200" || !zoneData.Data?.Zone) {
      return {
        success: false,
        step: 'zone',
        error: `Zone API failed: ${zoneData.Error?.Message || 'Unknown error'}`
      };
    }
    
    const zone = zoneData.Data.Zone;
    console.log(`   ✅ Zone: ${zone}`);
    
    // Step 2: Login
    const loginUrl = baseUrl.replace('{ZONE}', zone) + '/OAPI/V2/OAPILogin';
    const loginResponse = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        COM_CODE: '902378',
        USER_ID: 'TIHOMBWE',
        AUTH_KEY: apiKey
      })
    });
    
    const loginData = await loginResponse.json();
    
    if (loginData.Status !== "200" || !loginData.Data?.SESSION_ID) {
      return {
        success: false,
        step: 'login',
        error: `Login failed: ${loginData.Error?.Message || 'Unknown error'}`
      };
    }
    
    const sessionId = loginData.Data.SESSION_ID;
    console.log(`   ✅ Login successful`);
    
    // Extract cookies
    const setCookieHeader = loginResponse.headers.get('set-cookie');
    const cookies = setCookieHeader || '';
    
    // Step 3: Test InventoryBalance
    const inventoryUrl = baseUrl.replace('{ZONE}', zone) + `/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus?SESSION_ID=${encodeURIComponent(sessionId)}`;
    const inventoryResponse = await fetch(inventoryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies
      },
      body: JSON.stringify({
        COM_CODE: '902378',
        SESSION_ID: sessionId,
        API_CERT_KEY: apiKey,
        BASE_DATE: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        WH_CD: '00001',
        PROD_CD: itemCode,
        Page: '1',
        PageSize: '10'
      })
    });
    
    const inventoryData = await inventoryResponse.json();
    
    if (inventoryData.Status === "200") {
      console.log(`   ✅ InventoryBalance SUCCESS!`);
      const quantity = inventoryData.Data?.Datas?.[0]?.BAL_QTY || 0;
      return {
        success: true,
        step: 'inventory',
        quantity,
        message: `SUCCESS: Item ${itemCode} has ${quantity} units`,
        httpStatus: inventoryResponse.status,
        responseStatus: inventoryData.Status
      };
    } else {
      console.log(`   ❌ InventoryBalance FAILED: ${inventoryData.Error?.Message}`);
      return {
        success: false,
        step: 'inventory',
        error: inventoryData.Error?.Message || 'Unknown error',
        httpStatus: inventoryResponse.status,
        responseStatus: inventoryData.Status
      };
    }
  } catch (error) {
    console.error(`   ❌ ${label} error:`, error);
    return {
      success: false,
      step: 'exception',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Authentication middleware - extracts user ID from Supabase token
const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  
  // Try to get user ID from Supabase token if provided
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user) {
        (req as any).userId = user.id;
        (req as any).userEmail = user.email || 'unknown@phomas.com';
        (req as any).userRole = user.user_metadata?.user_type === 'admin' ? 'admin' : 'client';
        console.log(`🔐 Auth: User ${user.email} (${user.id}) authenticated`);
        return next();
      }
    } catch (err) {
      console.log('🔐 Auth: Supabase token validation failed, using guest');
    }
  }
  
  // Fallback to guest user if no valid token
  (req as any).userId = 'guest-user';
  (req as any).userEmail = 'guest@phomas.com';
  (req as any).userRole = 'client';
  next();
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

// Admin authentication middleware - validates both Supabase JWT and database sessions
const requireAdminAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Admin authentication required' });
  }

  const token = authHeader.substring(7);
  
  // First, try to validate as Supabase JWT token (persists across restarts)
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (!error && user) {
      // Check if user is admin (admin@phomas.com or has admin role in metadata)
      const isAdmin = isSupabaseAdminUser(user);
      
      if (isAdmin) {
        (req as any).userId = user.id;
        (req as any).userRole = 'admin';
        (req as any).userEmail = user.email;
        console.log(`🔐 Admin auth successful via Supabase: ${user.email}`);
        return next();
      }
    }
  } catch (supabaseError) {
    // Supabase validation failed, try database session fallback
    console.log('🔐 Supabase token validation failed, trying database session...');
  }
  
  // Fallback: Check database session (persists across restarts)
  try {
    const db = storage.getDb();
    if (!db) {
      console.log('🔐 Admin auth failed: Database not available');
      return res.status(401).json({ message: 'Database not available for session validation' });
    }

    const sessions = await db.select().from(adminSessionsTable).where(eq(adminSessionsTable.id, token));
    const session = sessions[0];
    
    if (!session) {
      console.log('🔐 Admin auth failed: Invalid or missing session token');
      return res.status(401).json({ message: 'Invalid or expired admin session' });
    }

    // Check if session is expired
    const now = new Date();
    if (session.expiresAt < now) {
      // Delete expired session
      await db.delete(adminSessionsTable).where(eq(adminSessionsTable.id, token));
      console.log('🔐 Admin auth failed: Session expired');
      return res.status(401).json({ message: 'Admin session expired' });
    }

    // Attach admin info to request
    (req as any).userId = session.userId;
    (req as any).userRole = session.role;
    (req as any).userEmail = session.email;
    
    console.log(`🔐 Admin auth successful via database session: ${session.email}`);
    next();
  } catch (dbError) {
    console.error('🔐 Database session lookup error:', dbError);
    return res.status(401).json({ message: 'Session validation failed' });
  }
};

export async function registerRoutes(app: Express): Promise<Server> {
  // Customer registration endpoint using Supabase
  app.post("/api/auth/register", async (req, res) => {
    try {
      console.log('🔐 Registration request received:', req.body);
      
      const validatedData = supabaseSignUpSchema.parse(req.body);
      const { email, password, name, phone, address, user_type } = validatedData;

      // Create user in Supabase Auth (unapproved by default)
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
            phone,
            address,
            user_type,
            approved: false // Requires admin approval
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

      // Check if user is approved
      const metadata = authData.user.user_metadata || {};
      const isApproved = metadata.approved === true;
      const isAdmin = authData.user.email === ADMIN_EMAIL || isSupabaseAdminUser(authData.user);
      
      if (!isApproved && !isAdmin) {
        console.log('🔐 Login blocked - user not approved:', { email, userId: authData.user.id });
        return res.status(403).json({ 
          success: false,
          message: 'Your account is pending admin approval. Please contact Phomas Diagnostics.',
          pending: true
        });
      }
      
      console.log('🔐 Login successful:', { email, userId: authData.user.id, approved: isApproved || isAdmin });
      
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

  // Initialize credentials (non-blocking)
  ensureAdminCredentialsInitialized().catch((error) => {
    console.error('❌ Failed to initialize admin credentials:', error);
  });

  // Admin authentication endpoint for company admin
  app.post("/api/admin/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      await ensureAdminCredentialsInitialized().catch((error) => {
        console.error('❌ Admin credential bootstrap failed during login:', error);
      });

      const supabaseAuthClient = createSupabaseAuthClient();

      if (supabaseAuthClient) {
        try {
          const { data, error } = await supabaseAuthClient.auth.signInWithPassword({
            email,
            password
          });

          if (!error && data.user && data.session) {
            if (!isSupabaseAdminUser(data.user)) {
              console.log(`🔐 Admin login rejected: ${email} is not an admin user`);
              return res.status(403).json({ message: "Admin access required" });
            }

            try {
              await upsertDatabaseAdminPassword(email, password);
            } catch (syncError) {
              console.error('🔐 Failed to sync admin password into database credential store:', syncError);
            }

            console.log(`🔐 Admin login successful via Supabase: ${email}`);
            return res.json({
              success: true,
              token: data.session.access_token,
              authSource: "supabase",
              user: {
                id: data.user.id,
                email: data.user.email,
                name: data.user.user_metadata?.name || "PHOMAS DIAGNOSTICS",
                role: "admin"
              }
            });
          }

          if (error) {
            console.log(`🔐 Supabase admin login fallback failed for ${email}: ${error.message}`);
          }
        } catch (supabaseError) {
          console.error('🔐 Supabase admin login exception:', supabaseError);
        }
      } else {
        console.warn('⚠️ Supabase admin login fallback unavailable: missing server-side Supabase configuration');
      }

      // Fall back to database-backed admin credentials for compatibility
      const credential = await storage.getAdminCredential(email);

      if (!credential) {
        if (!storage.getDb() && !supabaseAuthClient) {
          console.log(`🔐 Admin login failed: No auth backend configured for ${email}`);
          return res.status(503).json({
            message: "Admin authentication is not configured on the server"
          });
        }

        console.log(`🔐 Admin login failed: No credential found for ${email}`);
        return res.status(401).json({ message: "Invalid admin credentials" });
      }

      const passwordValid = await bcrypt.compare(password, credential.passwordHash);

      if (!passwordValid) {
        console.log(`🔐 Admin login failed: Invalid password for ${email}`);
        return res.status(401).json({ message: "Invalid admin credentials" });
      }

      try {
        await syncSupabaseAdminPassword(email, password);
      } catch (syncError) {
        console.error('🔐 Failed to sync admin password into Supabase:', syncError);
      }
      
      // Create admin session token
      const token = randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
      
      // Save session to database for persistence across restarts
      const db = storage.getDb();
      if (db) {
        try {
          // Clean up old sessions for this email (keep only latest)
          await db.delete(adminSessionsTable).where(eq(adminSessionsTable.email, email));
          
          // Insert new session
          await db.insert(adminSessionsTable).values({
            id: token,
            userId: "admin-phomas",
            email: email,
            role: "admin",
            createdAt: now,
            expiresAt: expiresAt
          });
          console.log(`🔐 Admin login successful (database session): ${email}`);
        } catch (dbError) {
          console.error('🔐 Failed to save admin session to database:', dbError);
        }
      }
      
      res.json({ 
        success: true, 
        token,
        authSource: "database",
        user: { 
          id: "admin-phomas",
          email: email,
          name: "PHOMAS DIAGNOSTICS",
          role: "admin" 
        } 
      });
    } catch (error) {
      console.error('🔐 Admin login error:', error);
      res.status(400).json({ message: "Admin login failed", error });
    }
  });
  
  // Admin password change endpoint
  app.post("/api/admin/change-password", requireAdminAuth, async (req, res) => {
    try {
      const validatedData = adminPasswordChangeSchema.parse(req.body);
      const { oldPassword, newPassword } = validatedData;
      const adminEmail = (req as any).userEmail;

      const passwordCheck = await verifyAdminPassword(adminEmail, oldPassword);

      if (!passwordCheck.valid) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }

      await upsertDatabaseAdminPassword(adminEmail, newPassword);

      try {
        await syncSupabaseAdminPassword(adminEmail, newPassword);
      } catch (syncError) {
        console.error('🔐 Failed to sync changed admin password to Supabase:', syncError);
      }

      await invalidateAdminSessions(adminEmail);
      
      console.log(`🔐 Admin password changed successfully for ${adminEmail}`);
      
      res.json({ 
        success: true, 
        message: "Password changed successfully. Please log in again with your new password." 
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid password format", error: (error as any).errors });
      }
      console.error('🔐 Password change error:', error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  // Emergency admin recovery endpoint
  app.post("/api/admin/recover-access", async (req, res) => {
    try {
      const recoveryToken = req.body?.recoveryToken || req.headers['x-admin-recovery-token'];
      const configuredRecoveryToken = process.env.ADMIN_RECOVERY_TOKEN;
      const email = req.body?.email || ADMIN_EMAIL;
      const newPassword = req.body?.newPassword;

      if (!configuredRecoveryToken) {
        return res.status(503).json({ message: "Admin recovery is not configured on the server" });
      }

      if (!recoveryToken || recoveryToken !== configuredRecoveryToken) {
        return res.status(401).json({ message: "Invalid recovery token" });
      }

      if (!email || email !== ADMIN_EMAIL) {
        return res.status(400).json({ message: "Recovery is only allowed for the configured admin account" });
      }

      adminPasswordChangeSchema.shape.newPassword.parse(newPassword);

      await upsertDatabaseAdminPassword(email, newPassword);

      let supabaseSyncMessage = "Supabase sync skipped";
      try {
        const syncResult = await syncSupabaseAdminPassword(email, newPassword);
        if (syncResult.available) {
          supabaseSyncMessage = `Supabase admin account ${syncResult.action}`;
        }
      } catch (syncError) {
        console.error('🔐 Admin recovery Supabase sync failed:', syncError);
        supabaseSyncMessage = "Supabase sync failed; database credential was still updated";
      }

      await invalidateAdminSessions(email);

      console.log(`🔐 Admin access recovered for ${email}`);

      res.json({
        success: true,
        message: "Admin password reset successfully. You can now sign in with the new password.",
        supabase: supabaseSyncMessage,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ message: "Invalid password format", error: (error as any).errors });
      }
      console.error('🔐 Admin recovery error:', error);
      res.status(500).json({ message: "Failed to recover admin access" });
    }
  });

  // Public Cloudinary configuration for frontend direct uploads
  app.get("/api/cloudinary-config", (req, res) => {
    const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || 'phomas_products';
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    
    console.log('📸 Cloudinary config requested:', {
      cloudName,
      uploadPreset,
      hasCloudName: !!cloudName,
      hasPreset: !!uploadPreset
    });
    
    res.json({ 
      cloudName,
      uploadPreset
    });
  });

  // Debug endpoint to test Cloudinary connection
  app.get("/api/debug/cloudinary", (req, res) => {
    res.json({
      cloudName: process.env.CLOUDINARY_CLOUD_NAME || 'NOT_SET',
      uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || 'NOT_SET',
      apiKey: process.env.CLOUDINARY_API_KEY ? 'SET' : 'NOT_SET',
      apiSecret: process.env.CLOUDINARY_API_SECRET ? 'SET' : 'NOT_SET',
      uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME || 'MISSING'}/image/upload`
    });
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

  // Order routes - now with CORRECTED eCount sales integration
  app.post("/api/orders", requireAuth, enforceSaveRateLimit, async (req, res) => {
    try {
      // Construct user profile from request body or middleware defaults for eCount API
      const userProfile = {
        email: req.body.customerEmail || (req as any).userEmail || 'guest@phomas.com',
        name: req.body.customerName || (req as any).userId || 'Guest Customer'
      };
      
      // Use customer data from request body (sent from frontend with actual user info)
      const orderDataWithCustomer = {
        ...req.body,
        // Prioritize data from frontend request body, fall back to middleware defaults
        customerName: req.body.customerName || (req as any).userEmail?.split('@')[0] || 'Guest Customer',
        customerEmail: req.body.customerEmail || (req as any).userEmail || 'guest@example.com',
        customerPhone: req.body.customerPhone || '',
        customerCompany: req.body.customerCompany || (req as any).userEmail?.split('@')[0] || 'Guest',
        customerAddress: req.body.customerAddress || '',
      };
      
      const orderData = insertOrderSchema.parse(orderDataWithCustomer);
      
      // Create order in local storage first
      const order = await storage.createOrder(orderData);
      
      // Submit to eCount ERP using CORRECTED endpoint and proper error handling
      try {
        const erpResult = await ecountApi.submitSaleOrder(order, userProfile);
        
        // Update order with ERP reference numbers using correct schema fields
        const updatedOrder = await storage.updateOrderErpInfo(order.id, {
          erpDocNumber: erpResult.docNo,
          erpIoDate: erpResult.ioDate,
          erpSyncStatus: 'synced'
        });
        
        console.log(`✅ Order ${order.orderNumber} successfully synced to eCount ERP`);
        console.log(`📄 ERP Doc: ${erpResult.docNo}, Date: ${erpResult.ioDate}`);
        
        res.json({ 
          success: true, 
          order: updatedOrder,
          erp: {
            docNumber: erpResult.docNo,
            ioDate: erpResult.ioDate,
            syncStatus: 'synced'
          }
        });
      } catch (ecountError) {
        console.error('❌ Failed to sync order to eCount ERP:', ecountError);
        
        // Update order with error status
        await storage.updateOrderErpInfo(order.id, {
          erpSyncStatus: 'failed',
          erpSyncError: ecountError instanceof Error ? ecountError.message : 'Unknown ERP error'
        });
        
        // Return 502 Bad Gateway when ERP sync fails - order saved locally but not in ERP
        res.status(502).json({ 
          success: false,
          localOrderSaved: true,
          order,
          error: "Order saved locally but failed to sync with eCount ERP system",
          erpError: ecountError instanceof Error ? ecountError.message : 'Unknown ERP error',
          action: "Order will be retried automatically. Contact support if this persists."
        });
      }
    } catch (error) {
      console.error('❌ Failed to create order:', error);
      res.status(400).json({ 
        message: "Failed to create order", 
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Dedicated eCount sales endpoint for manual testing/retries
  app.post("/api/ecount/sales", requireAuth, enforceSaveRateLimit, async (req, res) => {
    try {
      const { orderId } = req.body;
      
      if (!orderId) {
        return res.status(400).json({ message: "Order ID is required" });
      }
      
      // Get order from storage
      const order = await storage.getOrderById(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      // Construct user profile from order data for eCount API
      const userProfile = {
        email: order.customerEmail || 'guest@phomas.com',
        name: order.customerName || 'Guest Customer'
      };
      
      // Check if already synced
      if (order.erpSyncStatus === 'synced') {
        return res.json({
          success: true,
          message: "Order already synced to eCount ERP",
          erp: {
            docNumber: order.erpDocNumber,
            ioDate: order.erpIoDate,
            syncStatus: order.erpSyncStatus
          }
        });
      }
      
      // Submit to eCount ERP
      const erpResult = await ecountApi.submitSaleOrder(order, userProfile);
      
      // Update order with ERP reference numbers
      const updatedOrder = await storage.updateOrderErpInfo(order.id, {
        erpDocNumber: erpResult.docNo,
        erpIoDate: erpResult.ioDate,
        erpSyncStatus: 'synced',
        erpSyncError: null // Clear any previous error
      });
      
      console.log(`✅ Manual ERP sync successful for order ${order.orderNumber}`);
      
      res.json({
        success: true,
        message: "Order successfully synced to eCount ERP",
        order: updatedOrder,
        erp: {
          docNumber: erpResult.docNo,
          ioDate: erpResult.ioDate,
          syncStatus: 'synced'
        }
      });
    } catch (error) {
      console.error('❌ Manual ERP sync failed:', error);
      
      // Update order with error status if we have the order
      if (req.body.orderId) {
        try {
          await storage.updateOrderErpInfo(req.body.orderId, {
            erpSyncStatus: 'failed',
            erpSyncError: error instanceof Error ? error.message : 'Unknown ERP error'
          });
        } catch (updateError) {
          console.error('Failed to update order error status:', updateError);
        }
      }
      
      res.status(500).json({
        success: false,
        message: "Failed to sync order to eCount ERP",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.get("/api/orders/user/:userId", async (req, res) => {
    try {
      // Require valid Supabase token to access orders
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authentication required to view orders' });
      }
      
      const token = authHeader.substring(7);
      
      try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
          console.log('🔐 Order access denied: Invalid or expired token');
          return res.status(401).json({ message: 'Invalid or expired session. Please log in again.' });
        }
        
        // User is authenticated - verify they're accessing their own orders
        if (user.id !== req.params.userId) {
          // Check if admin accessing another user's orders
          const isAdmin = isSupabaseAdminUser(user);
          if (!isAdmin) {
            console.log(`🔐 User ${user.id} attempted to access orders for ${req.params.userId}`);
            return res.status(403).json({ message: "You can only access your own orders" });
          }
        }
        
        console.log(`📦 User ${user.email} fetching orders for ${req.params.userId}`);
        const orders = await storage.getOrdersByUserId(req.params.userId);
        res.json(orders);
        
      } catch (authError) {
        console.error('🔐 Order auth validation error:', authError);
        return res.status(401).json({ message: 'Authentication failed. Please log in again.' });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch orders", error });
    }
  });

  // Get all orders (admin only) - shows customer information for order attribution
  app.get("/api/orders", requireAdminAuth, async (req, res) => {
    try {
      const orders = await storage.getAllOrders();
      console.log(`📦 Admin fetched ${orders.length} orders with customer information`);
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
      const adminClient = getSupabaseAdminClientOrRespond(res);
      if (!adminClient) return;
      
      // Fetch all users from Supabase Auth using Admin API
      const { data: { users }, error } = await adminClient.auth.admin.listUsers();
      
      if (error) {
        console.error('❌ Failed to fetch users from Supabase:', error);
        return res.status(500).json({ message: "Failed to fetch users from Supabase", error: error.message });
      }
      
      console.log(`✅ Found ${users.length} users in Supabase Auth`);
      
      // Transform Supabase users to match expected format
      const safeUsers = users.map(user => {
        // Get user metadata (name, phone, address, user_type, brela_number, tin_number from registration)
        const metadata = user.user_metadata || {};
        
        return {
          id: user.id,
          email: user.email || '',
          companyName: metadata.name || metadata.company_name || 'Unknown Company',
          role: user.email === ADMIN_EMAIL ? 'admin' : 'client',
          createdAt: user.created_at ? new Date(user.created_at) : new Date(),
          userType: metadata.user_type || 'individual',
          phone: metadata.phone || '',
          address: metadata.address || '',
          brelaNumber: metadata.brela_number || '',
          tinNumber: metadata.tin_number || '',
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

  // Get pending user registrations (users waiting for approval)
  app.get("/api/admin/pending-users", requireAdminAuth, async (req, res) => {
    try {
      console.log('🔍 Admin fetching pending user registrations...');
      const adminClient = getSupabaseAdminClientOrRespond(res);
      if (!adminClient) return;
      
      const { data: { users }, error } = await adminClient.auth.admin.listUsers();
      
      if (error) {
        console.error('❌ Failed to fetch users:', error);
        return res.status(500).json({ message: "Failed to fetch users", error: error.message });
      }
      
      // Filter for pending users (anyone not explicitly approved)
      // This includes both new users (approved: false) and existing users (approved: undefined)
      const pendingUsers = users.filter(user => {
        const metadata = user.user_metadata || {};
        return metadata.approved !== true && user.email !== ADMIN_EMAIL;
      }).map(user => {
        const metadata = user.user_metadata || {};
        return {
          id: user.id,
          email: user.email || '',
          companyName: metadata.name || metadata.company_name || 'Unknown Company',
          phone: metadata.phone || '',
          address: metadata.address || '',
          userType: metadata.user_type || 'individual',
          brelaNumber: metadata.brela_number || '',
          tinNumber: metadata.tin_number || '',
          createdAt: user.created_at ? new Date(user.created_at) : new Date(),
        };
      });
      
      console.log(`📋 Found ${pendingUsers.length} pending user registrations`);
      res.json(pendingUsers);
    } catch (error) {
      console.error('❌ Failed to get pending users:', error);
      res.status(500).json({ message: "Failed to get pending users", error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Approve a user registration
  app.post("/api/admin/approve-user/:userId", requireAdminAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      console.log(`✅ Admin approving user: ${userId}`);
      const adminClient = getSupabaseAdminClientOrRespond(res);
      if (!adminClient) return;
      
      // First, get the current user to preserve their metadata
      const { data: { user: currentUser }, error: getUserError } = await adminClient.auth.admin.getUserById(userId);
      
      if (getUserError || !currentUser) {
        console.error('❌ Failed to get user:', getUserError);
        return res.status(500).json({ message: "Failed to get user", error: getUserError?.message });
      }
      
      // Merge existing metadata with approved flag
      const updatedMetadata = {
        ...currentUser.user_metadata,
        approved: true
      };
      
      // Update user metadata to set approved = true while preserving other fields
      const { data, error } = await adminClient.auth.admin.updateUserById(userId, {
        user_metadata: updatedMetadata
      });
      
      if (error) {
        console.error('❌ Failed to approve user:', error);
        return res.status(500).json({ message: "Failed to approve user", error: error.message });
      }
      
      console.log(`✅ User approved successfully: ${data.user.email}`);
      res.json({ success: true, message: "User approved successfully", user: data.user });
    } catch (error) {
      console.error('❌ Approve user error:', error);
      res.status(500).json({ message: "Failed to approve user", error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Delete user (admin only)
  app.delete("/api/admin/users/:userId", requireAdminAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      console.log(`🗑️ Admin deleting user: ${userId}`);
      const adminClient = getSupabaseAdminClientOrRespond(res);
      if (!adminClient) return;
      
      // Get user first to check if it's admin
      const { data: { user: targetUser }, error: getUserError } = await adminClient.auth.admin.getUserById(userId);
      
      if (getUserError || !targetUser) {
        console.error('❌ Failed to get user:', getUserError);
        return res.status(404).json({ message: "User not found" });
      }
      
      // Prevent deleting admin account
      if (targetUser.email === ADMIN_EMAIL) {
        return res.status(403).json({ message: "Cannot delete admin account" });
      }
      
      // Delete user from Supabase Auth
      const { error } = await adminClient.auth.admin.deleteUser(userId);
      
      if (error) {
        console.error('❌ Failed to delete user:', error);
        return res.status(500).json({ message: "Failed to delete user", error: error.message });
      }
      
      console.log(`✅ User deleted successfully: ${targetUser.email}`);
      res.json({ success: true, message: "User deleted successfully" });
    } catch (error) {
      console.error('❌ Delete user error:', error);
      res.status(500).json({ message: "Failed to delete user", error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Update user metadata (admin only)
  app.put("/api/admin/users/:userId", requireAdminAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      const { companyName, phone, address, brelaNumber, tinNumber, userType } = req.body;
      
      console.log(`✏️ Admin updating user: ${userId}`);
      const adminClient = getSupabaseAdminClientOrRespond(res);
      if (!adminClient) return;
      
      // Get current user to preserve metadata
      const { data: { user: currentUser }, error: getUserError } = await adminClient.auth.admin.getUserById(userId);
      
      if (getUserError || !currentUser) {
        console.error('❌ Failed to get user:', getUserError);
        return res.status(404).json({ message: "User not found" });
      }
      
      // Merge existing metadata with updates
      const updatedMetadata = {
        ...currentUser.user_metadata,
        name: companyName || currentUser.user_metadata?.name,
        company_name: companyName || currentUser.user_metadata?.company_name,
        phone: phone || currentUser.user_metadata?.phone,
        address: address || currentUser.user_metadata?.address,
        brela_number: brelaNumber || currentUser.user_metadata?.brela_number,
        tin_number: tinNumber || currentUser.user_metadata?.tin_number,
        user_type: userType || currentUser.user_metadata?.user_type,
      };
      
      // Update user metadata
      const { data, error } = await adminClient.auth.admin.updateUserById(userId, {
        user_metadata: updatedMetadata
      });
      
      if (error) {
        console.error('❌ Failed to update user:', error);
        return res.status(500).json({ message: "Failed to update user", error: error.message });
      }
      
      console.log(`✅ User updated successfully: ${data.user.email}`);
      res.json({ success: true, message: "User updated successfully", user: data.user });
    } catch (error) {
      console.error('❌ Update user error:', error);
      res.status(500).json({ message: "Failed to update user", error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Delete order (admin only)
  app.delete("/api/admin/orders/:orderId", requireAdminAuth, async (req, res) => {
    try {
      const { orderId } = req.params;
      
      console.log(`🗑️ Admin deleting order: ${orderId}`);
      
      const deleted = await storage.deleteOrder(orderId);
      
      if (!deleted) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      console.log(`✅ Order deleted successfully: ${orderId}`);
      res.json({ success: true, message: "Order deleted successfully" });
    } catch (error) {
      console.error('❌ Delete order error:', error);
      res.status(500).json({ message: "Failed to delete order", error: error instanceof Error ? error.message : 'Unknown error' });
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

  app.get("/api/admin/product-mapping/status", requireAdminAuth, async (_req, res) => {
    try {
      await ProductMapping.ensureLoaded();
      const stats = ProductMapping.getStats();

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Failed to get product mapping status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get product mapping status',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.post("/api/admin/product-mapping/upload", requireAdminAuth, excelUpload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No Excel file provided'
        });
      }

      const uploadDir = path.join(process.cwd(), 'attached_assets');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const originalName = req.file.originalname || 'product-mapping.xlsx';
      const extension = path.extname(originalName).toLowerCase() || '.xlsx';
      const allowedExtensions = new Set(['.xlsx', '.xls', '.csv']);
      if (!allowedExtensions.has(extension)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid file type. Please upload .xlsx, .xls, or .csv'
        });
      }

      const safeBaseName = path
        .basename(originalName, extension)
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 80) || 'product_mapping';
      const fileName = `${safeBaseName}_${Date.now()}${extension}`;
      const filePath = path.join(uploadDir, fileName);

      fs.writeFileSync(filePath, req.file.buffer);
      await ProductMapping.setExcelFilePath(filePath);

      const mappingStats = ProductMapping.getStats();
      const imageMappings = ProductMapping.getImageMappings();
      let importedImages = 0;
      let failedImageImports = 0;

      // Import image URLs from Excel when the file includes an image URL column.
      if (imageMappings.length > 0) {
        const batchSize = 25;

        for (let i = 0; i < imageMappings.length; i += batchSize) {
          const batch = imageMappings.slice(i, i + batchSize);
          const results = await Promise.allSettled(
            batch.map(mapping => storage.setProductImage(mapping.code, mapping.imageUrl))
          );

          for (const result of results) {
            if (result.status === 'fulfilled') {
              importedImages++;
            } else {
              failedImageImports++;
            }
          }
        }
      }

      // Clear cache so /api/products immediately uses fresh Excel mapping.
      ecountApi.clearInventoryCache();

      res.json({
        success: true,
        message: 'Excel mapping replaced successfully',
        data: {
          fileName,
          filePath,
          totalMapped: mappingStats.totalMapped,
          productsWithImages: mappingStats.productsWithImages,
          importedImages,
          failedImageImports,
          lastLoadedAt: mappingStats.lastLoadedAt
        }
      });
    } catch (error) {
      console.error('Failed to upload and apply product mapping Excel:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to upload product mapping Excel',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
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

  // TEST: Try alternative endpoint GetBasicProductsList
  app.post("/api/admin/test-basic-products", requireAdminAuth, async (req, res) => {
    try {
      console.log('🧪 Admin testing GetBasicProductsList endpoint...');
      const result = await ecountApi.testGetBasicProductsList();
      
      res.json({
        success: result.success,
        message: result.success ? 'GetBasicProductsList works!' : 'GetBasicProductsList failed',
        data: result
      });
    } catch (error) {
      console.error('Test endpoint failed:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // TEST: VERIFIED endpoint GetListInventoryBalanceStatus (eCount CS confirmed)
  app.post("/api/admin/test-verified-inventory", requireAdminAuth, async (req, res) => {
    try {
      const { itemCode } = req.body;
      
      if (!itemCode) {
        return res.status(400).json({
          success: false,
          error: 'itemCode is required'
        });
      }

      console.log(`🧪 Admin testing VERIFIED GetListInventoryBalanceStatus endpoint for item: ${itemCode}`);
      const quantity = await ecountApi.getSingleItemInventory(itemCode);
      
      res.json({
        success: true,
        message: `VERIFIED endpoint works! Item ${itemCode} has ${quantity} units`,
        data: {
          itemCode,
          quantity,
          endpoint: 'GetListInventoryBalanceStatus (eCount CS confirmed ✅)'
        }
      });
    } catch (error) {
      console.error('Verified inventory test failed:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'VERIFIED endpoint test failed'
      });
    }
  });

  // DIAGNOSTIC: Detailed technical evidence for eCount CS investigation
  app.get("/api/admin/diagnostic/inventory-balance", requireAdminAuth, async (req, res) => {
    try {
      console.log('🔍 DIAGNOSTIC: Generating technical evidence for eCount CS...');
      const diagnostic = await ecountApi.diagnoseInventoryBalanceApi();
      
      res.json({
        success: true,
        message: 'Diagnostic complete - Send evidenceForSupport to eCount CS',
        diagnostic,
        evidenceForSupport: diagnostic.evidenceForSupport
      });
    } catch (error) {
      console.error('Diagnostic failed:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Diagnostic generation failed'
      });
    }
  });

  // TEST KEY DIAGNOSTIC: Compare production vs test key with test URL
  app.post("/api/admin/test-with-test-key", requireAdminAuth, async (req, res) => {
    try {
      const { itemCode } = req.body;
      console.log('🧪 TESTING WITH TEST KEY: Comparing production key vs test key...');
      console.log(`   Test URL: https://sboapi{ZONE}.ecount.com`);
      console.log(`   Prod URL: https://oapi{ZONE}.ecount.com`);
      
      const testKey = process.env.ECOUNT_TEST_API_KEY;
      if (!testKey) {
        return res.status(400).json({
          success: false,
          error: 'ECOUNT_TEST_API_KEY not found in environment'
        });
      }

      console.log(`   Test Key: ${testKey.substring(0, 8)}...${testKey.substring(testKey.length - 4)}`);
      
      // Test with TEST key and TEST URL
      const testResult = await testInventoryWithKey({
        apiKey: testKey,
        baseUrl: 'https://sboapi{ZONE}.ecount.com',
        itemCode: itemCode || '91100B',
        label: 'TEST KEY + TEST URL'
      });

      // Test with PRODUCTION key and PRODUCTION URL
      const prodKey = process.env.ECOUNT_AUTH_KEY!;
      const prodResult = await testInventoryWithKey({
        apiKey: prodKey,
        baseUrl: 'https://oapi{ZONE}.ecount.com',
        itemCode: itemCode || '91100B',
        label: 'PRODUCTION KEY + PRODUCTION URL'
      });

      res.json({
        success: true,
        message: 'Comparison test complete',
        testKeyResult: testResult,
        productionKeyResult: prodResult,
        summary: {
          testKeyWorks: testResult.success,
          prodKeyWorks: prodResult.success,
          recommendation: testResult.success && !prodResult.success 
            ? 'TEST key works! Production key needs activation.'
            : !testResult.success && !prodResult.success
            ? 'Both keys fail - endpoint may not be activated for any key.'
            : 'Check individual results for details.'
        }
      });
    } catch (error) {
      console.error('Test key diagnostic failed:', error);
      res.status(500).json({
        success: false,
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

  // Diagnostic endpoint: Verify if customer code exists in eCount
  app.get("/api/admin/verify-customer/:customerCode", requireAdminAuth, async (req, res) => {
    try {
      const { customerCode } = req.params;
      console.log(`🔍 Admin verifying customer code: ${customerCode}`);
      
      const customerData = await ecountApi.verifyCustomer(customerCode);
      
      if (customerData) {
        res.json({
          success: true,
          exists: true,
          message: `Customer ${customerCode} exists in eCount`,
          data: customerData
        });
      } else {
        res.json({
          success: true,
          exists: false,
          message: `Customer ${customerCode} NOT found in eCount. Please create it or use a different customer code.`
        });
      }
    } catch (error) {
      console.error('Customer verification failed:', error);
      res.status(500).json({
        success: false,
        message: 'Customer verification failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // TEST GetListInventoryBalanceStatus API endpoint
  app.post("/api/admin/test-inventory-balance-status", requireAdminAuth, async (req, res) => {
    try {
      const { itemCode } = req.body;
      console.log(`\n🧪 TESTING GetListInventoryBalanceStatus API`);
      console.log(`   Item Code: ${itemCode || '91100B'}`);
      
      const testKey = process.env.ECOUNT_TEST_API_KEY;
      const prodKey = process.env.ECOUNT_AUTH_KEY!;
      
      // Helper function to test GetListInventoryBalanceStatus
      const testGetListAPI = async (apiKey: string, label: string) => {
        console.log(`\n📊 Testing ${label}...`);
        try {
          // Step 1: Get Zone (using POST as required by eCount API)
          const zoneResponse = await fetch(`https://oapi.ecount.com/OAPI/V2/Zone`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({
              COM_CODE: "902378",
              AUTH_KEY: apiKey
            })
          });
          const zoneData = await zoneResponse.json();
          
          console.log(`   🌐 Zone Response:`, JSON.stringify(zoneData, null, 2));
          
          if (!zoneData.Data?.Zone && !zoneData.Data?.ZONE) {
            return {
              success: false,
              step: 'zone',
              error: `Zone API failed: ${JSON.stringify(zoneData)}`,
              zoneData
            };
          }
          
          const zone = zoneData.Data.Zone || zoneData.Data.ZONE;
          console.log(`   ✅ Zone: ${zone}`);
          
          // Step 2: Login to get SESSION_ID
          const baseUrl = label.includes('TEST') 
            ? `https://sboapi${zone}.ecount.com`
            : `https://oapi${zone}.ecount.com`;
          
          const loginUrl = `${baseUrl}/OAPI/V2/OAPILogin`;
          const loginResponse = await fetch(loginUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              COM_CODE: "902378",
              USER_ID: "TIHOMBWE",   // Correct User ID who issued the API key
              API_CERT_KEY: apiKey,  // Correct parameter name!
              LAN_TYPE: "en-US",     // Language setting
              ZONE: zone             // Zone from Zone API
            })
          });
          
          const loginResult = await loginResponse.json();
          console.log(`   🔐 Login Response:`, JSON.stringify(loginResult, null, 2));
          
          // Check for login success - SESSION_ID is at Data.Datas.SESSION_ID per documentation
          const sessionId = loginResult.Data?.Datas?.SESSION_ID || loginResult.Data?.SESSION_ID;
          const setCookie = loginResult.Data?.Datas?.SET_COOKIE;
          const sessionGuid = loginResult.Data?.Datas?.session_guid || loginResult.Data?.session_guid;
          
          if (!sessionId) {
            return {
              success: false,
              step: 'login',
              error: `Login failed: ${loginResult.Error?.Message || loginResult.Data?.Message || 'No session ID'}`,
              loginResponse: loginResult
            };
          }
          console.log(`   ✅ Session ID: ${sessionId.substring(0, 15)}...`);
          
          // Step 3: Test GetListInventoryBalanceStatus with proper authentication
          // IMPORTANT: Use SESSION_ID in URL query string AND cookies (matches ecountRequest pattern)
          const apiUrl = `${baseUrl}/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus?SESSION_ID=${encodeURIComponent(sessionId)}`;
          
          const requestBody = {
            COM_CODE: "902378",
            SESSION_ID: sessionId,
            API_CERT_KEY: apiKey,  // CRITICAL: Add API key to body (matches ecountRequest)
            BASE_DATE: new Date().toISOString().slice(0, 10).replace(/-/g, ''),  // REQUIRED: Format as YYYYMMDD
            CUST_CODE: "10839",
            WH_CODE: process.env.ECOUNT_WAREHOUSE_CODE || "00001",
            ITEM_CODE: itemCode || "91100B"
          };
          
          // Build cookies header (matches ecountRequest pattern)
          const cookies = setCookie && sessionGuid 
            ? `ECOUNT_SessionId=${sessionGuid}=${setCookie}; SVID=Login-L${zone}05_4bc5c`
            : '';
          
          console.log(`   📍 URL: ${apiUrl}`);
          console.log(`   📦 Request:`, JSON.stringify(requestBody, null, 2));
          console.log(`   🍪 Cookies: ${cookies.substring(0, 50)}...`);
          
          const headers: any = { 'Content-Type': 'application/json' };
          if (cookies) {
            headers['Cookie'] = cookies;
          }
          
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody)
          });
          
          const result = await response.json();
          console.log(`   📥 Response:`, JSON.stringify(result, null, 2));
          
          if (result.Status === "200" && result.Data) {
            const quantity = result.Data[0]?.available_qty || result.Data[0]?.qty || 0;
            console.log(`   ✅ SUCCESS! Quantity: ${quantity}`);
            return {
              success: true,
              step: 'complete',
              quantity,
              fullResponse: result,
              message: `GetListInventoryBalanceStatus works with ${label}!`
            };
          } else {
            console.log(`   ❌ API returned error: ${result.Message || 'Unknown'}`);
            return {
              success: false,
              step: 'api_call',
              error: result.Message || 'API returned non-200 status',
              fullResponse: result
            };
          }
        } catch (error) {
          console.log(`   ❌ Exception:`, error);
          return {
            success: false,
            step: 'exception',
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }
      
      // Test with both keys
      const results: any = {
        productionKey: await testGetListAPI(prodKey, 'PRODUCTION KEY')
      };
      
      if (testKey) {
        results.testKey = await testGetListAPI(testKey, 'TEST KEY');
      }
      
      res.json({
        success: true,
        message: 'GetListInventoryBalanceStatus API test complete',
        results,
        summary: {
          productionKeyWorks: results.productionKey.success,
          testKeyWorks: results.testKey?.success || false,
          recommendation: results.productionKey.success 
            ? '✅ GetListInventoryBalanceStatus works with production key! You can use this for live inventory.'
            : results.testKey?.success
            ? '⚠️ Test key works but production key fails. Production key needs activation.'
            : '❌ Both keys fail. Contact eCount support.'
        }
      });
    } catch (error) {
      console.error('GetListInventoryBalanceStatus test failed:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // DIAGNOSTIC ENDPOINT: Test InventoryBalance API and capture evidence for eCount support
  app.get("/api/admin/diagnostic/inventory-balance", requireAdminAuth, async (req, res) => {
    try {
      console.log('🔬 DIAGNOSTIC: Testing InventoryBalance API with detailed logging...');
      
      const diagnostic = await ecountApi.diagnoseInventoryBalanceApi();
      
      res.json({
        success: true,
        message: 'Diagnostic test complete - see details below',
        diagnostic,
        nextSteps: diagnostic.inventoryBalanceWorking 
          ? 'InventoryBalance API is working! No action needed.'
          : 'InventoryBalance API is failing. Contact eCount support with the evidence below.'
      });
    } catch (error) {
      console.error('Diagnostic endpoint failed:', error);
      res.status(500).json({
        success: false,
        message: 'Diagnostic test failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Image upload route - no authentication required for simplicity
  app.post("/api/admin/upload-image", upload.single('image'), async (req, res) => {
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

  // Force refresh products (emergency restore)
  app.post("/api/admin/force-refresh-products", requireAdminAuth, async (req, res) => {
    try {
      console.log('🔄 Force refreshing products - emergency restore');
      
      // Wait for rate limiting to pass, then try to get products
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      
      try {
        const products = await ecountApi.getAllProductsFromEcount();
        console.log(`✅ Emergency restore successful: ${products.length} products restored`);
        res.json({ 
          success: true, 
          message: `Successfully restored ${products.length} products`,
          productCount: products.length 
        });
      } catch (error) {
        // If still rate limited, at least clear the bad state
        console.log('⚠️ Still rate limited, will try via background scheduler');
        res.json({ 
          success: false, 
          message: "Still rate limited. Products will be restored automatically within 10 minutes via background sync.",
          willRetryAutomatically: true
        });
      }
    } catch (error) {
      console.error('Emergency restore error:', error);
      res.status(500).json({ message: "Failed to restore products", error });
    }
  });

  // NEW IMAGE API - completely separate from eCount system
  // Note: Image uploads now happen directly from frontend to Cloudinary
  // These endpoints only manage image URL storage and retrieval

  // Set image URL for product code (for external URLs)
  app.post("/api/images/set-url", async (req, res) => {
    try {
      const { productCode, imageUrl } = req.body;
      
      if (!productCode || !imageUrl) {
        return res.status(400).json({ error: "Product code and image URL are required" });
      }

      await storage.setProductImage(productCode, imageUrl);
      
      console.log(`🖼️ Set external image for product ${productCode}: ${imageUrl}`);
      
      res.json({
        success: true,
        productCode,
        imageUrl
      });
    } catch (error) {
      console.error('Set image URL error:', error);
      res.status(500).json({ error: "Failed to set image URL" });
    }
  });

  // Get images for multiple product codes (batch)
  app.get("/api/images", async (req, res) => {
    try {
      const codes = req.query.codes;
      
      if (!codes) {
        return res.status(400).json({ error: "codes parameter is required" });
      }
      
      const productCodes = typeof codes === 'string' ? codes.split(',') : [];
      const images = await storage.getProductImages(productCodes);
      
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minute cache
      res.json({ images });
    } catch (error) {
      console.error('Get images error:', error);
      res.status(500).json({ error: "Failed to get images" });
    }
  });

  // Get single image by product code
  app.get("/api/images/:code", async (req, res) => {
    try {
      const { code } = req.params;
      const imageUrl = await storage.getProductImage(code);
      
      if (!imageUrl) {
        return res.status(404).json({ error: "Image not found" });
      }
      
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minute cache
      res.json({ imageUrl });
    } catch (error) {
      console.error('Get single image error:', error);
      res.status(500).json({ error: "Failed to get image" });
    }
  });

  // Delete image by product code
  app.delete("/api/images/:code", async (req, res) => {
    try {
      const { code } = req.params;
      await storage.deleteProductImage(code);
      
      console.log(`🗑️ Deleted image for product ${code}`);
      
      res.json({ success: true, productCode: code });
    } catch (error) {
      console.error('Delete image error:', error);
      res.status(500).json({ error: "Failed to delete image" });
    }
  });

  // Update product image route (LEGACY - will be removed)
  app.put("/api/admin/products/:id/image", async (req, res) => {
    try {
      const { id } = req.params;
      const { imageUrl } = req.body;

      if (!imageUrl) {
        return res.status(400).json({ message: "Image URL is required" });
      }

      // Update product image in storage
      await storage.updateProductImage(id, imageUrl);
      
      console.log(`🖼️ Updated product image for ${id} - image will show on next product fetch`);
      
      res.json({ success: true, message: "Product image updated successfully" });
    } catch (error) {
      console.error('Update product image error:', error);
      res.status(500).json({ message: "Failed to update product image", error });
    }
  });

  // Health check endpoint for keep-alive monitoring (isolated, read-only)
  app.get("/api/health", (_req, res) => {
    res.json({ 
      status: "ok", 
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  const httpServer = createServer(app);
  return httpServer;
}
