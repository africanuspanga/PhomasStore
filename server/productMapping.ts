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
      console.log('📁 Excel file path:', excelPath);
      
      const workbook = XLSX.readFile(excelPath);
      const sheetName = workbook.SheetNames[0];
      console.log('📄 Sheet name:', sheetName);
      
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);
      console.log('📊 Total rows from Excel:', data.length);
      
      if (data.length > 0) {
        console.log('🔍 First row structure:', Object.keys(data[0]));
        console.log('🔍 First row data:', data[0]);
      }

      // Don't skip header - process all data
      const productRows = data;
      let processed = 0;
      
      productRows.forEach((row: any, index: number) => {
        const code = row['Item Code']?.toString()?.trim() || row.__EMPTY?.toString()?.trim();
        const name = row['Item Name']?.toString()?.trim() || row.__EMPTY_1?.toString()?.trim();
        const uom = row['UOM']?.toString()?.trim() || row.__EMPTY_2?.toString()?.trim();
        const price = parseFloat(row['Sales Price']?.toString() || row.__EMPTY_6?.toString() || '0') || 25000;
        
        if (index < 3) {
          console.log(`🔍 Row ${index}:`, { code, name, uom, price });
        }
        
        if (code && name && code !== 'Item Code') { // Skip header row
          this.productMap.set(code, {
            name,
            price,
            uom: uom || 'Standard',
            category: this.getCategoryFromName(name)
          });
          processed++;
        }
      });

      console.log(`✅ Processed ${processed} rows, loaded ${this.productMap.size} REAL product names from Excel file!`);
      
      // Show sample products
      const sampleCodes = Array.from(this.productMap.keys()).slice(0, 3);
      sampleCodes.forEach(code => {
        const product = this.productMap.get(code);
        console.log(`📦 Sample: ${code} -> "${product?.name}" (${product?.price})`);
      });
      
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