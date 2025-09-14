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
  QTY: string;
  WH_CD: string;
}

class EcountApiService {
  private session: EcountSession | null = null;
  private baseUrl: string;

  constructor() {
    // Use test URL for now
    this.baseUrl = TEST_BASE_URL;
  }

  /**
   * Step 1: Get Zone information to determine correct API endpoint
   */
  async getZone(): Promise<string> {
    try {
      // Use the base zone API URL (without zone in it)
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
   * Step 2: Login to get session ID
   */
  async login(): Promise<string> {
    try {
      // Check if we have a valid session
      if (this.session && this.session.expiresAt > new Date()) {
        return this.session.sessionId;
      }

      const zone = await this.getZone();
      const baseUrlWithZone = this.baseUrl.replace('{ZONE}', zone);
      const loginUrl = `${baseUrlWithZone}/OAPI/V2/OAPILogin`;

      console.log(`Attempting eCount login to: ${loginUrl}`);
      console.log(`Authenticating with eCount...`);
      
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
        
        this.session = {
          sessionId: result.Data.Datas.SESSION_ID,
          expiresAt
        };

        console.log('eCount login successful!');
        return this.session.sessionId;
      }

      throw new Error(`Login failed: ${result.Error?.Message || 'Unknown error'}`);
    } catch (error) {
      console.error('eCount login error:', error);
      throw error;
    }
  }

  /**
   * Get products from eCount Item Search API
   */
  async getProducts(): Promise<ProductWithInventory[]> {
    try {
      const sessionId = await this.login();
      const zone = await this.getZone();
      
      const baseUrlWithZone = this.baseUrl.replace('{ZONE}', zone);
      // Use correct endpoint pattern for Item Search
      const searchUrl = `${baseUrlWithZone}/OAPI/V2/Item/SearchItemList?SESSION_ID=${sessionId}`;
      console.log(`Searching items in eCount...`);
      
      const response = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          COM_CODE: ECOUNT_CONFIG.companyCode,
          SearchCondition: {
            PROD_CD: "", // Empty to get all
            PROD_DES: "",
            USE_YN: "Y" // Only active items
          },
          Page: {
            CURRENT_PAGE: 1,
            PER_PAGE: 200
          }
        })
      });

      const result = await response.json();
      if (result.Status === "200" && result.Data?.Datas) {
        return this.transformEcountProducts(result.Data.Datas);
      }

      throw new Error(`Search Item API failed: ${result.Error?.Message || 'Unknown error'}`);
    } catch (error) {
      console.error('eCount getProducts error:', error);
      // Return fallback data in case of API issues
      return this.getFallbackProducts();
    }
  }

  /**
   * Get inventory balance for products
   */
  async getInventoryBalance(): Promise<Map<string, number>> {
    try {
      const sessionId = await this.login();
      const zone = await this.getZone();
      
      const baseUrlWithZone = this.baseUrl.replace('{ZONE}', zone);
      // Use correct endpoint pattern for Inventory Balance
      const inventoryUrl = `${baseUrlWithZone}/OAPI/V2/Inventory/GetInventoryBalance?SESSION_ID=${sessionId}`;
      console.log(`Getting inventory balance from eCount...`);
      
      const response = await fetch(inventoryUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          COM_CODE: ECOUNT_CONFIG.companyCode,
          SearchCondition: {
            WH_CD: ECOUNT_CONFIG.warehouseCode,
            PROD_CD: "", // Get all products
            BALANCE_DATE: new Date().toISOString().slice(0, 10).replace(/-/g, '') // YYYYMMDD
          }
        })
      });

      const result = await response.json();
      const inventoryMap = new Map<string, number>();

      if (result.Status === "200" && result.Data?.Datas) {
        result.Data.Datas.forEach((item: EcountInventory) => {
          const quantity = parseInt(item.QTY) || 0;
          inventoryMap.set(item.PROD_CD, quantity);
        });
      }

      return inventoryMap;
    } catch (error) {
      console.error('eCount getInventoryBalance error:', error);
      return new Map(); // Return empty map on error
    }
  }

  /**
   * Create sales order in eCount
   */
  async createSalesOrder(order: Order): Promise<string> {
    try {
      const sessionId = await this.login();
      const zone = await this.getZone();
      
      const baseUrlWithZone = this.baseUrl.replace('{ZONE}', zone);
      const salesOrderUrl = `${baseUrlWithZone}/OAPI/V2/SalesSlip/SaveSales?SESSION_ID=${sessionId}`;
      
      const orderItems = JSON.parse(order.items);
      const currentDate = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
      
      const salesOrderData = {
        COM_CODE: ECOUNT_CONFIG.companyCode,
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
      };

      const response = await fetch(salesOrderUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(salesOrderData)
      });

      const result = await response.json();
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
   * Transform eCount product data to our format
   */
  private transformEcountProducts(ecountData: EcountProduct[]): ProductWithInventory[] {
    return ecountData.map((item) => ({
      id: item.PROD_CD,
      name: item.PROD_DES || 'Unknown Product',
      packaging: item.SIZE_DES || 'Standard',
      referenceNumber: item.PROD_CD,
      price: this.convertEcountPrice(item.PRICE),
      imageUrl: this.getProductImage(item.PROD_CD),
      category: item.CATEGORY || 'Medical Supplies',
      availableQuantity: 0, // Will be updated by inventory balance
      isLowStock: false,
      isExpiringSoon: false
    }));
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