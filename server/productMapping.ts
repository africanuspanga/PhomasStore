import * as XLSX from 'xlsx/xlsx.mjs';
import * as fs from 'fs';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { desc, sql } from 'drizzle-orm';
import { basename, extname, isAbsolute, join, resolve } from 'path';
import { productMappings } from '@shared/schema';
import { storage } from './storage.ts';
import { normalizeProductCode as normalizeCode } from './productCode.ts';

interface ProductMappingEntry {
  name: string;
  price: number;
  uom: string;
  category: string;
  originalCode: string;
  imageUrl: string | null;
}

interface ParsedProductMappingEntry extends ProductMappingEntry {
  normalizedCode: string;
}

interface MappingColumnMap {
  code: number;
  name: number;
  uom: number;
  price: number;
  image: number | null;
}

interface MappingConfig {
  excelPath: string;
  updatedAt: string;
}

/**
 * Product mapping from the admin Excel file.
 * In production we persist parsed rows to PostgreSQL so Vercel cold starts do not lose the mapping.
 */
export class ProductMapping {
  private static productMap = new Map<string, ProductMappingEntry>();

  private static isLoaded = false;
  private static unmatchedCodes: string[] = [];
  private static productsWithImages = 0;
  private static activeExcelPath: string | null = null;
  private static activeSourceLabel: string | null = null;
  private static lastLoadedAt: string | null = null;
  private static dbBootstrapAttempted = false;

  private static readonly defaultExcelPath = join(process.cwd(), 'attached_assets', 'All Items_1763921800571.xlsx');
  private static readonly configPath = join(process.cwd(), 'data', 'product-mapping-config.json');
  private static readonly databaseSourcePath = 'database://product_mappings';
  private static readonly temporaryUploadDir = join(os.tmpdir(), 'phomas-product-mappings');
  private static readonly allowedExtensions = new Set(['.xlsx', '.xls', '.csv']);

  private static normalizeProductCode(code: string): string {
    return normalizeCode(code);
  }

  static async ensureLoaded(): Promise<void> {
    if (this.isLoaded) return;
    await this.loadMapping();
  }

  static applyNames(products: any[]): any[] {
    this.unmatchedCodes = [];

    const ruleStats = {
      direct: 0,
      'no-letter-suffix': 0,
      'no-pack-suffix': 0,
      'digits-only': 0,
      unmatched: 0
    };

    const enrichedProducts = products.map(product => {
      const originalCode = product.id || product.PROD_CD;
      const mapping = this.getProduct(originalCode);

      if (mapping) {
        const rule = mapping.matchRule || 'direct';
        ruleStats[rule as keyof typeof ruleStats]++;

        return {
          ...product,
          name: mapping.name,
          price: mapping.price.toString(),
          packaging: mapping.uom,
          category: mapping.category
        };
      }

      ruleStats.unmatched++;
      this.unmatchedCodes.push(originalCode);
      return product;
    });

    const totalMatched = ruleStats.direct + ruleStats['no-letter-suffix'] + ruleStats['no-pack-suffix'] + ruleStats['digits-only'];

    console.log(`🎯 UNIFIED RESULTS: ${totalMatched}/${products.length} products matched (${ruleStats.unmatched} unmatched)`);
    console.log(`📊 Match Rules: Direct=${ruleStats.direct}, NoLetterSuffix=${ruleStats['no-letter-suffix']}, NoPackSuffix=${ruleStats['no-pack-suffix']}, DigitsOnly=${ruleStats['digits-only']}`);
    console.log(`🎉 Applied Excel names: ${totalMatched}/${products.length} products have REAL names from mapping!`);

    return enrichedProducts;
  }

  static getActiveExcelPath(): string | null {
    return this.activeExcelPath || this.resolveExcelPath();
  }

