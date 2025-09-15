const XLSX = require('xlsx');
import { join } from 'path';

/**
 * Product mapping from user's Excel file with real product names and prices
 * This replaces API calls that return 500 errors with actual product data
 */
export class ProductMapping {
  private static productMap = new Map<string, {
    name: string;
    price: number;
    uom: string;
    category: string;
  }>();
  
  private static isLoaded = false;

  /**
   * Load product mapping from user's Excel file
   */
  static async loadMapping(): Promise<void> {
    if (this.isLoaded) return;

    try {
      console.log('📋 Loading REAL product names from user Excel file...');
      
      const excelPath = join(process.cwd(), 'attached_assets', 'Items with Lot_1757979367190.xlsx');
      const workbook = XLSX.readFile(excelPath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);

      // Skip header row and process product data
      const productRows = data.slice(1);
      
      productRows.forEach((row: any) => {
        const code = row.__EMPTY?.toString()?.trim();
        const name = row.__EMPTY_1?.toString()?.trim();
        const uom = row.__EMPTY_2?.toString()?.trim();
        const price = parseFloat(row.__EMPTY_6?.toString() || '0') || 25000;
        
        if (code && name) {
          this.productMap.set(code, {
            name,
            price,
            uom: uom || 'Standard',
            category: this.getCategoryFromName(name)
          });
        }
      });

      console.log(`✅ Loaded ${this.productMap.size} REAL product names from Excel file!`);
      this.isLoaded = true;
      
    } catch (error) {
      console.error('❌ Failed to load product mapping:', error);
      this.isLoaded = true; // Don't retry
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
  } | null {
    return this.productMap.get(code) || null;
  }

  /**
   * Get all mapped product codes
   */
  static getMappedCodes(): string[] {
    return Array.from(this.productMap.keys());
  }

  /**
   * Get statistics about the mapping
   */
  static getStats() {
    return {
      totalMapped: this.productMap.size,
      isLoaded: this.isLoaded
    };
  }

  /**
   * Smart category detection from product name
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