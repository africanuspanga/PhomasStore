import * as XLSX from 'xlsx/xlsx.mjs';
import * as fs from 'fs';
import { basename, extname, isAbsolute, join, resolve } from 'path';

interface ProductMappingEntry {
  name: string;
  price: number;
  uom: string;
  category: string;
  originalCode: string;
  imageUrl: string | null;
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
 * Product mapping from user's Excel file with real product names and prices
 * Loads from Excel in development - persists in memory during runtime
 */
export class ProductMapping {
  private static productMap = new Map<string, ProductMappingEntry>();
  
  private static isLoaded = false;
  private static unmatchedCodes: string[] = [];
  private static productsWithImages = 0;
  private static activeExcelPath: string | null = null;
  private static lastLoadedAt: string | null = null;

  private static readonly defaultExcelPath = join(process.cwd(), 'attached_assets', 'All Items_1763921800571.xlsx');
  private static readonly configPath = join(process.cwd(), 'data', 'product-mapping-config.json');
  private static readonly allowedExtensions = new Set(['.xlsx', '.xls', '.csv']);

  /**
   * Normalize product codes for consistent matching
   */
  private static normalizeProductCode(code: string): string {
    if (!code) return '';
    
    return code
      .toString()
      .trim()
      .replace(/[-\s]/g, '')
      .replace(/^0+/, '')
      .toUpperCase();
  }

  /**
   * Ensure mapping is loaded (lazy loading)
   */
  static async ensureLoaded(): Promise<void> {
    if (this.isLoaded) return;
    await this.loadMapping();
  }

  /**
   * Apply real names from Excel to any product list
   */
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
      } else {
        ruleStats.unmatched++;
        this.unmatchedCodes.push(originalCode);
        return product;
      }
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

  static async setExcelFilePath(excelPath: string): Promise<void> {
    const normalizedPath = this.normalizeExcelPath(excelPath);
    const extension = extname(normalizedPath).toLowerCase();
    const previousPath = this.readConfiguredPath();

    if (!this.allowedExtensions.has(extension)) {
      throw new Error('Invalid file type. Please upload .xlsx, .xls, or .csv');
    }

    if (!fs.existsSync(normalizedPath)) {
      throw new Error(`Excel file not found: ${normalizedPath}`);
    }

    this.saveConfig(normalizedPath);
    await this.loadMapping(true);

    if (this.productMap.size === 0) {
      if (previousPath && fs.existsSync(previousPath)) {
        this.saveConfig(previousPath);
        await this.loadMapping(true);
      }
      throw new Error('Uploaded Excel file did not produce any product mappings');
    }
  }

  static resetMapping(): void {
    this.productMap.clear();
    this.unmatchedCodes = [];
    this.productsWithImages = 0;
    this.activeExcelPath = null;
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

        // Also save by normalized code to handle format differences.
        mappingByCode.set(key, value.imageUrl);
      }
    });

    return Array.from(mappingByCode.entries()).map(([code, imageUrl]) => ({
      code,
      imageUrl
    }));
  }

  /**
   * Load product mapping from Excel file
   */
  static async loadMapping(forceReload: boolean = false): Promise<void> {
    if (this.isLoaded && !forceReload) return;

    try {
      console.log('📋 Loading REAL product names from user Excel file...');
      this.productMap.clear();
      this.unmatchedCodes = [];
      this.productsWithImages = 0;

      const excelPath = this.resolveExcelPath();
      console.log('📁 Excel file path:', excelPath);
      
      if (!excelPath || !fs.existsSync(excelPath)) {
        console.warn('⚠️ Excel file not found - products will use fallback names');
        if (excelPath) {
          console.warn(`   Looking for: ${excelPath}`);
        }
        this.activeExcelPath = null;
        this.lastLoadedAt = null;
        this.isLoaded = true;
        return;
      }

      console.log('📁 Excel file found, loading...');
      
      XLSX.set_fs(fs);
      
      const workbook = XLSX.readFile(excelPath);
      console.log('📄 Available sheets:', workbook.SheetNames);
      
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      const rawRows = XLSX.utils.sheet_to_json<(string | number)[]>(worksheet, { header: 1, defval: '' });
      console.log('📊 Total raw rows:', rawRows.length);
      
      // Find header row
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
      
      // Process data rows
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
          const normalizedCode = this.normalizeProductCode(code);
          
          this.productMap.set(normalizedCode, {
            name,
            price,
            uom: uom || 'Standard',
            category: this.getCategoryFromName(name),
            originalCode: code,
            imageUrl
          });

          if (imageUrl) {
            this.productsWithImages++;
          }
          processed++;
        }
      }

      console.log(`✅ Processed ${processed} rows, loaded ${this.productMap.size} product names from Excel!`);
      if (this.productsWithImages > 0) {
        console.log(`🖼️ Found ${this.productsWithImages} products with image URLs in Excel`);
      }

      this.activeExcelPath = excelPath;
      this.lastLoadedAt = new Date().toISOString();
      this.isLoaded = true;
      
    } catch (error) {
      console.error('❌ Failed to load product mapping:', error);
      this.activeExcelPath = null;
      this.lastLoadedAt = null;
      this.isLoaded = true;
    }
  }

  /**
   * Get real product data by code
   */
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

  /**
   * Get all mapped product codes
   */
  static getMappedCodes(): string[] {
    return Array.from(this.productMap.keys());
  }

  /**
   * Get all mapped products
   */
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

  /**
   * Get statistics
   */
  static getStats() {
    const activeExcelPath = this.getActiveExcelPath();

    return {
      totalMapped: this.productMap.size,
      isLoaded: this.isLoaded,
      unmatchedCount: this.unmatchedCodes.length,
      productsWithImages: this.productsWithImages,
      activeExcelPath,
      activeExcelFileName: activeExcelPath ? basename(activeExcelPath) : null,
      lastLoadedAt: this.lastLoadedAt
    };
  }

  /**
   * Get diagnostics
   */
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
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const config: MappingConfig = {
      excelPath,
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log(`💾 Updated product mapping config: ${excelPath}`);
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

  /**
   * Smart category detection
   */
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
