import * as XLSX from 'xlsx/xlsx.mjs';
import * as fs from 'fs';
import { join } from 'path';

/**
 * Product mapping from user's Excel file with real product names and prices
 * Loads from Excel in development - persists in memory during runtime
 */
export class ProductMapping {
  private static productMap = new Map<string, {
    name: string;
    price: number;
    uom: string;
    category: string;
    originalCode: string;
  }>();
  
  private static isLoaded = false;
  private static unmatchedCodes: string[] = [];

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


  /**
   * Load product mapping from Excel file
   */
  static async loadMapping(): Promise<void> {
    if (this.isLoaded) return;

    try {
      console.log('📋 Loading REAL product names from user Excel file...');
      
      const excelPath = join(process.cwd(), 'attached_assets', 'All Items_1763921800571.xlsx');
      console.log('📁 Excel file path:', excelPath);
      
      if (!fs.existsSync(excelPath)) {
        console.warn('⚠️ Excel file not found - products will use fallback names');
        console.warn(`   Looking for: ${excelPath}`);
        this.isLoaded = true;
        return;
      }

      console.log('📁 Excel file found, loading...');
      
      XLSX.set_fs(fs);
      
      const workbook = XLSX.readFile(excelPath);
      console.log('📄 Available sheets:', workbook.SheetNames);
      
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
      console.log('📊 Total raw rows:', rawRows.length);
      
      // Find header row
      let headerRowIndex = -1;
      let columnMap: any = {};
      
      for (let i = 0; i < Math.min(5, rawRows.length); i++) {
        const row = rawRows[i] as string[];
        const rowText = row.map(cell => cell?.toString()?.toLowerCase()?.trim() || '');
        
        const codeCol = rowText.findIndex(cell => 
          cell.includes('item') && cell.includes('code') || 
          cell === 'itemcode' || 
          cell === 'code'
        );
        const nameCol = rowText.findIndex(cell => 
          cell.includes('item') && cell.includes('name') || 
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
              const idx = rowText.findIndex(cell => cell.includes('price') || cell.includes('sales'));
              return idx === -1 ? nameCol + 2 : idx;
            })()
          };
          break;
        }
      }
      
      if (headerRowIndex === -1) {
        throw new Error('Could not find header row');
      }
      
      // Process data rows
      let processed = 0;
      for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
        const row = rawRows[i] as string[];
        
        const code = row[columnMap.code]?.toString()?.trim();
        const name = row[columnMap.name]?.toString()?.trim();
        const uom = row[columnMap.uom]?.toString()?.trim();
        const price = parseFloat(row[columnMap.price]?.toString() || '0') || 25000;
        
        if (code && name && code.length > 0 && name.length > 0) {
          const normalizedCode = this.normalizeProductCode(code);
          
          this.productMap.set(normalizedCode, {
            name,
            price,
            uom: uom || 'Standard',
            category: this.getCategoryFromName(name),
            originalCode: code
          });
          processed++;
        }
      }

      console.log(`✅ Processed ${processed} rows, loaded ${this.productMap.size} product names from Excel!`);
      this.isLoaded = true;
      
    } catch (error) {
      console.error('❌ Failed to load product mapping:', error);
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
  }> {
    const products: Array<any> = [];
    
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
    return {
      totalMapped: this.productMap.size,
      isLoaded: this.isLoaded,
      unmatchedCount: this.unmatchedCodes.length
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
      }))
    };
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