  static async setExcelFilePath(excelPath: string, options: { persistConfig?: boolean } = {}): Promise<void> {
    const normalizedPath = this.normalizeExcelPath(excelPath);
    const extension = extname(normalizedPath).toLowerCase();

    if (!this.allowedExtensions.has(extension)) {
      throw new Error('Invalid file type. Please upload .xlsx, .xls, or .csv');
    }

    if (!fs.existsSync(normalizedPath)) {
      throw new Error(`Excel file not found: ${normalizedPath}`);
    }

    const parsedEntries = this.parseExcelFile(normalizedPath);
    const persistedToDatabase = await this.persistMappingsToDatabase(parsedEntries);

    if (!persistedToDatabase && options.persistConfig !== false) {
      this.saveConfig(normalizedPath);
    }

    this.applyParsedEntries(parsedEntries, {
      activeExcelPath: persistedToDatabase ? this.databaseSourcePath : normalizedPath,
      sourceLabel: basename(normalizedPath),
      lastLoadedAt: new Date().toISOString()
    });
  }

  static async replaceUploadedExcel(params: {
    buffer: Buffer;
    originalName?: string;
  }): Promise<{
    fileName: string;
    filePath: string;
    storageMode: 'database' | 'temporary-file';
  }> {
    const originalName = params.originalName?.trim() || 'product-mapping.xlsx';
    const extension = extname(originalName).toLowerCase() || '.xlsx';

    if (!this.allowedExtensions.has(extension)) {
      throw new Error('Invalid file type. Please upload .xlsx, .xls, or .csv');
    }

    const parsedEntries = this.parseExcelBuffer(params.buffer);
    const persistedToDatabase = await this.persistMappingsToDatabase(parsedEntries);

    if (persistedToDatabase) {
      this.applyParsedEntries(parsedEntries, {
        activeExcelPath: this.databaseSourcePath,
        sourceLabel: originalName,
        lastLoadedAt: new Date().toISOString()
      });

      return {
        fileName: originalName,
        filePath: this.databaseSourcePath,
        storageMode: 'database'
      };
    }

    const temporaryFilePath = this.writeTemporaryUpload(params.buffer, originalName);
    this.applyParsedEntries(parsedEntries, {
      activeExcelPath: temporaryFilePath,
      sourceLabel: basename(temporaryFilePath),
      lastLoadedAt: new Date().toISOString()
    });

    return {
      fileName: basename(temporaryFilePath),
      filePath: temporaryFilePath,
      storageMode: 'temporary-file'
    };
  }

  static resetMapping(): void {
    this.productMap.clear();
    this.unmatchedCodes = [];
    this.productsWithImages = 0;
    this.activeExcelPath = null;
    this.activeSourceLabel = null;
    this.isLoaded = false;
    this.lastLoadedAt = null;
  }

  static getImageMappings(): Array<{ code: string; imageUrl: string }> {
    const mappingByCode = new Map<string, string>();

    this.productMap.forEach((value, key) => {
      if (value.imageUrl) {
        const originalCode = (value.originalCode || '').toString().trim();
        if (originalCode) {
          mappingByCode.set(originalCode, value.imageUrl);
        }

        mappingByCode.set(key, value.imageUrl);
      }
    });

    return Array.from(mappingByCode.entries()).map(([code, imageUrl]) => ({
      code,
      imageUrl
    }));
  }

