import { type User, type InsertUser, type Product, type InsertProduct, type Inventory, type InsertInventory, type Order, type InsertOrder, type ProductWithInventory, type OrderItem, type ProductImage, type InsertProductImage, productImages } from "@shared/schema";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { createClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

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
  updateOrderErpInfo(orderId: string, erpInfo: {
    erpDocNumber?: string;
    erpIoDate?: string;
    erpSyncStatus?: string;
    erpSyncError?: string | null;
  }): Promise<Order>;
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
}

// Database Storage using Supabase for persistent product images
export class DatabaseStorage implements IStorage {
  private memStorage: MemStorage;
  private supabase: any;

  constructor() {
    // Use MemStorage for everything except product images
    this.memStorage = new MemStorage();
    
    // Initialize Supabase client for product images
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    
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

  async createOrder(order: InsertOrder): Promise<Order> {
    return this.memStorage.createOrder(order);
  }

  async getOrderById(id: string): Promise<Order | undefined> {
    return this.memStorage.getOrderById(id);
  }

  async getOrdersByUserId(userId: string): Promise<Order[]> {
    return this.memStorage.getOrdersByUserId(userId);
  }

  async getAllOrders(): Promise<Order[]> {
    return this.memStorage.getAllOrders();
  }

  async updateOrderErpInfo(orderId: string, erpInfo: {
    erpDocNumber?: string;
    erpIoDate?: string;
    erpSyncStatus?: string;
    erpSyncError?: string | null;
  }): Promise<Order> {
    return this.memStorage.updateOrderErpInfo(orderId, erpInfo);
  }

  // PERSISTENT PRODUCT IMAGE METHODS - HYBRID APPROACH
  async getProductImage(productCode: string): Promise<string | null> {
    // Always try the persistent file storage first (most reliable)
    const fileResult = await this.memStorage.getProductImage(productCode);
    if (fileResult) {
      return fileResult;
    }

    // Try Supabase as backup if file storage has no data
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from('product_images')
          .select('image_url')
          .eq('product_code', productCode)
          .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 = not found
          // Supabase error, use file storage
          return null;
        }

        return data?.image_url || null;
      } catch (error) {
        // Supabase failed, file storage already returned null
        return null;
      }
    }

    return null;
  }

  async setProductImage(productCode: string, imageUrl: string, priority: number = 0): Promise<void> {
    // Always save to file storage (most reliable)
    await this.memStorage.setProductImage(productCode, imageUrl, priority);
    
    // Try to save to Supabase as backup, but don't fail if it doesn't work
    if (this.supabase) {
      try {
        await this.supabase
          .from('product_images')
          .upsert({
            product_code: productCode,
            image_url: imageUrl,
            priority: priority,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'product_code'
          });
        console.log(`🔄 Also saved to Supabase backup: ${productCode}`);
      } catch (error) {
        // Ignore Supabase errors, file storage is the primary method
        console.log(`⚠️ Supabase backup failed for ${productCode}, but file storage saved`);
      }
    }
    
    console.log(`🖼️ Saved image for product ${productCode}: ${imageUrl}`);
  }

  async getProductImages(productCodes: string[]): Promise<Record<string, string>> {
    // Use file storage for batch requests (faster and more reliable)
    return this.memStorage.getProductImages(productCodes);
  }

  async deleteProductImage(productCode: string): Promise<void> {
    // Delete from file storage
    await this.memStorage.deleteProductImage(productCode);
    
    // Try to delete from Supabase backup
    if (this.supabase) {
      try {
        await this.supabase
          .from('product_images')
          .delete()
          .eq('product_code', productCode);
        console.log(`🔄 Also deleted from Supabase backup: ${productCode}`);
      } catch (error) {
        // Ignore Supabase errors
        console.log(`⚠️ Supabase backup delete failed for ${productCode}, but file storage deleted`);
      }
    }
    
    console.log(`🗑️ Deleted image for product ${productCode}`);
  }

  // Legacy method - for compatibility
  async updateProductImage(productId: string, imageUrl: string): Promise<void> {
    return this.setProductImage(productId, imageUrl);
  }
}

export const storage = new DatabaseStorage();
