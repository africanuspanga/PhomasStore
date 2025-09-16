import * as XLSX from 'xlsx/xlsx.mjs';
import * as fs from 'fs';
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
    originalCode: string; // Keep track of original code for debugging
  }>();
  
  private static isLoaded = false;
  private static unmatchedCodes: string[] = []; // Track codes that don't match

  /**
   * Normalize product codes for consistent matching
   * Removes leading zeros, hyphens, spaces, converts to uppercase
   */
  private static normalizeProductCode(code: string): string {
    if (!code) return '';
    
    return code
      .toString()
      .trim()                    // Remove leading/trailing spaces
      .replace(/[-\s]/g, '')     // Remove hyphens and spaces
      .replace(/^0+/, '')        // Remove leading zeros
      .toUpperCase();            // Convert to uppercase for consistency
  }

  /**
   * Ensure mapping is loaded (lazy loading)
   */
  static async ensureLoaded(): Promise<void> {
    if (this.isLoaded) return;
    await this.loadMapping();
  }

  /**
   * Apply real names from Excel to any product list (cache or fresh)
   */
  static applyNames(products: any[]): any[] {
    this.unmatchedCodes = []; // Reset unmatched codes for this run
    let matchedCount = 0;
    let unmatchedCount = 0;
    
    const enrichedProducts = products.map(product => {
      const originalCode = product.id || product.PROD_CD;
      const normalizedCode = this.normalizeProductCode(originalCode);
      const mapping = this.getProduct(originalCode);
      
      if (mapping) {
        matchedCount++;
        return {
          ...product,
          name: mapping.name,
          price: mapping.price.toString(),
          packaging: mapping.uom,
          category: mapping.category
        };
      } else {
        unmatchedCount++;
        this.unmatchedCodes.push(originalCode);
        return product;
      }
    });
    
    console.log(`🎯 Matching results: ${matchedCount}/${products.length} products matched (${unmatchedCount} unmatched)`);
    
    // Show first few unmatched codes for debugging
    if (this.unmatchedCodes.length > 0) {
      const sampleUnmatched = this.unmatchedCodes.slice(0, 5);
      console.log(`❌ Sample unmatched codes:`, sampleUnmatched.map(code => `"${code}" -> "${this.normalizeProductCode(code)}"`));
      
      // Show sample Excel codes for comparison
      const sampleExcelCodes = Array.from(this.productMap.keys()).slice(0, 5);
      console.log(`✅ Sample Excel codes:`, sampleExcelCodes);
    }
    
    return enrichedProducts;
  }

  /**
   * Load product mapping from user's Excel file with robust ESM approach
   */
  static async loadMapping(): Promise<void> {
    if (this.isLoaded) return;

    try {
      console.log('📋 Loading REAL product names from user Excel file...');
      
      const excelPath = join(process.cwd(), 'attached_assets', 'Phomas Store_1757981102948.xlsx');
      console.log('📁 Excel file path:', excelPath);
      console.log('📁 File exists:', fs.existsSync(excelPath));
      
      // Set filesystem for XLSX in Node ESM environment
      XLSX.set_fs(fs);
      
      const workbook = XLSX.readFile(excelPath);
      console.log('📄 Available sheets:', workbook.SheetNames);
      
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      // Get raw rows as arrays to detect header
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
      console.log('📊 Total raw rows:', rawRows.length);
      
      if (rawRows.length > 0) {
        console.log('🔍 First 3 raw rows:', rawRows.slice(0, 3));
      }
      
      // Find header row containing both "Item Code" and "Item Name"
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
            uom: rowText.findIndex(cell => cell === 'uom' || cell === 'unit') || nameCol + 1,
            price: rowText.findIndex(cell => cell.includes('price') || cell.includes('sales')) || nameCol + 2
          };
          console.log(`🎯 Found header at row ${i}:`, row);
          console.log('🗂️ Column mapping:', columnMap);
          break;
        }
      }
      
      if (headerRowIndex === -1) {
        throw new Error('Could not find header row with Item Code and Item Name columns');
      }
      
      // Process data rows after header
      let processed = 0;
      for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
        const row = rawRows[i] as string[];
        
        const code = row[columnMap.code]?.toString()?.trim();
        const name = row[columnMap.name]?.toString()?.trim();
        const uom = row[columnMap.uom]?.toString()?.trim();
        const price = parseFloat(row[columnMap.price]?.toString() || '0') || 25000;
        
        if (processed < 3) {
          console.log(`🔍 Data row ${i}:`, { code, name, uom, price });
        }
        
        if (code && name && code.length > 0 && name.length > 0) {
          const normalizedCode = this.normalizeProductCode(code);
          
          if (processed < 3) {
            console.log(`🔧 Code normalization: "${code}" -> "${normalizedCode}"`);
          }
          
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
      // Don't mark as loaded on failure - allow retries
      this.isLoaded = false;
    }
  }

  /**
   * Get real product data by code (with normalization)
   */
  static getProduct(code: string): {
    name: string;
    price: number;
    uom: string;
    category: string;
    originalCode: string;
  } | null {
    const normalizedCode = this.normalizeProductCode(code);
    return this.productMap.get(normalizedCode) || null;
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
      isLoaded: this.isLoaded,
      unmatchedCount: this.unmatchedCodes.length
    };
  }

  /**
   * Get diagnostic information about code matching
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