  static async loadMapping(forceReload: boolean = false): Promise<void> {
    if (this.isLoaded && !forceReload) return;

    try {
      console.log('📋 Loading REAL product names from user Excel file...');
      this.resetMapping();

      const loadedFromDatabase = await this.loadMappingFromDatabase();
      if (loadedFromDatabase) {
        return;
      }

      const excelPath = this.resolveExcelPath();
      console.log('📁 Excel file path:', excelPath);

      if (!excelPath || !fs.existsSync(excelPath)) {
        console.warn('⚠️ Excel file not found - products will use fallback names');
        if (excelPath) {
          console.warn(`   Looking for: ${excelPath}`);
        }
        this.activeExcelPath = null;
        this.activeSourceLabel = null;
        this.lastLoadedAt = null;
        this.isLoaded = true;
        return;
      }

      console.log('📁 Excel file found, loading...');
      const parsedEntries = this.parseExcelFile(excelPath);
      this.applyParsedEntries(parsedEntries, {
        activeExcelPath: excelPath,
        sourceLabel: basename(excelPath),
        lastLoadedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Failed to load product mapping:', error);
      this.activeExcelPath = null;
      this.activeSourceLabel = null;
      this.lastLoadedAt = null;
      this.isLoaded = true;
    }
  }

  static getProduct(code: string): {
    name: string;
    price: number;
    uom: string;
    category: string;
    originalCode: string;
    imageUrl: string | null;
    matchRule?: string;
  } | null {
    const normalizedCode = this.normalizeProductCode(code);

    let product = this.productMap.get(normalizedCode);
    if (product) {
      return { ...product, matchRule: 'direct' };
    }

    const withoutLetterSuffix = normalizedCode.replace(/[A-Z]+$/, '');
    if (withoutLetterSuffix !== normalizedCode) {
      product = this.productMap.get(withoutLetterSuffix);
      if (product) {
        return { ...product, matchRule: 'no-letter-suffix' };
      }
    }

    const withoutPackSize = normalizedCode.replace(/\d+[A-Z]+$/, '');
    if (withoutPackSize !== normalizedCode && withoutPackSize !== withoutLetterSuffix) {
      product = this.productMap.get(withoutPackSize);
      if (product) {
        return { ...product, matchRule: 'no-pack-suffix' };
      }
    }

    const digitsOnly = normalizedCode.replace(/\D/g, '');
    if (digitsOnly !== normalizedCode && digitsOnly.length >= 4) {
      const candidates = Array.from(this.productMap.keys()).filter(key =>
        key.replace(/\D/g, '') === digitsOnly
      );
      if (candidates.length === 1) {
        product = this.productMap.get(candidates[0]);
        if (product) {
          return { ...product, matchRule: 'digits-only' };
        }
      }
    }

    return null;
  }

  static getMappedCodes(): string[] {
    return Array.from(this.productMap.keys());
  }

  static getAllMappedProducts(): Array<{
    code: string;
    name: string;
    price: number;
    uom: string;
    category: string;
    originalCode: string;
    imageUrl: string | null;
  }> {
    const products: Array<{
      code: string;
      name: string;
      price: number;
      uom: string;
      category: string;
      originalCode: string;
      imageUrl: string | null;
    }> = [];

    this.productMap.forEach((value, key) => {
      products.push({
        code: key,
        ...value
      });
    });

    return products;
  }

  static getStats() {
    const activeExcelPath = this.getActiveExcelPath();
    const activeExcelFileName = this.activeSourceLabel ||
      (activeExcelPath === this.databaseSourcePath
        ? 'Supabase Product Mapping'
        : (activeExcelPath ? basename(activeExcelPath) : null));

    return {
      totalMapped: this.productMap.size,
      isLoaded: this.isLoaded,
      unmatchedCount: this.unmatchedCodes.length,
      productsWithImages: this.productsWithImages,
      activeExcelPath,
      activeExcelFileName,
      lastLoadedAt: this.lastLoadedAt
    };
  }

  static getDiagnostics() {
    return {
      totalExcelCodes: this.productMap.size,
      unmatchedCodes: this.unmatchedCodes,
      sampleExcelCodes: Array.from(this.productMap.keys()).slice(0, 10),
      sampleUnmatched: this.unmatchedCodes.slice(0, 10).map(code => ({
        original: code,
        normalized: this.normalizeProductCode(code)
      })),
      stats: this.getStats()
    };
  }

  private static applyParsedEntries(
    parsedEntries: ParsedProductMappingEntry[],
    options: {
      activeExcelPath: string;
      sourceLabel: string;
      lastLoadedAt: string;
    }
  ): void {
    const nextMap = new Map<string, ProductMappingEntry>();

    for (const entry of parsedEntries) {
      nextMap.set(entry.normalizedCode, {
        name: entry.name,
        price: entry.price,
        uom: entry.uom,
        category: entry.category,
        originalCode: entry.originalCode,
        imageUrl: entry.imageUrl
      });
    }

    this.productMap = nextMap;
    this.unmatchedCodes = [];
    this.productsWithImages = Array.from(nextMap.values()).filter((entry) => !!entry.imageUrl).length;
    this.activeExcelPath = options.activeExcelPath;
    this.activeSourceLabel = options.sourceLabel;
    this.lastLoadedAt = options.lastLoadedAt;
    this.isLoaded = true;

    console.log(`✅ Loaded ${this.productMap.size} product names into active mapping`);
    if (this.productsWithImages > 0) {
      console.log(`🖼️ Found ${this.productsWithImages} products with image URLs in active mapping`);
    }
  }

  private static parseExcelFile(excelPath: string): ParsedProductMappingEntry[] {
    XLSX.set_fs(fs);
    const workbook = XLSX.readFile(excelPath);
    return this.parseWorkbook(workbook);
  }

  private static parseExcelBuffer(buffer: Buffer): ParsedProductMappingEntry[] {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    return this.parseWorkbook(workbook);
  }

  private static parseWorkbook(workbook: any): ParsedProductMappingEntry[] {
    console.log('📄 Available sheets:', workbook.SheetNames);

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('Excel file does not contain any sheets');
    }

    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as Array<(string | number)[]>;
    console.log('📊 Total raw rows:', rawRows.length);

    let headerRowIndex = -1;
    let columnMap: MappingColumnMap | null = null;

    for (let i = 0; i < Math.min(15, rawRows.length); i++) {
      const row = rawRows[i] as (string | number)[];
      const rowText = row.map(cell => cell?.toString()?.toLowerCase()?.trim() || '');

      const codeCol = rowText.findIndex(cell =>
        (cell.includes('item') && cell.includes('code')) ||
        (cell.includes('product') && cell.includes('code')) ||
        cell === 'itemcode' ||
        cell === 'prod_cd' ||
        cell === 'code'
      );
      const nameCol = rowText.findIndex(cell =>
        (cell.includes('item') && cell.includes('name')) ||
        (cell.includes('product') && cell.includes('name')) ||
        cell === 'itemname' ||
        cell === 'name'
      );

      if (codeCol >= 0 && nameCol >= 0) {
        headerRowIndex = i;
        columnMap = {
          code: codeCol,
          name: nameCol,
          uom: (() => {
            const idx = rowText.findIndex(cell => cell === 'uom' || cell === 'unit');
            return idx === -1 ? nameCol + 1 : idx;
          })(),
          price: (() => {
            const idx = rowText.findIndex(cell =>
              cell.includes('price') ||
              cell.includes('sales') ||
              cell.includes('amount') ||
              cell.includes('rate')
            );
            return idx === -1 ? nameCol + 2 : idx;
          })(),
          image: (() => {
            const idx = rowText.findIndex(cell =>
              cell.includes('image') ||
              cell.includes('img') ||
              cell.includes('photo') ||
              cell.includes('picture') ||
              cell.includes('url') ||
              cell.includes('link')
            );
            return idx === -1 ? null : idx;
          })()
        };
        break;
      }
    }

    if (headerRowIndex === -1 || !columnMap) {
      throw new Error('Could not find header row');
    }

    const parsedEntries: ParsedProductMappingEntry[] = [];
    let processed = 0;

    for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
      const row = rawRows[i] as (string | number)[];

      const code = row[columnMap.code]?.toString()?.trim();
      const name = row[columnMap.name]?.toString()?.trim();
      const uom = row[columnMap.uom]?.toString()?.trim();
      const price = this.parsePrice(row[columnMap.price]);
      const imageUrl = columnMap.image !== null
        ? this.parseImageUrl(row[columnMap.image])
        : null;

      if (code && name && code.length > 0 && name.length > 0) {
        parsedEntries.push({
          normalizedCode: this.normalizeProductCode(code),
          name,
          price,
          uom: uom || 'Standard',
          category: this.getCategoryFromName(name),
          originalCode: code,
          imageUrl
        });
        processed++;
      }
    }

    console.log(`✅ Processed ${processed} rows, parsed ${parsedEntries.length} candidate mappings from Excel`);

    if (parsedEntries.length === 0) {
      throw new Error('Uploaded Excel file did not produce any product mappings');
    }

    return parsedEntries;
  }

