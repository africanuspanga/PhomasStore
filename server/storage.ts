import { type User, type InsertUser, type Product, type InsertProduct, type Inventory, type InsertInventory, type Order, type InsertOrder, type ProductWithInventory, type OrderItem } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // User management
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;

  // Product management
  getProduct(id: string): Promise<Product | undefined>;
  getAllProducts(): Promise<Product[]>;
  getProductsWithInventory(): Promise<ProductWithInventory[]>;
  createProduct(product: InsertProduct): Promise<Product>;

  // Inventory management
  getInventoryByProductId(productId: string): Promise<Inventory | undefined>;
  getAllInventory(): Promise<Inventory[]>;
  updateInventory(productId: string, quantity: number): Promise<void>;

  // Product image management
  updateProductImage(productId: string, imageUrl: string): Promise<void>;

  // Order management
  createOrder(order: InsertOrder): Promise<Order>;
  getOrdersByUserId(userId: string): Promise<Order[]>;
  getAllOrders(): Promise<Order[]>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User> = new Map();
  private products: Map<string, Product> = new Map();
  private inventory: Map<string, Inventory> = new Map();
  private orders: Map<string, Order> = new Map();

  constructor() {
    this.initializeData();
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
      createdAt: new Date()
    };
    this.users.set(id, user);
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
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

  async createOrder(insertOrder: InsertOrder): Promise<Order> {
    const id = randomUUID();
    const orderNumber = `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(this.orders.size + 1).padStart(3, '0')}`;
    
    const order: Order = {
      ...insertOrder,
      id,
      orderNumber,
      status: insertOrder.status || "processing",
      createdAt: new Date(),
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
}

export const storage = new MemStorage();
