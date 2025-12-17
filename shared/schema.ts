import { sql } from "drizzle-orm";
import { pgTable, text, varchar, decimal, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  companyName: text("company_name").notNull(),
  role: text("role").notNull().default("client"), // "client" or "admin"
  approved: boolean("approved").notNull().default(false), // Admin approval required
  createdAt: timestamp("created_at").defaultNow(),
});

export const products = pgTable("products", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
  packaging: text("packaging").notNull(),
  referenceNumber: text("reference_number").notNull().unique(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  imageUrl: text("image_url"),
  category: text("category"),
});

export const inventory = pgTable("inventory", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull().references(() => products.id),
  availableQuantity: integer("available_quantity").notNull(),
  expirationDate: timestamp("expiration_date"),
});

export const orders = pgTable("orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(), // Supabase Auth user ID (no FK - users managed by Supabase Auth)
  orderNumber: text("order_number").notNull().unique(),
  items: text("items").notNull(), // JSON string of order items
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  tax: decimal("tax", { precision: 10, scale: 2 }).notNull(),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("processing"),
  // Customer information (stored directly for admin visibility)
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").default(''),
  customerCompany: text("customer_company").default(''),
  customerAddress: text("customer_address").default(''),
  // eCount ERP Integration fields
  erpDocNumber: text("erp_doc_number"), // DOC_NO from eCount SaveSale response
  erpIoDate: text("erp_io_date"), // IO_DATE from eCount SaveSale (YYYYMMDD format)
  erpSyncStatus: text("erp_sync_status").default("pending"), // "pending", "synced", "failed"
  erpSyncError: text("erp_sync_error"), // Error message if sync fails
  createdAt: timestamp("created_at").defaultNow(),
});

// Supabase Profile Schema
export const profiles = pgTable("profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  brelaNumber: text("brela_number").notNull(), // Company Registration Number (Brela)
  tinNumber: text("tin_number").notNull(), // Tax Identification Number
  userType: text("user_type").notNull(), // 'company' or 'licensed_trader'
  createdAt: timestamp("created_at").defaultNow(),
});

// Product Images - completely separate from eCount system
export const productImages = pgTable("product_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productCode: text("product_code").notNull().unique(), // eCount product code
  imageUrl: text("image_url").notNull(), // Cloudinary URL
  priority: integer("priority").default(0), // For multiple images per product
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Admin Sessions - persistent storage for admin login sessions
export const adminSessions = pgTable("admin_sessions", {
  id: varchar("id").primaryKey(), // Session token (UUID)
  userId: varchar("user_id").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("admin"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

// Product Mapping Cache - persistent storage of Excel product names for production deployments
export const productMappings = pgTable("product_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  normalizedCode: text("normalized_code").notNull().unique(), // Normalized product code
  originalCode: text("original_code").notNull(), // Original code from Excel
  name: text("name").notNull(), // Product name
  price: decimal("price", { precision: 10, scale: 2 }).notNull(), // Product price
  uom: text("uom").notNull(), // Unit of measure
  category: text("category"), // Product category
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
  companyName: true,
});

export const loginSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
});

// New Supabase Registration Schema with Tanzania phone validation
export const supabaseSignUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Company name is required"),
  phone: z.string().regex(/^(?:\+255|0)[67]\d{8}$/, "Please enter a valid Tanzania phone number (+255754231267 or 0754231267)"),
  address: z.string().min(1, "Address is required"),
  brela_number: z.string().min(1, "Company Registration Number (Brela) is required"),
  tin_number: z.string().min(1, "TIN Number is required"),
  user_type: z.enum(['company', 'licensed_trader'])
});

export const supabaseLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required")
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
});

export const insertInventorySchema = createInsertSchema(inventory).omit({
  id: true,
});

export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  orderNumber: true,
  createdAt: true,
  erpDocNumber: true,
  erpIoDate: true,
}).extend({
  // Customer fields are optional from frontend - backend auto-fills from user profile
  customerName: z.string().optional(),
  customerEmail: z.string().optional(),
  customerPhone: z.string().optional(),
  customerCompany: z.string().optional(),
  customerAddress: z.string().optional(),
});

export const insertProductImageSchema = createInsertSchema(productImages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type LoginUser = z.infer<typeof loginSchema>;
export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Inventory = typeof inventory.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;

// New Supabase types
export type SupabaseSignUp = z.infer<typeof supabaseSignUpSchema>;
export type SupabaseLogin = z.infer<typeof supabaseLoginSchema>;
export type Profile = typeof profiles.$inferSelect;
export type InsertInventory = z.infer<typeof insertInventorySchema>;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type ProductImage = typeof productImages.$inferSelect;
export type InsertProductImage = z.infer<typeof insertProductImageSchema>;
export type AdminSession = typeof adminSessions.$inferSelect;

// Extended types for API responses
export type ProductWithInventory = Product & {
  availableQuantity: number;
  expirationDate?: string;
  isLowStock?: boolean;
  isExpiringSoon?: boolean;
};

export type CartItem = {
  productId: string;
  name: string;
  price: string;
  quantity: number;
  referenceNumber: string;
  imageUrl?: string;
};

export type OrderItem = {
  productId: string;
  name: string;
  price: string;
  quantity: number;
  referenceNumber: string;
};