  private static async ensureDatabaseTable(): Promise<boolean> {
    if (this.dbBootstrapAttempted) {
      return !!storage.getDb();
    }

    this.dbBootstrapAttempted = true;
    const db = storage.getDb();

    if (!db) {
      return false;
    }

    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS product_mappings (
          id varchar PRIMARY KEY,
          normalized_code text NOT NULL UNIQUE,
          original_code text NOT NULL,
          name text NOT NULL,
          price numeric(10, 2) NOT NULL,
          uom text NOT NULL,
          category text,
          created_at timestamp DEFAULT now(),
          updated_at timestamp DEFAULT now()
        )
      `);

      return true;
    } catch (error) {
      console.warn('⚠️ Failed to ensure product_mappings table exists:', error);
      return false;
    }
  }

  private static async persistMappingsToDatabase(parsedEntries: ParsedProductMappingEntry[]): Promise<boolean> {
    const db = storage.getDb();
    const canUseDatabase = db && await this.ensureDatabaseTable();

    if (!canUseDatabase) {
      return false;
    }

    const now = new Date();

    try {
      await db.transaction(async (tx: any) => {
        await tx.delete(productMappings);

        const batchSize = 250;
        for (let i = 0; i < parsedEntries.length; i += batchSize) {
          const batch = parsedEntries.slice(i, i + batchSize);
          await tx.insert(productMappings).values(
            batch.map((entry) => ({
              id: randomUUID(),
              normalizedCode: entry.normalizedCode,
              originalCode: entry.originalCode,
              name: entry.name,
              price: entry.price.toFixed(2),
              uom: entry.uom,
              category: entry.category,
              createdAt: now,
              updatedAt: now
            }))
          );
        }
      });

      console.log(`💾 Persisted ${parsedEntries.length} product mappings to PostgreSQL`);
      return true;
    } catch (error) {
      console.warn('⚠️ Failed to persist product mappings to PostgreSQL:', error);
      return false;
    }
  }

  private static async loadMappingFromDatabase(): Promise<boolean> {
    const db = storage.getDb();
    const canUseDatabase = db && await this.ensureDatabaseTable();

    if (!canUseDatabase) {
      return false;
    }

    try {
      const rows = await db
        .select()
        .from(productMappings)
        .orderBy(desc(productMappings.updatedAt));

      if (!rows.length) {
        return false;
      }

      const parsedEntries: ParsedProductMappingEntry[] = rows.map((row: any) => ({
        normalizedCode: row.normalizedCode,
        originalCode: row.originalCode,
        name: row.name,
        price: this.parsePrice(row.price),
        uom: row.uom,
        category: row.category || this.getCategoryFromName(row.name),
        imageUrl: null
      }));

      const latestUpdatedAt = rows[0]?.updatedAt instanceof Date
        ? rows[0].updatedAt.toISOString()
        : new Date().toISOString();

      this.applyParsedEntries(parsedEntries, {
        activeExcelPath: this.databaseSourcePath,
        sourceLabel: 'Supabase Product Mapping',
        lastLoadedAt: latestUpdatedAt
      });

      console.log(`🗄️ Loaded ${parsedEntries.length} product mappings from PostgreSQL`);
      return true;
    } catch (error) {
      console.warn('⚠️ Failed to load product mappings from PostgreSQL:', error);
      return false;
    }
  }

  private static parsePrice(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (value === null || value === undefined) {
      return 25000;
    }

    const cleaned = value.toString().replace(/,/g, '').trim();
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 25000;
  }

  private static parseImageUrl(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    const imageUrl = value.toString().trim();
    if (!imageUrl) {
      return null;
    }

    return /^https?:\/\//i.test(imageUrl) ? imageUrl : null;
  }

  private static normalizeExcelPath(excelPath: string): string {
    return isAbsolute(excelPath) ? excelPath : resolve(process.cwd(), excelPath);
  }

  private static resolveExcelPath(): string | null {
    const configuredPath = this.readConfiguredPath();
    if (configuredPath && fs.existsSync(configuredPath)) {
      return configuredPath;
    }

    if (fs.existsSync(this.defaultExcelPath)) {
      return this.defaultExcelPath;
    }

    return this.findLatestExcelInAttachedAssets();
  }

  private static readConfiguredPath(): string | null {
    try {
      if (!fs.existsSync(this.configPath)) {
        return null;
      }

      const raw = fs.readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<MappingConfig>;
      if (!parsed.excelPath) {
        return null;
      }

      return this.normalizeExcelPath(parsed.excelPath);
    } catch (error) {
      console.warn('⚠️ Failed to read product mapping config:', error);
      return null;
    }
  }

  private static saveConfig(excelPath: string): void {
    const configDir = join(process.cwd(), 'data');

    try {
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      const config: MappingConfig = {
        excelPath,
        updatedAt: new Date().toISOString()
      };

      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
      console.log(`💾 Updated product mapping config: ${excelPath}`);
    } catch (error) {
      console.warn('⚠️ Failed to save product mapping config:', error);
    }
  }

  private static writeTemporaryUpload(buffer: Buffer, originalName: string): string {
    if (!fs.existsSync(this.temporaryUploadDir)) {
      fs.mkdirSync(this.temporaryUploadDir, { recursive: true });
    }

    const extension = extname(originalName).toLowerCase() || '.xlsx';
    const safeBaseName = basename(originalName, extension)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 80) || 'product_mapping';
    const fileName = `${safeBaseName}_${Date.now()}${extension}`;
    const filePath = join(this.temporaryUploadDir, fileName);

    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  private static findLatestExcelInAttachedAssets(): string | null {
    const assetsDir = join(process.cwd(), 'attached_assets');
    if (!fs.existsSync(assetsDir)) {
      return null;
    }

    const candidates = fs.readdirSync(assetsDir)
      .filter(file => this.allowedExtensions.has(extname(file).toLowerCase()))
      .map(file => {
        const fullPath = join(assetsDir, file);
        const stat = fs.statSync(fullPath);
        const lower = file.toLowerCase();
        const score = lower.includes('all items') || lower.includes('phomas')
          ? 2
          : (lower.includes('item') || lower.includes('product') ? 1 : 0);

        return {
          fullPath,
          score,
          mtimeMs: stat.mtimeMs
        };
      })
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return b.mtimeMs - a.mtimeMs;
      });

    return candidates.length > 0 ? candidates[0].fullPath : null;
  }

  private static getCategoryFromName(name: string): string {
    const nameLower = name.toLowerCase();

    if (nameLower.includes('sanitizer') || nameLower.includes('disinfect')) return 'Sanitizers & Disinfectants';
    if (nameLower.includes('acid') || nameLower.includes('chemical')) return 'Laboratory Chemicals';
    if (nameLower.includes('test') || nameLower.includes('kit')) return 'Test Kits';
    if (nameLower.includes('syringe') || nameLower.includes('needle')) return 'Medical Devices';
    if (nameLower.includes('glove') || nameLower.includes('mask')) return 'PPE & Safety';
    if (nameLower.includes('tablet') || nameLower.includes('capsule')) return 'Pharmaceuticals';
    if (nameLower.includes('bandage') || nameLower.includes('cotton')) return 'Wound Care';

    return 'Medical Supplies';
  }
}
