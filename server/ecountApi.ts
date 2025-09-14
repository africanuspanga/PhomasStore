import type { ProductWithInventory, Order } from "@shared/schema";

// eCount API Configuration
const ECOUNT_CONFIG = {
  companyCode: process.env.ECOUNT_COMPANY_CODE!,
  testAuthKey: process.env.ECOUNT_TEST_AUTH_KEY!,
  userId: process.env.ECOUNT_USER_ID!,
  zone: process.env.ECOUNT_ZONE!,
  warehouseCode: process.env.ECOUNT_WAREHOUSE_CODE!,
};

const TEST_BASE_URL = "https://sboapi{ZONE}.ecount.com";
const PROD_BASE_URL = "https://oapi{ZONE}.ecount.com";

interface EcountSession {
  sessionId: string;
  expiresAt: Date;
  zone: string;
}

interface EcountProduct {
  PROD_CD: string;
  PROD_DES: string;
  SIZE_DES: string;
  PRICE: string;
  CATEGORY?: string;
}

interface EcountInventory {
  PROD_CD: string;
  BAL_QTY: number;
  WH_CD?: string;
}

interface EcountApiResponse {
  Status: string;
  Data?: any;
  Error?: {
    Message: string;
  };
}

interface EcountApiRequestOptions {
  endpoint: string;
  body: any;
  requiresAuth?: boolean;
}

class EcountApiService {
  private session: EcountSession | null = null;
  private baseUrl: string;

  constructor() {
    // Use test URL for now
    this.baseUrl = TEST_BASE_URL;
  }

