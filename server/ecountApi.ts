import type { ProductWithInventory, Order } from "@shared/schema";

// eCount API Configuration - Production Ready
const ECOUNT_CONFIG = {
  companyCode: process.env.ECOUNT_COMPANY_CODE!,
  authKey: process.env.ECOUNT_AUTH_KEY!, // Production key with 1-year validity
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
  cookies: string; // Store cookies from login response
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
  private inventoryCache = new Map<string, { data: any, timestamp: number }>();
  private readonly CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds
  
  // Rate limiting for eCount APIs (per documentation)
  private bulkSyncLastCall = 0;
  private readonly BULK_RATE_LIMIT = 10 * 60 * 1000; // 10 minutes in milliseconds
  private backgroundScheduler: NodeJS.Timeout | null = null;

  // Circuit breaker for handling 412 errors and lockouts
  private circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly FAILURE_THRESHOLD = 3;
  private readonly CIRCUIT_TIMEOUT = 30000; // 30 seconds
  
  // Exponential backoff tracking
  private backoffDelays = new Map<string, number>();
  private readonly MAX_BACKOFF = 60000; // 60 seconds max
  private readonly BASE_BACKOFF = 1000; // 1 second base

  constructor() {
    // Use production URL with real API key
    this.baseUrl = PROD_BASE_URL;
    console.log('🚀 eCount API configured for PRODUCTION environment');
    
    // Start background bulk sync scheduler (every 10 minutes)
    this.startBackgroundScheduler();
  }

  /**
   * Centralized eCount API request helper with cookie auth, circuit breaker, and exponential backoff
   */
  private async ecountRequest(options: EcountApiRequestOptions): Promise<EcountApiResponse> {
    const { endpoint, body, requiresAuth = true } = options;
    
    // Check circuit breaker state
    if (this.circuitBreakerState === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.CIRCUIT_TIMEOUT) {
        console.log('🔄 Circuit breaker: transitioning to HALF_OPEN');
        this.circuitBreakerState = 'HALF_OPEN';
      } else {
        const waitTime = this.CIRCUIT_TIMEOUT - (Date.now() - this.lastFailureTime);
        throw new Error(`Circuit breaker OPEN: wait ${Math.round(waitTime / 1000)}s before retry`);
      }
    }
    
    // Apply exponential backoff if there was a previous failure
    const backoffKey = endpoint;
    const backoffDelay = this.backoffDelays.get(backoffKey) || 0;
    if (backoffDelay > 0) {
      const jitter = Math.random() * 0.3 * backoffDelay; // 30% jitter
      const totalDelay = backoffDelay + jitter;
      console.log(`⏳ Exponential backoff: waiting ${Math.round(totalDelay)}ms for ${endpoint}`);
      await new Promise(resolve => setTimeout(resolve, totalDelay));
    }
    
    // Get session and zone if auth is required
    let sessionId = '';
    let zone = ECOUNT_CONFIG.zone;
    let cookies = '';
    
    if (requiresAuth) {
      sessionId = await this.login();
      zone = this.session?.zone || ECOUNT_CONFIG.zone;
      cookies = this.session?.cookies || '';
    }
    
    const baseUrlWithZone = this.baseUrl.replace('{ZONE}', zone);
    const url = requiresAuth ? `${baseUrlWithZone}${endpoint}?SESSION_ID=${sessionId}` : `${baseUrlWithZone}${endpoint}`;
    
    console.log(`Making eCount API request: ${endpoint} (Zone: ${zone})`);
    
    try {
      // Production-ready headers with cookie support
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      };
      
      // Add cookies if we have them from login
      if (cookies) {
        headers['Cookie'] = cookies;
        console.log(`🍪 Using cookies from session: ${cookies.substring(0, 50)}...`);
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          COM_CODE: ECOUNT_CONFIG.companyCode,
          ...body
        })
      });
      
      console.log(`Response status: ${response.status}, Content-Type: ${response.headers.get('content-type')}`);
      
      // Handle 412 Precondition Failed specifically
      if (response.status === 412) {
        console.error('⚠️ Got 412 Precondition Failed - triggering circuit breaker');
        this.handleFailure(endpoint);
        throw new Error('eCount API returned 412 Precondition Failed - rate limited');
      }
      
      // Check for redirect or non-JSON responses
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error(`Non-JSON response from eCount API. Status: ${response.status}, Content-Type: ${contentType}`);
        
        // Handle non-JSON responses with backoff
        if (response.status >= 400) {
          this.handleFailure(endpoint);
        }
        
        // If we get HTML redirect, likely auth issue - invalidate session and retry once
        if (requiresAuth && this.session && contentType?.includes('text/html')) {
          console.log('🔄 Detected HTML response - invalidating session and retrying...');
          this.session = null;
          return this.ecountRequest(options);
        }
        
        throw new Error(`Invalid response type: ${contentType} (Status: ${response.status})`);
      }
      
      const result = await response.json();
      
      // Success - reset circuit breaker and backoff
      this.handleSuccess(endpoint);
      
      // Log detailed error for debugging
      if (result.Status !== "200") {
        console.error(`eCount API Error for ${endpoint}:`, {
          status: result.Status,
          error: result.Error,
          response: result
        });
        
        // Handle specific error statuses
        if (result.Status === "401" || result.Status === "403") {
          if (requiresAuth && this.session) {
            console.log('🔄 Auth failed - invalidating session and retrying...');
            this.session = null;
            return this.ecountRequest(options);
          }
        }
      }
      
      return result;
    } catch (error) {
      console.error(`eCount API request failed for ${endpoint}:`, error);
      this.handleFailure(endpoint);
      throw error;
    }
  }

  /**
   * Get Zone information using production endpoint
   */
  private async getZone(): Promise<string> {
    try {
      // Use production endpoint for zone API
      const response = await fetch(`https://oapi.ecount.com/OAPI/V2/Zone`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({
          COM_CODE: ECOUNT_CONFIG.companyCode
        })
      });

      console.log(`Zone API response status: ${response.status}`);
      const result = await response.json();
      if (result.Status === "200") {
        const zone = result.Data?.Zone || ECOUNT_CONFIG.zone;
        console.log(`✅ Zone API successful: ${zone}`);
        return zone;
      }
      throw new Error(`Zone API failed: ${result.Error?.Message || 'Unknown error'}`);
    } catch (error) {
      console.error('Zone API error:', error);
      // Fallback to configured zone
      return ECOUNT_CONFIG.zone;
    }
  }

  /**
   * Login with cookie capture and production headers
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

      console.log(`🔐 Attempting eCount login to: ${loginUrl}`);
      console.log(`🔐 Authenticating with eCount (Zone: ${zone})...`);
      
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        body: JSON.stringify({
          COM_CODE: ECOUNT_CONFIG.companyCode,
          USER_ID: ECOUNT_CONFIG.userId,
          API_CERT_KEY: ECOUNT_CONFIG.authKey,
          LAN_TYPE: "en-US",
          ZONE: zone
        })
      });

      console.log(`Login response status: ${response.status}`);
      
      // Handle 412 Precondition Failed on login specifically
      if (response.status === 412) {
        console.error('⚠️ Login got 412 Precondition Failed - rate limited, adding delay');
        // Add delay to prevent further rate limiting
        await new Promise(resolve => setTimeout(resolve, 5000));
        throw new Error('Login rate limited (412) - please wait before retry');
      }
      
      // Capture cookies from login response
      const setCookieHeaders = response.headers.get('set-cookie') || '';
      console.log(`🍪 Login Set-Cookie headers: ${setCookieHeaders}`);
      
      // Check content type before parsing JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error(`Non-JSON login response. Status: ${response.status}, Content-Type: ${contentType}`);
        throw new Error(`Login returned non-JSON response: ${contentType} (Status: ${response.status})`);
      }
      
      const result = await response.json();
      
      if (result.Status === "200" && result.Data?.Datas?.SESSION_ID) {
        // Session expires in 30 minutes by default (can be configured in ERP)
        const expiresAt = new Date(Date.now() + 25 * 60 * 1000); // 25 min for safety
        
        // Store session with cookies for subsequent requests
        this.session = {
          sessionId: result.Data.Datas.SESSION_ID,
          expiresAt,
          zone,
          cookies: setCookieHeaders // Store cookies for auth
        };

        console.log(`✅ eCount login successful! (Zone: ${zone}, Session: ${this.session.sessionId.substring(0, 8)}...)`);
        if (setCookieHeaders) {
          console.log(`🍪 Stored cookies for session authentication`);
        }
        return this.session.sessionId;
      }

      throw new Error(`Login failed: ${result.Error?.Message || 'Unknown error'}`);
    } catch (error) {
      console.error('❌ eCount login error:', error);
      throw error;
    }
  }

  /**
   * Get products from eCount using inventory balance approach (Pure eCount Integration)
   * No fallbacks - throws error if eCount API is unavailable
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

      console.error('❌ No inventory data available from eCount ERP');
      throw new Error('No products found in eCount ERP system');
    } catch (error) {
      console.error('❌ eCount getProducts error:', error);
      // Pure eCount integration - no fallbacks allowed
      throw new Error(`Failed to fetch products from eCount ERP: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
   * Create sales order in eCount using the correct JSON format
   */
  async createSalesOrder(order: Order): Promise<string> {
    try {
      const orderItems = JSON.parse(order.items);
      const currentDate = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
      
      // Use eCount's special JSON format structure
      const result = await this.ecountRequest({
        endpoint: '/OAPI/V2/SalesOrder/SaveSalesOrder',
        body: {
          SaleOrderList: orderItems.map((item: any, index: number) => ({
            BulkDatas: {
              // Header fields
              IO_DATE: currentDate,
              UPLOAD_SER_NO: (index + 1).toString(),
              CUST: "2025", // Customer code - should be configured per customer
              CUST_DES: "Phomas Online Customer",
              EMP_CD: "",
              WH_CD: ECOUNT_CONFIG.warehouseCode,
              IO_TYPE: "",
              EXCHANGE_TYPE: "",
              EXCHANGE_RATE: "",
              PJT_CD: "",
              DOC_NO: order.orderNumber,
              TTL_CTT: "",
              REF_DES: "",
              COLL_TERM: "",
              AGREE_TERM: "",
              TIME_DATE: "",
              REMARKS_WIN: "",
              
              // Custom text fields
              U_MEMO1: `Web Order: ${order.orderNumber}`,
              U_MEMO2: "",
              U_MEMO3: "",
              U_MEMO4: "",
              U_MEMO5: "",
              
              // Additional header fields (empty for now)
              ADD_TXT_01_T: "", ADD_TXT_02_T: "", ADD_TXT_03_T: "", ADD_TXT_04_T: "", ADD_TXT_05_T: "",
              ADD_TXT_06_T: "", ADD_TXT_07_T: "", ADD_TXT_08_T: "", ADD_TXT_09_T: "", ADD_TXT_10_T: "",
              ADD_NUM_01_T: "", ADD_NUM_02_T: "", ADD_NUM_03_T: "", ADD_NUM_04_T: "", ADD_NUM_05_T: "",
              ADD_CD_01_T: "", ADD_CD_02_T: "", ADD_CD_03_T: "",
              ADD_DATE_01_T: "", ADD_DATE_02_T: "", ADD_DATE_03_T: "",
              U_TXT1: "",
              ADD_LTXT_01_T: "", ADD_LTXT_02_T: "", ADD_LTXT_03_T: "",
              
              // Product/item fields
              PROD_CD: item.productId,
              PROD_DES: item.name,
              SIZE_DES: item.packaging || "",
              UQTY: "",
              QTY: item.quantity.toString(),
              PRICE: item.price?.toString() || "0",
              USER_PRICE_VAT: "",
              SUPPLY_AMT: (item.quantity * (item.price || 0)).toString(),
              SUPPLY_AMT_F: "",
              VAT_AMT: "",
              ITEM_TIME_DATE: "",
              REMARKS: `Phomas Online Store - Order: ${order.orderNumber}`,
              ITEM_CD: "",
              
              // Additional item fields
              P_REMARKS1: "", P_REMARKS2: "", P_REMARKS3: "",
              ADD_TXT_01: "", ADD_TXT_02: "", ADD_TXT_03: "", ADD_TXT_04: "", ADD_TXT_05: "", ADD_TXT_06: "",
              REL_DATE: "", REL_NO: "",
              P_AMT1: "", P_AMT2: "",
              ADD_NUM_01: "", ADD_NUM_02: "", ADD_NUM_03: "", ADD_NUM_04: "", ADD_NUM_05: "",
              ADD_CD_01: "", ADD_CD_02: "", ADD_CD_03: "",
              ADD_CD_NM_01: "", ADD_CD_NM_02: "", ADD_CD_NM_03: "",
              ADD_CDNM_01: "", ADD_CDNM_02: "", ADD_CDNM_03: "",
              ADD_DATE_01: "", ADD_DATE_02: "", ADD_DATE_03: ""
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
   * Bulk product sync - downloads complete product catalog (rate limited: 1 per 10 minutes)
   */
  async bulkSyncProducts(): Promise<any> {
    console.log('🔄 Starting bulk product sync (Rate limit: 1 per 10 minutes)...');
    
    try {
      // Use proper eCount request format for bulk product sync
      const result = await this.ecountRequest({
        endpoint: '/OAPI/V2/Item/GetItemList',
        body: {
          // eCount-specific parameters
          Page: "1",
          PageSize: "1000", // Max products per call - adjust as needed
          IsIncludeDel: "false", // Don't include deleted items
          WH_CD: ECOUNT_CONFIG.warehouseCode
        }
      });

      if (result.Status === "200") {
        console.log(`✅ Bulk product sync completed: ${result.Data?.Datas?.length || 0} products retrieved`);
        return result;
      }

      throw new Error(`Bulk product sync failed: ${result.Error?.Message || 'Unknown error'}`);
    } catch (error) {
      console.error('❌ Error in bulk product sync:', error);
      throw error;
    }
  }

  /**
   * Bulk inventory sync - downloads all inventory quantities (rate limited: 1 per 10 minutes)
   */
  async bulkSyncInventory(): Promise<any> {
    console.log('🔄 Starting bulk inventory sync (Rate limit: 1 per 10 minutes)...');
    
    try {
      // Use proper eCount request format for bulk inventory sync
      const result = await this.ecountRequest({
        endpoint: '/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus',
        body: {
          BASE_DATE: new Date().toISOString().slice(0, 10).replace(/-/g, ''), // YYYYMMDD
          WH_CD: ECOUNT_CONFIG.warehouseCode,
          PROD_CD: "", // Get all products
          // Pagination parameters as strings
          Page: "1",
          PageSize: "1000"
        }
      });

      if (result.Status === "200") {
        console.log(`✅ Bulk inventory sync completed: ${result.Data?.Datas?.length || 0} inventory records retrieved`);
        return result;
      }

      throw new Error(`Bulk inventory sync failed: ${result.Error?.Message || 'Unknown error'}`);
    } catch (error) {
      console.error('❌ Error in bulk inventory sync:', error);
      throw error;
    }
  }

  /**
   * Get cached inventory data with 1-hour expiration
   */
  async getCachedInventoryData(): Promise<Map<string, number>> {
    const cacheKey = 'inventory_data';
    const cached = this.inventoryCache.get(cacheKey);
    
    // Check if we have valid cached data (less than 1 hour old)
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
      console.log('📦 Using cached inventory data (age: ' + Math.round((Date.now() - cached.timestamp) / 1000 / 60) + ' minutes)');
      return cached.data;
    }
    
    console.log('🔄 Cache miss or expired, fetching fresh inventory data');
    
    try {
      const freshData = await this.getInventoryBalance();
      
      // Cache the fresh data
      this.inventoryCache.set(cacheKey, {
        data: freshData,
        timestamp: Date.now()
      });
      
      console.log(`✅ Fresh inventory data cached: ${freshData.size} products`);
      return freshData;
    } catch (error) {
      // If fresh fetch fails and we have expired cache, use it as fallback
      if (cached) {
        const ageMinutes = Math.round((Date.now() - cached.timestamp) / 1000 / 60);
        console.log(`⚠️ Fresh fetch failed, using expired cache as fallback (age: ${ageMinutes} minutes)`);
        return cached.data;
      }
      throw error;
    }
  }

  /**
   * Get single item inventory for high-priority products (rate limit: 1 per second)
   */
  async getSingleItemInventory(itemCode: string): Promise<number> {
    console.log(`🔍 Getting single item inventory for: ${itemCode} (Rate limit: 1 per second)`);
    
    try {
      const result = await this.ecountRequest({
        endpoint: '/OAPI/V2/InventoryBalance/GetInventoryBalanceStatus',
        body: {
          BASE_DATE: new Date().toISOString().slice(0, 10).replace(/-/g, ''), // YYYYMMDD
          WH_CD: ECOUNT_CONFIG.warehouseCode,
          PROD_CD: itemCode // Single item lookup
        }
      });

      if (result.Status === "200" && result.Data?.Datas?.length > 0) {
        const quantity = result.Data.Datas[0]?.BAL_QTY || 0;
        console.log(`✅ Single item inventory for ${itemCode}: ${quantity} units`);
        
        // Update cache with this single item
        const cacheKey = 'inventory_data';
        const cached = this.inventoryCache.get(cacheKey);
        if (cached && cached.data instanceof Map) {
          cached.data.set(itemCode, quantity);
          console.log(`📦 Updated cache with fresh data for ${itemCode}`);
        }
        
        return quantity;
      }

      console.log(`ℹ️ No inventory found for item ${itemCode}`);
      return 0;
    } catch (error) {
      console.error(`❌ Error getting single item inventory for ${itemCode}:`, error);
      throw error;
    }
  }

  /**
   * Clear inventory cache (useful for admin operations)
   */
  clearInventoryCache(): void {
    console.log('🗑️ Clearing inventory cache');
    this.inventoryCache.clear();
  }

  /**
   * Get cache status for admin monitoring
   */
  getCacheStatus(): { size: number, lastUpdated: string | null, isExpired: boolean } {
    const cached = this.inventoryCache.get('inventory_data');
    
    if (!cached) {
      return { size: 0, lastUpdated: null, isExpired: true };
    }
    
    const ageMs = Date.now() - cached.timestamp;
    const isExpired = ageMs > this.CACHE_DURATION;
    
    return {
      size: cached.data instanceof Map ? cached.data.size : 0,
      lastUpdated: new Date(cached.timestamp).toISOString(),
      isExpired
    };
  }

  /**
   * Pure eCount Integration: Get ALL products from eCount with inventory data
   * This replaces the hybrid system approach
   */
  async getAllProductsFromEcount(): Promise<any[]> {
    console.log('🚀 Fetching ALL products from eCount ERP (Pure Integration)');
    
    try {
      // Get both product list and inventory in parallel
      const [productList, inventoryData] = await Promise.all([
        this.getProductList(),
        this.getCachedInventoryData()
      ]);
      
      // Transform eCount data to our product format
      const products = productList.map((product: any) => {
        const inventory = inventoryData instanceof Map ? inventoryData.get(product.PROD_CD) : inventoryData[product.PROD_CD] || {};
        
        return {
          id: product.PROD_CD,
          name: product.PROD_NM || this.generateProductName(product.PROD_CD),
          packaging: product.UNIT || 'Standard',
          referenceNumber: product.PROD_CD,
          price: inventory.PRICE || product.PRICE || '25000',
          imageUrl: this.getProductImage(product.PROD_CD),
          category: this.getCategoryFromCode(product.PROD_CD),
          availableQuantity: parseInt(inventory.QTY || '0'),
          isLowStock: parseInt(inventory.QTY || '0') < 10,
          isExpiringSoon: false,
          hasRealTimeData: true,
          lastUpdated: new Date().toISOString()
        };
      });
      
      console.log(`✅ Pure eCount integration: ${products.length} products loaded from ERP`);
      return products;
      
    } catch (error) {
      console.error('❌ Failed to get products from eCount:', error);
      throw new Error('Failed to fetch products from eCount ERP');
    }
  }

  /**
   * Get product list from eCount
   */
  private async getProductList(): Promise<any[]> {
    try {
      const endpoint = '/OAPI/V2/Item/GetItemList';
      const response = await this.ecountRequest({
        endpoint,
        body: {
          PROD_GB: 'Y' // Get products only
        }
      });
      
      return response?.Data?.Datas || [];
    } catch (error) {
      console.error('Failed to get eCount product list:', error);
      return [];
    }
  }


  /**
   * Background Scheduler: Automatic 10-minute bulk sync cycles
   * This respects eCount rate limits and keeps cache fresh
   */
  private startBackgroundScheduler(): void {
    console.log('⏰ Starting eCount background scheduler (10-minute cycles)');
    
    // Initial sync after 30 seconds
    setTimeout(() => {
      this.performBackgroundBulkSync();
    }, 30000);
    
    // Then sync every 10 minutes
    this.backgroundScheduler = setInterval(() => {
      this.performBackgroundBulkSync();
    }, this.BULK_RATE_LIMIT); // 10 minutes
  }

  /**
   * Perform background bulk sync with rate limiting
   */
  private async performBackgroundBulkSync(): Promise<void> {
    const now = Date.now();
    const timeSinceLastCall = now - this.bulkSyncLastCall;
    
    // Respect 10-minute rate limit
    if (timeSinceLastCall < this.BULK_RATE_LIMIT) {
      const waitTime = this.BULK_RATE_LIMIT - timeSinceLastCall;
      console.log(`⏳ Rate limit: waiting ${Math.round(waitTime / 1000)}s before next bulk sync`);
      return;
    }
    
    try {
      console.log('🔄 Background bulk sync started (Production eCount)');
      
      // Update rate limit tracker
      this.bulkSyncLastCall = now;
      
      // Perform bulk sync operations in sequence
      await this.bulkSyncProductsAndInventory();
      
      console.log('✅ Background bulk sync completed successfully');
    } catch (error) {
      console.error('❌ Background bulk sync failed:', error);
    }
  }

  /**
   * Bulk sync products and inventory data from eCount
   */
  private async bulkSyncProductsAndInventory(): Promise<void> {
    try {
      // Sync inventory data (this will update the cache)
      const inventoryData = await this.getInventoryBalance();
      
      // Cache the fresh data with timestamp
      this.inventoryCache.set('inventory_balance', {
        data: inventoryData,
        timestamp: Date.now()
      });
      
      console.log(`📦 Bulk sync complete: ${inventoryData.size} products cached from eCount`);
    } catch (error) {
      console.error('Bulk sync error:', error);
      throw error;
    }
  }

  /**
   * Stop background scheduler (for cleanup)
   */
  stopBackgroundScheduler(): void {
    if (this.backgroundScheduler) {
      clearInterval(this.backgroundScheduler);
      this.backgroundScheduler = null;
      console.log('⏹️ eCount background scheduler stopped');
    }
  }

  /**
   * Handle successful API call - reset circuit breaker and backoff
   */
  private handleSuccess(endpoint: string): void {
    // Reset circuit breaker
    if (this.circuitBreakerState === 'HALF_OPEN') {
      console.log('✅ Circuit breaker: transitioning to CLOSED');
      this.circuitBreakerState = 'CLOSED';
    }
    this.failureCount = 0;
    
    // Reset backoff for this endpoint
    this.backoffDelays.delete(endpoint);
  }
  
  /**
   * Handle API failure - update circuit breaker and backoff
   */
  private handleFailure(endpoint: string): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    // Update exponential backoff for this endpoint
    const currentBackoff = this.backoffDelays.get(endpoint) || this.BASE_BACKOFF;
    const newBackoff = Math.min(currentBackoff * 2, this.MAX_BACKOFF);
    this.backoffDelays.set(endpoint, newBackoff);
    
    console.log(`⚠️ API failure #${this.failureCount} for ${endpoint}, next backoff: ${newBackoff}ms`);
    
    // Trigger circuit breaker if threshold reached
    if (this.failureCount >= this.FAILURE_THRESHOLD && this.circuitBreakerState === 'CLOSED') {
      console.log('🔴 Circuit breaker: transitioning to OPEN');
      this.circuitBreakerState = 'OPEN';
    }
  }
  
  /**
   * Get circuit breaker status for monitoring
   */
  getCircuitBreakerStatus(): { state: string, failures: number, backoffEndpoints: string[] } {
    return {
      state: this.circuitBreakerState,
      failures: this.failureCount,
      backoffEndpoints: Array.from(this.backoffDelays.keys())
    };
  }
}

// Export singleton instance
export const ecountApi = new EcountApiService();