import { type User, type InsertUser, type Product, type InsertProduct, type Inventory, type InsertInventory, type Order, type InsertOrder, type ProductWithInventory, type OrderItem, type ProductImage, type InsertProductImage, type AdminCredential, productImages, orders as ordersTable, users as usersTable, adminCredentials as adminCredentialsTable } from "@shared/schema";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { createClient } from '@supabase/supabase-js';
import { eq, desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export interface IStorage {
  // User management
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getPendingUsers(): Promise<User[]>; // New: get users awaiting approval
  approveUser(userId: string): Promise<User | undefined>; // New: approve a user

  // Product management
  getProduct(id: string): Promise<Product | undefined>;
  getAllProducts(): Promise<Product[]>;
  getProductsWithInventory(): Promise<ProductWithInventory[]>;
  createProduct(product: InsertProduct): Promise<Product>;

  // Inventory management
  getInventoryByProductId(productId: string): Promise<Inventory | undefined>;
  getAllInventory(): Promise<Inventory[]>;
  updateInventory(productId: string, quantity: number): Promise<void>;
  setInventoryFromEcount(productId: string, quantity: number): Promise<void>;

  // Product image management (NEW - completely separate from eCount)
  getProductImage(productCode: string): Promise<string | null>;
  setProductImage(productCode: string, imageUrl: string, priority?: number): Promise<void>;
  getProductImages(productCodes: string[]): Promise<Record<string, string>>;
  deleteProductImage(productCode: string): Promise<void>;
  updateProductImage(productId: string, imageUrl: string): Promise<void>; // Legacy - will be removed

  // Order management
  createOrder(order: InsertOrder): Promise<Order>;
  getOrderById(id: string): Promise<Order | undefined>;
  getOrdersByUserId(userId: string): Promise<Order[]>;
  getAllOrders(): Promise<Order[]>;
  getFailedOrders(): Promise<Order[]>;
  deleteOrder(orderId: string): Promise<boolean>;
  updateOrderErpInfo(orderId: string, erpInfo: {
    erpDocNumber?: string;
    erpIoDate?: string;
    erpSyncStatus?: string;
    erpSyncError?: string | null;
  }): Promise<Order>;

  // Admin credential management
  getAdminCredential(email: string): Promise<AdminCredential | null>;
  updateAdminPassword(email: string, passwordHash: string): Promise<void>;
  initAdminCredential(email: string, passwordHash: string): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User> = new Map();
  private products: Map<string, Product> = new Map();
  private inventory: Map<string, Inventory> = new Map();
  private orders: Map<string, Order> = new Map();
  private productImages: Map<string, ProductImage> = new Map();
  
  // File path for persisting image mappings
  private readonly imagesMappingFile = path.join(process.cwd(), 'data', 'product-images.json');

  constructor() {
    this.initializeData();
    this.loadImageMappings();
  }

  private async ensureDataDirectory(): Promise<void> {
    const dataDir = path.dirname(this.imagesMappingFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  private async loadImageMappings(): Promise<void> {
    try {
      if (fs.existsSync(this.imagesMappingFile)) {
        const data = fs.readFileSync(this.imagesMappingFile, 'utf8');
        const imageArray: ProductImage[] = JSON.parse(data);
        
        // Convert array back to Map
        for (const image of imageArray) {
          this.productImages.set(image.productCode, {
            ...image,
            createdAt: image.createdAt ? new Date(image.createdAt) : new Date(),
            updatedAt: image.updatedAt ? new Date(image.updatedAt) : new Date()
          });
        }
        
        console.log(`🖼️ Loaded ${this.productImages.size} image mappings from persistent storage`);
      }
    } catch (error) {
      console.error('Failed to load image mappings:', error);
    }
  }

  private async saveImageMappings(): Promise<void> {
    try {
      await this.ensureDataDirectory();
      
      // Convert Map to array for JSON serialization
      const imageArray = Array.from(this.productImages.values());
      
      fs.writeFileSync(this.imagesMappingFile, JSON.stringify(imageArray, null, 2));
      console.log(`💾 Saved ${this.productImages.size} image mappings to persistent storage`);
    } catch (error) {
      console.error('Failed to save image mappings:', error);
    }
  }

  private initializeData() {
    // Initialize admin user
    const adminId = randomUUID();
    this.users.set(adminId, {
      id: adminId,
      email: "admin@phomas.com",
      password: "admin123", // In real app, this would be hashed
      companyName: "Phomas Diagnostics",
      role: "admin",
      approved: true, // Admin is always approved
      createdAt: new Date(),
    });

    // Initialize sample client user
    const clientId = randomUUID();
    this.users.set(clientId, {
      id: clientId,
      email: "admin@medcare.com",
      password: "medcare123",
      companyName: "MedCare Clinic",
      role: "client",
      approved: true, // Pre-existing users are approved
      createdAt: new Date(),
    });

    // Initialize products with TZS prices (1 EUR = 3000 TZS conversion)
    const sampleProducts = [
      { id: "PROD001", name: "Pain Reliever Tablets", packaging: "Box of 100", referenceNumber: "PHM-PRT-100", price: "37500", imageUrl: "https://images.unsplash.com/photo-1584362917165-526a968579e8?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&h=300", category: "Pain Relief" },
      { id: "PROD002", name: "Antibiotic Capsules", packaging: "Bottle of 30", referenceNumber: "PHM-ABC-030", price: "74970", imageUrl: "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&h=300", category: "Antibiotics" },
      { id: "PROD003", name: "Digital Thermometer", packaging: "Professional grade", referenceNumber: "PHM-THM-001", price: "135000", imageUrl: "https://images.unsplash.com/photo-1559757175-0eb30cd8c063?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&h=300", category: "Diagnostic Tools" },
      { id: "PROD004", name: "Blood Pressure Monitor", packaging: "Digital automatic", referenceNumber: "PHM-BPM-001", price: "269970", imageUrl: "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&h=300", category: "Diagnostic Tools" },
      { id: "PROD005", name: "Surgical Gloves", packaging: "Box of 100", referenceNumber: "PHM-GLV-100", price: "47970", imageUrl: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&h=300", category: "Medical Supplies" },
      { id: "PROD006", name: "Stethoscope", packaging: "Professional dual head", referenceNumber: "PHM-STH-001", price: "375000", imageUrl: "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&h=300", category: "Diagnostic Tools" },
      { id: "PROD007", name: "Bandages Assorted", packaging: "Pack of 50", referenceNumber: "PHM-BND-050", price: "26250", imageUrl: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&h=300", category: "Medical Supplies" },
      { id: "PROD008", name: "IV Catheter Set", packaging: "Sterile pack of 10", referenceNumber: "PHM-IVC-010", price: "97500", imageUrl: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&h=300", category: "Medical Supplies" },
      { id: "PROD009", name: "Insulin Syringes", packaging: "Box of 100", referenceNumber: "PHM-INS-100", price: "56970", imageUrl: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&h=300", category: "Medical Supplies" },
      { id: "PROD010", name: "Antiseptic Solution", packaging: "500ml bottle", referenceNumber: "PHM-ANT-500", price: "29970", imageUrl: "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&h=300", category: "Antibiotics" },
    ];

    sampleProducts.forEach(product => {
      this.products.set(product.id, product);
    });

    // Initialize inventory
    const sampleInventory = [
      { id: randomUUID(), productId: "PROD001", availableQuantity: 45, expirationDate: new Date("2025-04-15") }, // Expiring soon
      { id: randomUUID(), productId: "PROD002", availableQuantity: 120, expirationDate: new Date("2026-08-20") },
      { id: randomUUID(), productId: "PROD003", availableQuantity: 5, expirationDate: new Date("2027-01-10") }, // Low stock
      { id: randomUUID(), productId: "PROD004", availableQuantity: 25, expirationDate: new Date("2026-12-31") },
      { id: randomUUID(), productId: "PROD005", availableQuantity: 200, expirationDate: new Date("2025-06-30") },
      { id: randomUUID(), productId: "PROD006", availableQuantity: 15, expirationDate: new Date("2028-03-15") },
      { id: randomUUID(), productId: "PROD007", availableQuantity: 80, expirationDate: new Date("2026-09-20") },
      { id: randomUUID(), productId: "PROD008", availableQuantity: 30, expirationDate: new Date("2025-12-10") },
      { id: randomUUID(), productId: "PROD009", availableQuantity: 60, expirationDate: new Date("2026-05-25") },
      { id: randomUUID(), productId: "PROD010", availableQuantity: 90, expirationDate: new Date("2027-02-14") },
    ];

    sampleInventory.forEach(inv => {
      this.inventory.set(inv.productId, inv);
    });
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.email === email);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { 
      ...insertUser, 
      id, 
      role: "client",
      approved: false, // New users need admin approval
      createdAt: new Date()
    };
    this.users.set(id, user);
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async getPendingUsers(): Promise<User[]> {
    return Array.from(this.users.values()).filter(user => !user.approved && user.role !== 'admin');
  }

  async approveUser(userId: string): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (user) {
      user.approved = true;
      this.users.set(userId, user);
    }
    return user;
  }

  async getProduct(id: string): Promise<Product | undefined> {
    return this.products.get(id);
  }

  async getAllProducts(): Promise<Product[]> {
    return Array.from(this.products.values());
  }

  async getProductsWithInventory(): Promise<ProductWithInventory[]> {
    const products = Array.from(this.products.values());
    const now = new Date();
    const threeMonthsFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    return products.map(product => {
      const inventory = this.inventory.get(product.id);
      const expirationDate = inventory?.expirationDate;
      
      return {
        ...product,
        availableQuantity: inventory?.availableQuantity || 0,
        expirationDate: expirationDate?.toISOString(),
        isLowStock: (inventory?.availableQuantity || 0) < 10,
        isExpiringSoon: expirationDate ? expirationDate < threeMonthsFromNow : false,
      };
    });
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const id = `PROD${String(this.products.size + 1).padStart(3, '0')}`;
    const newProduct: Product = { 
      ...product, 
      id,
      imageUrl: product.imageUrl || null,
      category: product.category || null
    };
    this.products.set(id, newProduct);
    return newProduct;
  }

  async getInventoryByProductId(productId: string): Promise<Inventory | undefined> {
    return this.inventory.get(productId);
  }

  async getAllInventory(): Promise<Inventory[]> {
    return Array.from(this.inventory.values());
  }

  async updateInventory(productId: string, quantity: number): Promise<void> {
    const current = this.inventory.get(productId);
    if (current) {
      current.availableQuantity = Math.max(0, current.availableQuantity - quantity);
    }
  }

  async setInventoryFromEcount(productId: string, quantity: number): Promise<void> {
    const current = this.inventory.get(productId);
    if (current) {
      current.availableQuantity = quantity;
    } else {
      // Create new inventory record if it doesn't exist
      const inventoryId = randomUUID();
      this.inventory.set(productId, {
        id: inventoryId,
        productId,
        availableQuantity: quantity,
        expirationDate: null
      });
    }
  }

  async updateProductImage(productId: string, imageUrl: string): Promise<void> {
    const product = this.products.get(productId);
    if (product) {
      // Update existing product in storage
      product.imageUrl = imageUrl;
    } else {
      // Handle eCount-only products by creating a metadata record
      // This allows us to store custom images for products that come from eCount API
      const newProduct: Product = {
        id: productId,
        name: `eCount Product - ${productId}`, // Placeholder name
        packaging: 'Standard',
        referenceNumber: productId,
        price: '0', // Price will come from eCount
        imageUrl: imageUrl,
        category: 'Medical Supplies'
      };
      this.products.set(productId, newProduct);
      
      // Also create a default inventory record
      const inventoryId = randomUUID();
      const defaultInventory: Inventory = {
        id: inventoryId,
        productId: productId,
        availableQuantity: 0, // Quantity will come from eCount
        expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year from now as default
      };
      this.inventory.set(productId, defaultInventory);
      
      console.log(`✅ Created metadata record for eCount-only product: ${productId}`);
    }
  }

  // NEW IMAGE MANAGEMENT METHODS - completely separate from eCount
  async getProductImage(productCode: string): Promise<string | null> {
    const productImage = this.productImages.get(productCode);
    return productImage?.imageUrl || null;
  }

  async setProductImage(productCode: string, imageUrl: string, priority: number = 0): Promise<void> {
    const existingImage = this.productImages.get(productCode);
    
    if (existingImage) {
      // Update existing image
      existingImage.imageUrl = imageUrl;
      existingImage.priority = priority;
      existingImage.updatedAt = new Date();
    } else {
      // Create new image record
      const newImage: ProductImage = {
        id: randomUUID(),
        productCode,
        imageUrl,
        priority,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.productImages.set(productCode, newImage);
    }
    
    console.log(`🖼️ Set image for product ${productCode}: ${imageUrl}`);
    
    // Save to persistent storage
    await this.saveImageMappings();
  }

  async getProductImages(productCodes: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    
    for (const code of productCodes) {
      const productImage = this.productImages.get(code);
      if (productImage) {
        result[code] = productImage.imageUrl;
      }
    }
    
    return result;
  }

  async deleteProductImage(productCode: string): Promise<void> {
    const deleted = this.productImages.delete(productCode);
    if (deleted) {
      console.log(`🗑️ Deleted image for product ${productCode}`);
      
      // Save to persistent storage
      await this.saveImageMappings();
    }
  }

  async createOrder(insertOrder: InsertOrder): Promise<Order> {
    const id = randomUUID();
    const orderNumber = `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(this.orders.size + 1).padStart(3, '0')}`;
    
    const order: Order = {
      ...insertOrder,
      id,
      orderNumber,
      status: insertOrder.status || "processing",
      customerName: insertOrder.customerName || 'Guest Customer',
      customerEmail: insertOrder.customerEmail || 'guest@example.com',
      customerPhone: insertOrder.customerPhone || '',
      customerCompany: insertOrder.customerCompany || '',
      customerAddress: insertOrder.customerAddress || '',
      createdAt: new Date(),
      // Initialize ERP fields with null values
      erpDocNumber: null,
      erpIoDate: null,
      erpSyncStatus: "pending",
      erpSyncError: null,
    };
    
    this.orders.set(id, order);
    
    // Update inventory quantities
    const items: OrderItem[] = JSON.parse(insertOrder.items);
    for (const item of items) {
      await this.updateInventory(item.productId, item.quantity);
    }
    
    return order;
  }

  async getOrdersByUserId(userId: string): Promise<Order[]> {
    return Array.from(this.orders.values())
      .filter(order => order.userId === userId)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  }

  async getAllOrders(): Promise<Order[]> {
    return Array.from(this.orders.values())
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  }

  async getFailedOrders(): Promise<Order[]> {
    return Array.from(this.orders.values())
      .filter(order => order.erpSyncStatus === 'failed')
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  }

  async getOrderById(id: string): Promise<Order | undefined> {
    return this.orders.get(id);
  }

  async deleteOrder(orderId: string): Promise<boolean> {
    const order = this.orders.get(orderId);
    if (order) {
      this.orders.delete(orderId);
      console.log(`🗑️ Deleted order ${order.orderNumber} from memory`);
      return true;
    }
    return false;
  }

  async updateOrderErpInfo(orderId: string, erpInfo: {
    erpDocNumber?: string;
    erpIoDate?: string;
    erpSyncStatus?: string;
    erpSyncError?: string | null;
  }): Promise<Order> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order with ID ${orderId} not found`);
    }

    // Update order with ERP information
    const updatedOrder: Order = {
      ...order,
      erpDocNumber: erpInfo.erpDocNumber !== undefined ? erpInfo.erpDocNumber : order.erpDocNumber,
      erpIoDate: erpInfo.erpIoDate !== undefined ? erpInfo.erpIoDate : order.erpIoDate,
      erpSyncStatus: erpInfo.erpSyncStatus !== undefined ? erpInfo.erpSyncStatus : order.erpSyncStatus,
      erpSyncError: erpInfo.erpSyncError !== undefined ? erpInfo.erpSyncError : order.erpSyncError,
    };

    this.orders.set(orderId, updatedOrder);
    return updatedOrder;
  }

  // Admin credential methods - MemStorage doesn't persist these
  async getAdminCredential(_email: string): Promise<AdminCredential | null> {
    return null;
  }

  async updateAdminPassword(_email: string, _passwordHash: string): Promise<void> {
    throw new Error("Admin credentials require database storage");
  }

  async initAdminCredential(_email: string, _passwordHash: string): Promise<void> {
    throw new Error("Admin credentials require database storage");
  }
}

// Database Storage using PostgreSQL for persistent data
export class DatabaseStorage implements IStorage {
  private memStorage: MemStorage;
  private supabase: any;
  private db: any; // Drizzle database instance

  constructor() {
    // Use MemStorage for products/inventory (eCount handles those)
    this.memStorage = new MemStorage();
    
    // Initialize PostgreSQL database connection
    // Priority: DATABASE_URL > Supabase Transaction Pooler > Memory fallback
    const directDbUrl = process.env.DATABASE_URL;
    const supabaseUrl = process.env.SUPABASE_URL;
    const dbPassword = process.env.PGPASSWORD;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (directDbUrl) {
      // Use direct DATABASE_URL if provided (works with Render, Railway, etc.)
      try {
        const client = postgres(directDbUrl, { prepare: false });
        this.db = drizzle(client);
        console.log('✅ PostgreSQL database connected via DATABASE_URL');
      } catch (error) {
        console.error('❌ Failed to connect via DATABASE_URL:', error);
        this.db = null;
      }
    } else if (supabaseUrl && dbPassword) {
      // Fallback to Supabase Transaction Pooler connection
      try {
        const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
        const encodedPassword = encodeURIComponent(dbPassword);
        const supabaseDbUrl = `postgresql://postgres.${projectRef}:${encodedPassword}@aws-1-eu-north-1.pooler.supabase.com:6543/postgres`;
        
        const client = postgres(supabaseDbUrl, { prepare: false });
        this.db = drizzle(client);
        console.log('✅ Supabase PostgreSQL database connected via Transaction Pooler (eu-north-1)');
      } catch (error) {
        console.error('❌ Failed to connect to Supabase:', error);
        this.db = null;
      }
    } else {
      console.error('❌ DATABASE NOT CONFIGURED! Orders will NOT persist!');
      console.error('   Set DATABASE_URL or (SUPABASE_URL + PGPASSWORD) environment variables');
      this.db = null;
    }
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.warn('⚠️ Supabase not configured, falling back to memory storage for images');
      this.supabase = null;
    } else {
      this.supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        },
        db: { schema: 'public' }
      });
      console.log('✅ Supabase connected for persistent product images');
    }
  }

  // Get database instance for direct queries (admin sessions, etc.)
  getDb() {
    return this.db;
  }

  // Delegate all non-image methods to MemStorage
  async getUser(id: string): Promise<User | undefined> {
    return this.memStorage.getUser(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return this.memStorage.getUserByEmail(email);
  }

  async createUser(user: InsertUser): Promise<User> {
    return this.memStorage.createUser(user);
  }

  async getAllUsers(): Promise<User[]> {
    return this.memStorage.getAllUsers();
  }

  async getProduct(id: string): Promise<Product | undefined> {
    return this.memStorage.getProduct(id);
  }

  async getAllProducts(): Promise<Product[]> {
    return this.memStorage.getAllProducts();
  }

  async getProductsWithInventory(): Promise<ProductWithInventory[]> {
    return this.memStorage.getProductsWithInventory();
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    return this.memStorage.createProduct(product);
  }

  async getInventoryByProductId(productId: string): Promise<Inventory | undefined> {
    return this.memStorage.getInventoryByProductId(productId);
  }

  async getAllInventory(): Promise<Inventory[]> {
    return this.memStorage.getAllInventory();
  }

  async updateInventory(productId: string, quantity: number): Promise<void> {
    return this.memStorage.updateInventory(productId, quantity);
  }

  async setInventoryFromEcount(productId: string, quantity: number): Promise<void> {
    // Try to update in database first
    if (this.db) {
      try {
        // Check if inventory record exists
        const inventoryTable = require('../shared/schema').inventory;
        const existing = await this.db.select().from(inventoryTable).where(eq(inventoryTable.product_id, productId)).limit(1);
        
        if (existing.length > 0) {
          // Update existing record
          await this.db.update(inventoryTable).set({ available_quantity: quantity }).where(eq(inventoryTable.product_id, productId));
        } else {
          // Insert new record
          await this.db.insert(inventoryTable).values({
            id: randomUUID(),
            product_id: productId,
            available_quantity: quantity
          });
        }
        console.log(`✅ Updated eCount inventory: ${productId} = ${quantity} units`);
      } catch (error) {
        console.error('❌ Database error updating inventory:', error);
        // Fall back to memory storage
        await this.memStorage.setInventoryFromEcount(productId, quantity);
      }
    } else {
      return this.memStorage.setInventoryFromEcount(productId, quantity);
    }
  }

  async createOrder(order: InsertOrder): Promise<Order> {
    // Use database if available, otherwise fallback to memory
    if (this.db) {
      try {
        const [createdOrder] = await this.db.insert(ordersTable).values({
          ...order,
          id: randomUUID(),
          orderNumber: `PH-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
          createdAt: new Date(),
        }).returning();
        console.log(`✅ Order ${createdOrder.orderNumber} saved to database`);
        return createdOrder;
      } catch (error) {
        console.error('❌ Database error creating order:', error);
        throw error;
      }
    }
    return this.memStorage.createOrder(order);
  }

  async getOrderById(id: string): Promise<Order | undefined> {
    if (this.db) {
      try {
        const [order] = await this.db.select().from(ordersTable).where(eq(ordersTable.id, id));
        return order;
      } catch (error) {
        console.error('❌ Database error getting order:', error);
        return undefined;
      }
    }
    return this.memStorage.getOrderById(id);
  }

  async getOrdersByUserId(userId: string): Promise<Order[]> {
    if (this.db) {
      try {
        const userOrders = await this.db
          .select()
          .from(ordersTable)
          .where(eq(ordersTable.userId, userId))
          .orderBy(desc(ordersTable.createdAt));
        console.log(`📦 Retrieved ${userOrders.length} orders for user ${userId} from database`);
        return userOrders;
      } catch (error) {
        console.error('❌ Database error getting orders:', error);
        return [];
      }
    }
    return this.memStorage.getOrdersByUserId(userId);
  }

  async getAllOrders(): Promise<Order[]> {
    if (this.db) {
      try {
        const allOrders = await this.db
          .select()
          .from(ordersTable)
          .orderBy(desc(ordersTable.createdAt));
        console.log(`📦 Admin retrieved ${allOrders.length} total orders from database`);
        return allOrders;
      } catch (error) {
        console.error('❌ Database error getting all orders:', error);
        return [];
      }
    }
    return this.memStorage.getAllOrders();
  }

  async getFailedOrders(): Promise<Order[]> {
    if (this.db) {
      try {
        const failedOrders = await this.db
          .select()
          .from(ordersTable)
          .where(eq(ordersTable.erpSyncStatus, 'failed'))
          .orderBy(desc(ordersTable.createdAt));
        return failedOrders;
      } catch (error) {
        console.error('❌ Database error getting failed orders:', error);
        return [];
      }
    }
    return this.memStorage.getFailedOrders();
  }

  async deleteOrder(orderId: string): Promise<boolean> {
    if (this.db) {
      try {
        const result = await this.db
          .delete(ordersTable)
          .where(eq(ordersTable.id, orderId))
          .returning();
        
        if (result.length > 0) {
          console.log(`🗑️ Deleted order ${result[0].orderNumber} from database`);
          return true;
        }
        return false;
      } catch (error) {
        console.error('❌ Database error deleting order:', error);
        return false;
      }
    }
    return this.memStorage.deleteOrder(orderId);
  }

  async getPendingUsers(): Promise<User[]> {
    return this.memStorage.getPendingUsers();
  }

  async approveUser(userId: string): Promise<User | undefined> {
    return this.memStorage.approveUser(userId);
  }

  async updateOrderErpInfo(orderId: string, erpInfo: {
    erpDocNumber?: string;
    erpIoDate?: string;
    erpSyncStatus?: string;
    erpSyncError?: string | null;
  }): Promise<Order> {
    if (this.db) {
      try {
        const [updatedOrder] = await this.db
          .update(ordersTable)
          .set({
            erpDocNumber: erpInfo.erpDocNumber,
            erpIoDate: erpInfo.erpIoDate,
            erpSyncStatus: erpInfo.erpSyncStatus,
            erpSyncError: erpInfo.erpSyncError,
          })
          .where(eq(ordersTable.id, orderId))
          .returning();
        
        if (!updatedOrder) {
          throw new Error(`Order with ID ${orderId} not found`);
        }
        
        console.log(`✅ Updated ERP info for order ${updatedOrder.orderNumber}`);
        return updatedOrder;
      } catch (error) {
        console.error('❌ Database error updating order ERP info:', error);
        throw error;
      }
    }
    return this.memStorage.updateOrderErpInfo(orderId, erpInfo);
  }

  // PERSISTENT PRODUCT IMAGE METHODS - DATABASE-FIRST (PRODUCTION FIX)
  async getProductImage(productCode: string): Promise<string | null> {
    // PRODUCTION FIX: Use raw SQL to bypass schema cache
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase.rpc('get_product_image', {
          p_product_code: productCode
        });

        if (!error && data) {
          const imageUrl = data as string;
          // Cache in memory for faster subsequent reads
          this.memStorage.setProductImage(productCode, imageUrl, 0).catch(() => {
            // Ignore cache write failures
          });
          return imageUrl;
        }
        
        if (error && error.code !== 'PGRST116') { // PGRST116 = not found
          console.error(`❌ Database read error for ${productCode}:`, error.message);
        }
      } catch (error) {
        console.error(`❌ Database exception for ${productCode}:`, error);
      }
    }

    // Fallback to file cache (will be empty after restart)
    return this.memStorage.getProductImage(productCode);
  }

  async setProductImage(productCode: string, imageUrl: string, priority: number = 0): Promise<void> {
    // PRODUCTION FIX: Use raw SQL to bypass schema cache
    if (this.supabase) {
      try {
        await this.supabase.rpc('set_product_image', {
          p_product_code: productCode,
          p_image_url: imageUrl,
          p_priority: priority
        });
        console.log(`💾 Saved image to database: ${productCode}`);
      } catch (error) {
        console.error(`❌ Failed to save image to database for ${productCode}:`, error);
        throw new Error(`Failed to persist image: ${error}`);
      }
    } else {
      console.error('❌ Supabase not configured - images will be lost on restart!');
      throw new Error('Database not configured for image storage');
    }
    
    // Cache in memory for faster reads (non-blocking)
    this.memStorage.setProductImage(productCode, imageUrl, priority).catch((error) => {
      console.log(`⚠️ File cache failed for ${productCode}:`, error.message);
    });
    
    console.log(`🖼️ Saved image for product ${productCode}: ${imageUrl}`);
  }

  async getProductImages(productCodes: string[]): Promise<Record<string, string>> {
    // PRODUCTION FIX: Use raw SQL to bypass schema cache
    if (this.supabase && productCodes.length > 0) {
      try {
        const { data, error } = await this.supabase.rpc('get_product_images_batch', {
          p_product_codes: productCodes
        });

        if (!error && data && Array.isArray(data)) {
          const result: Record<string, string> = {};
          for (const row of data) {
            result[row.product_code] = row.image_url;
            // Warm cache in background (non-blocking)
            this.memStorage.setProductImage(row.product_code, row.image_url, 0).catch(() => {});
          }
          return result;
        }
        
        if (error) {
          console.error('❌ Database batch read error:', error.message);
        }
      } catch (error) {
        console.error('❌ Database batch exception:', error);
      }
    }

    // Fallback to file cache
    return this.memStorage.getProductImages(productCodes);
  }

  async deleteProductImage(productCode: string): Promise<void> {
    // PRODUCTION FIX: Use raw SQL to bypass schema cache
    if (this.supabase) {
      try {
        await this.supabase.rpc('delete_product_image', {
          p_product_code: productCode
        });
        console.log(`🗑️ Deleted image from database: ${productCode}`);
      } catch (error) {
        console.error(`❌ Failed to delete image from database for ${productCode}:`, error);
        throw new Error(`Failed to delete image: ${error}`);
      }
    }
    
    // Also delete from file cache (non-blocking)
    this.memStorage.deleteProductImage(productCode).catch((error) => {
      console.log(`⚠️ File cache delete failed for ${productCode}:`, error.message);
    });
    
    console.log(`🗑️ Deleted image for product ${productCode}`);
  }

  // Legacy method - for compatibility
  async updateProductImage(productId: string, imageUrl: string): Promise<void> {
    return this.setProductImage(productId, imageUrl);
  }

  // Admin credential management - stored in database for persistence
  async getAdminCredential(email: string): Promise<AdminCredential | null> {
    if (!this.db) {
      console.error('❌ Database not available for admin credentials');
      return null;
    }

    try {
      const credentials = await this.db
        .select()
        .from(adminCredentialsTable)
        .where(eq(adminCredentialsTable.email, email));
      
      return credentials[0] || null;
    } catch (error) {
      console.error('❌ Error fetching admin credentials:', error);
      return null;
    }
  }

  async updateAdminPassword(email: string, passwordHash: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not available for admin credentials');
    }

    try {
      await this.db
        .update(adminCredentialsTable)
        .set({
          passwordHash: passwordHash,
          updatedAt: new Date()
        })
        .where(eq(adminCredentialsTable.email, email));
      
      console.log(`🔐 Admin password updated for ${email}`);
    } catch (error) {
      console.error('❌ Error updating admin password:', error);
      throw new Error('Failed to update admin password');
    }
  }

  async initAdminCredential(email: string, passwordHash: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not available for admin credentials');
    }

    try {
      // Check if credential already exists
      const existing = await this.getAdminCredential(email);
      if (existing) {
        console.log(`🔐 Admin credentials already exist for ${email}`);
        return;
      }

      // Insert new admin credential
      await this.db.insert(adminCredentialsTable).values({
        email: email,
        passwordHash: passwordHash
      });
      
      console.log(`🔐 Admin credentials initialized for ${email}`);
    } catch (error) {
      console.error('❌ Error initializing admin credentials:', error);
      throw new Error('Failed to initialize admin credentials');
    }
  }
}

export const storage = new DatabaseStorage();