  /**
   * Centralized eCount API request helper with JSON validation and auto-retry
   */
  private async ecountRequest(options: EcountApiRequestOptions): Promise<EcountApiResponse> {
    const { endpoint, body, requiresAuth = true } = options;
    
    // Get session and zone if auth is required
    let sessionId = '';
    let zone = ECOUNT_CONFIG.zone; // fallback
    
    if (requiresAuth) {
      sessionId = await this.login();
      zone = this.session?.zone || ECOUNT_CONFIG.zone;
    }
    
    const baseUrlWithZone = this.baseUrl.replace('{ZONE}', zone);
    const url = requiresAuth ? `${baseUrlWithZone}${endpoint}?SESSION_ID=${sessionId}` : `${baseUrlWithZone}${endpoint}`;
    
    console.log(`Making eCount API request: ${endpoint}`);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          COM_CODE: ECOUNT_CONFIG.companyCode,
          ...body
        })
      });
      
      // Check for redirect or non-JSON responses
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error(`Non-JSON response from eCount API. Content-Type: ${contentType}`);
        
        // If we get HTML redirect, likely auth issue - invalidate session and retry once
        if (requiresAuth && this.session && contentType?.includes('text/html')) {
          console.log('Detected HTML response - invalidating session and retrying...');
          this.session = null;
          return this.ecountRequest(options); // Retry once with fresh auth
        }
        
        throw new Error(`Invalid response type: ${contentType}`);
      }
      
      const result = await response.json();
      
      // Log detailed error for debugging
      if (result.Status !== "200") {
        console.error(`eCount API Error for ${endpoint}:`, {
          status: result.Status,
          error: result.Error,
          response: result
        });
      }
      
      // Auto-retry on auth failure
      if (requiresAuth && result.Status === "401" && this.session) {
        console.log('Auth failed - invalidating session and retrying...');
        this.session = null;
        return this.ecountRequest(options); // Retry once with fresh auth
      }
      
      return result;
    } catch (error) {
      console.error(`eCount API request failed for ${endpoint}:`, error);
      throw error;
    }
  }

  /**
   * Get Zone information to determine correct API endpoint (only called during login)
   */
  private async getZone(): Promise<string> {
    try {
      // Zone API call must use base URL without zone
      const response = await fetch(`https://sboapi.ecount.com/OAPI/V2/Zone`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          COM_CODE: ECOUNT_CONFIG.companyCode
        })
      });

      const result = await response.json();
      if (result.Status === "200") {
        return result.Data?.Zone || ECOUNT_CONFIG.zone;
      }
      throw new Error(`Zone API failed: ${result.Error?.Message || 'Unknown error'}`);
    } catch (error) {
      console.error('Zone API error:', error);
      // Fallback to configured zone
      return ECOUNT_CONFIG.zone;
    }
  }

  /**
   * Login to get session ID with zone pinning
   */
  private async login(): Promise<string> {
    try {
      // Check if we have a valid session
      if (this.session && this.session.expiresAt > new Date()) {
        return this.session.sessionId;
      }

      // Get zone first and pin it to session
      const zone = await this.getZone();
      const baseUrlWithZone = this.baseUrl.replace('{ZONE}', zone);
      const loginUrl = `${baseUrlWithZone}/OAPI/V2/OAPILogin`;

      console.log(`Attempting eCount login to: ${loginUrl}`);
      console.log(`Authenticating with eCount (Zone: ${zone})...`);
      
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          COM_CODE: ECOUNT_CONFIG.companyCode,
          USER_ID: ECOUNT_CONFIG.userId,
          API_CERT_KEY: ECOUNT_CONFIG.testAuthKey,
          LAN_TYPE: "en-US",
          ZONE: zone
        })
      });

      console.log(`Login response status: ${response.status}`);
      const result = await response.json();
      
      if (result.Status === "200" && result.Data?.Datas?.SESSION_ID) {
        // Session expires in 30 minutes by default (can be configured in ERP)
        const expiresAt = new Date(Date.now() + 25 * 60 * 1000); // 25 min for safety
        
        // Pin zone to session to prevent mismatches
        this.session = {
          sessionId: result.Data.Datas.SESSION_ID,
          expiresAt,
          zone
        };

        console.log(`eCount login successful! (Zone: ${zone}, Session: ${this.session.sessionId.substring(0, 8)}...)`);
        return this.session.sessionId;
      }

      throw new Error(`Login failed: ${result.Error?.Message || 'Unknown error'}`);
    } catch (error) {
      console.error('eCount login error:', error);
      throw error;
    }
  }

  /**
   * Get products from eCount using inventory balance approach (more stable)
   */
  async getProducts(): Promise<ProductWithInventory[]> {
    try {
      // Since Item/GetItemList returned 500, let's use the InventoryBalance endpoint 
      // which was working but had auth issues (now fixed with centralized helper)
      const inventoryMap = await this.getInventoryBalance();
      
      if (inventoryMap.size > 0) {
        // Create product list from inventory data
        const products = Array.from(inventoryMap.entries()).map(([productCode, quantity]) => ({
          id: productCode,
          name: this.generateProductName(productCode),
          packaging: 'Standard',
          referenceNumber: productCode,
          price: '25000',
          imageUrl: this.getProductImage(productCode),
          category: this.getCategoryFromCode(productCode),
          availableQuantity: quantity || 0,
          isLowStock: (quantity || 0) < 10,
          isExpiringSoon: false
        }));
        console.log(`Successfully got ${products.length} products from eCount inventory`);
        return products;
      }

      console.error('No inventory data available from eCount');
      throw new Error(`No products found in eCount system`);
    } catch (error) {
      console.error('eCount getProducts error:', error);
      // Return fallback data in case of API issues
      return this.getFallbackProducts();
    }
  }

  /**
   * Get inventory balance for products using centralized helper
   */
  async getInventoryBalance(): Promise<Map<string, number>> {
    try {
      const result = await this.ecountRequest({
        endpoint: '/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus',
        body: {
          BASE_DATE: new Date().toISOString().slice(0, 10).replace(/-/g, ''), // YYYYMMDD - required parameter
          WH_CD: ECOUNT_CONFIG.warehouseCode,
          PROD_CD: "", // Get all products
        }
      });

      console.log('Inventory API status:', result.Status);
      console.log('Inventory API data count:', result.Data?.Datas?.length || 0);
      const inventoryMap = new Map<string, number>();

      if (result.Status === "200" && result.Data?.Datas) {
        result.Data.Datas.forEach((item: EcountInventory) => {
          const quantity = item.BAL_QTY || 0;
          inventoryMap.set(item.PROD_CD, quantity);
        });
        console.log(`Mapped ${inventoryMap.size} products to inventory`);
      } else {
        console.error('Inventory API failed or no data:', result.Status, result.Error);
      }

      return inventoryMap;
    } catch (error) {
      console.error('eCount getInventoryBalance error:', error);
      return new Map(); // Return empty map on error
    }
  }

  /**
   * Create sales order in eCount using centralized helper
   */
  async createSalesOrder(order: Order): Promise<string> {
    try {
      const orderItems = JSON.parse(order.items);
      const currentDate = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
      
      const result = await this.ecountRequest({
        endpoint: '/OAPI/V2/OpenMarket/SaveOpenMarketOrderNew',
        body: {
          SalesList: orderItems.map((item: any, index: number) => ({
            Datas: {
              UPLOAD_SER_NO: index + 1,
              IO_DATE: currentDate,
              CUST: "WEB_CUSTOMER", // Default web customer code
              CUST_DES: "Online Customer",
              PROD_CD: item.productId,
              PROD_DES: item.name,
              QTY: item.quantity.toString(),
              WH_CD: ECOUNT_CONFIG.warehouseCode,
              REMARKS: `Web Order: ${order.orderNumber}`
            }
          }))
        }
      });

      if (result.Status === "200" && result.Data?.SlipNos?.length > 0) {
        console.log('eCount sales order created:', result.Data.SlipNos[0]);
        return result.Data.SlipNos[0];
      }

      throw new Error(`Sales Order API failed: ${result.Error?.Message || 'Unknown error'}`);
    } catch (error) {
      console.error('eCount createSalesOrder error:', error);
      throw error;
    }
  }

  /**
   * Transform eCount item data to product format with inventory information
   */
  private transformItemsToProducts(itemData: EcountProduct[], inventoryMap: Map<string, number>): ProductWithInventory[] {
    return itemData.map((item) => {
      const availableQuantity = inventoryMap.get(item.PROD_CD) || 0;
      return {
        id: item.PROD_CD,
        name: item.PROD_DES || this.generateProductName(item.PROD_CD),
        packaging: item.SIZE_DES || 'Standard',
        referenceNumber: item.PROD_CD,
        price: this.convertEcountPrice(item.PRICE || '25000'),
        imageUrl: this.getProductImage(item.PROD_CD),
        category: item.CATEGORY || this.getCategoryFromCode(item.PROD_CD),
        availableQuantity,
        isLowStock: availableQuantity < 10,
        isExpiringSoon: false
      };
    });
  }

  /**
   * Transform eCount inventory data to product format (fallback)
   */
  private transformInventoryToProducts(inventoryData: EcountInventory[]): ProductWithInventory[] {
    return inventoryData.map((item) => ({
      id: item.PROD_CD,
      name: this.generateProductName(item.PROD_CD),
      packaging: 'Standard',
      referenceNumber: item.PROD_CD,
      price: '25000', // Default price, will be updated from admin later
      imageUrl: this.getProductImage(item.PROD_CD),
      category: this.getCategoryFromCode(item.PROD_CD),
      availableQuantity: item.BAL_QTY || 0,
      isLowStock: (item.BAL_QTY || 0) < 10,
      isExpiringSoon: false
    }));
  }

  /**
   * Generate product name from product code
   */
  private generateProductName(productCode: string): string {
    // Medical supply name patterns based on product codes
    if (productCode.startsWith('LYOFIA')) return `LYOFIA Medical Test Kit - ${productCode}`;
    if (productCode.startsWith('ABS')) return `ABS Medical Component - ${productCode}`;
    if (productCode.startsWith('HS-')) return `Medical Instrument - ${productCode}`;
    if (productCode.startsWith('PDL-')) return `PDL Medical Supply - ${productCode}`;
    if (productCode.match(/^\d+$/)) return `Medical Product ${productCode}`;
    return `Medical Supply - ${productCode}`;
  }

  /**
   * Get category from product code
   */
  private getCategoryFromCode(productCode: string): string {
    if (productCode.startsWith('LYOFIA')) return 'Laboratory Tests';
    if (productCode.startsWith('ABS')) return 'Medical Components';
    if (productCode.startsWith('HS-')) return 'Medical Instruments';
    if (productCode.startsWith('PDL-')) return 'Medical Supplies';
    if (productCode.match(/^\d+$/)) return 'General Medical';
    return 'Medical Supplies';
  }

  /**
   * Convert eCount price to TZS format
   */
  private convertEcountPrice(price: string): string {
    const numPrice = parseFloat(price) || 0;
    // Assuming eCount stores prices in TZS already
    return Math.round(numPrice).toString();
  }

  /**
   * Get product image URL (placeholder for now, will integrate with Cloudinary)
   */
  private getProductImage(productCode: string): string {
    // Default medical supply images based on product code patterns
    const defaultImages = {
      'default': 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&h=300'
    };
    return defaultImages.default;
  }

  /**
   * Fallback products in case eCount API is unavailable
   */
  private getFallbackProducts(): ProductWithInventory[] {
    return [
      {
        id: "FALLBACK001",
        name: "Medical Supply (API Unavailable)",
        packaging: "Standard",
        referenceNumber: "FALLBACK001",
        price: "50000",
        imageUrl: 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&h=300',
        category: "Medical Supplies",
        availableQuantity: 0,
        isLowStock: true,
        isExpiringSoon: false
      }
    ];
  }
}

// Export singleton instance
export const ecountApi = new EcountApiService();