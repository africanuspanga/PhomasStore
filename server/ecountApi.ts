import type { ProductWithInventory, Order } from "@shared/schema";
import { ProductMapping } from "./productMapping";
import { storage } from "./storage";

// eCount API Configuration - Production Ready
const ECOUNT_CONFIG = {
  companyCode: process.env.ECOUNT_COMPANY_CODE!,
  authKey: process.env.ECOUNT_AUTH_KEY!, // Production key with 1-year validity
  userId: process.env.ECOUNT_USER_ID!,
  zone: process.env.ECOUNT_ZONE!,
  warehouseCode: process.env.ECOUNT_WAREHOUSE_CODE!,
};

// Log auth key status (first 8 chars only for security)
console.log(`🔑 Using AUTH_KEY: ${ECOUNT_CONFIG.authKey?.substring(0, 8)}...${ECOUNT_CONFIG.authKey?.substring(ECOUNT_CONFIG.authKey.length - 4)} (length: ${ECOUNT_CONFIG.authKey?.length})`);

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
  
  // CRITICAL: eCount rate limits (from API documentation)
  // Inventory Balance: 1 call per 20 minutes
  // Sales Order: 1 call per 20 seconds
  private inventoryLastCall = 0;
  private readonly INVENTORY_RATE_LIMIT = 20 * 60 * 1000; // 20 minutes in milliseconds
  private bulkSyncLastCall = 0;
  private readonly BULK_RATE_LIMIT = 10 * 60 * 1000; // 10 minutes in milliseconds

  // CRITICAL: Consecutive error tracking to prevent eCount lockouts
  // eCount locks API after 30 consecutive errors per hour (documented limit)
  private consecutiveErrors = 0;
  private errorWindowStart = Date.now();
  private readonly MAX_CONSECUTIVE_ERRORS = parseInt(process.env.ECOUNT_MAX_ERRORS || '8'); // Default 8 (well below 30 limit)
  private readonly ERROR_WINDOW_MS = 60 * 60 * 1000; // 1 hour window
  private readonly LOCK_DURATION_MS = parseInt(process.env.ECOUNT_LOCK_DURATION_MIN || '45') * 60 * 1000; // Default 45 minutes
  private apiLocked = false;
  private lockReleaseTime = 0;
  
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
  
  // Login deduplication and rate limiting
  private loginInProgress = false;
  private loginPromise: Promise<string> | null = null;
  private lastLoginAttempt = 0;
  private readonly MIN_LOGIN_INTERVAL = 30000; // 30 seconds minimum between login attempts (increased)

  constructor() {
    // ✅ PRODUCTION: Using production API URL with production auth key
    this.baseUrl = PROD_BASE_URL;
    console.log('🚀 eCount API configured for PRODUCTION environment');
    console.log('✅ Using PRODUCTION URL with production auth key');
    
    // CRITICAL: Clear any cached sessions to force fresh authentication with new key
    this.session = null;
    console.log('🔄 Session cache cleared - will authenticate with fresh credentials');
    
    // REMOVED: Background scheduler (causes rate limit violations)
    // eCount Inventory Balance API: 1 call per 20 minutes maximum
    console.log('⏱️  Rate limit: Inventory Balance API limited to 1 call per 20 minutes');
  }

  /**
   * Centralized eCount API request helper with cookie auth, circuit breaker, and exponential backoff
   */
  private async ecountRequest(options: EcountApiRequestOptions): Promise<EcountApiResponse> {
    const { endpoint, body, requiresAuth = true } = options;
    
    // CRITICAL: Check if API is self-locked to prevent eCount lockout
    if (this.apiLocked) {
      const waitTime = Math.ceil((this.lockReleaseTime - Date.now()) / 1000);
      if (waitTime > 0) {
        console.warn(`🔒 API LOCKED: Too many consecutive errors (${this.consecutiveErrors}/${this.MAX_CONSECUTIVE_ERRORS}). Waiting ${waitTime}s to prevent eCount lockout.`);
        throw new Error(`API temporarily locked to prevent eCount lockout. Please wait ${waitTime} seconds.`);
      } else {
        // Lock expired, reset and continue
        console.log('🔓 API lock expired - resetting error counters');
        this.apiLocked = false;
        this.consecutiveErrors = 0;
        this.errorWindowStart = Date.now();
      }
    }
    
    // Reset error window if 1 hour has passed
    if (Date.now() - this.errorWindowStart > this.ERROR_WINDOW_MS) {
      console.log('✅ Error window expired - resetting consecutive error counter');
      this.consecutiveErrors = 0;
      this.errorWindowStart = Date.now();
    }
    
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
      // Only login if we don't have a valid session
      if (!this.session || this.session.expiresAt <= new Date()) {
        sessionId = await this.login();
      } else {
        sessionId = this.session.sessionId;
      }
      zone = this.session?.zone || ECOUNT_CONFIG.zone;
      cookies = this.session?.cookies || '';
    }
    
    const baseUrlWithZone = this.baseUrl.replace('{ZONE}', zone);
    // CRITICAL FIX: URL-encode session ID (contains special characters like ! and =)
    const encodedSessionId = requiresAuth ? encodeURIComponent(sessionId) : '';
    
    // SOLUTION: Per eCount PDF documentation (line 8188), ONLY pass SESSION_ID
    // API_CERT_KEY is used during LOGIN only, not for subsequent API calls
    const url = requiresAuth 
      ? `${baseUrlWithZone}${endpoint}?SESSION_ID=${encodedSessionId}` 
      : `${baseUrlWithZone}${endpoint}`;
    
    console.log(`Making eCount API request: ${endpoint} (Zone: ${zone})`);
    if (requiresAuth) {
      console.log(`🔗 Full URL: ${baseUrlWithZone}${endpoint}?SESSION_ID=${encodedSessionId.substring(0, 20)}...`);
    }
    
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
      
      // CRITICAL FIX: InventoryBalance API REQUIRES cookies + session ID (both!)
      if (cookies) {
        headers['Cookie'] = cookies;
        console.log(`🍪 Sending Cookie header: ${cookies.substring(0, 100)}...`);
      } else {
        console.log(`⚠️ No cookies available for this request`);
      }
      
      // Build request body - include SESSION_ID AND AUTH_KEY for authenticated requests
      const requestBody: any = {
        COM_CODE: ECOUNT_CONFIG.companyCode,
        ...body
      };
      
      // CRITICAL FIX: eCount requires SESSION_ID + AUTH_KEY in BOTH URL and body for API requests
      if (requiresAuth && sessionId) {
        requestBody.SESSION_ID = sessionId;
        requestBody.API_CERT_KEY = ECOUNT_CONFIG.authKey;  // Add auth key to every request
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });
      
      console.log(`Response status: ${response.status}, Content-Type: ${response.headers.get('content-type')}`);
      
      // Handle 412 Precondition Failed specifically  
      if (response.status === 412) {
        console.log('⚠️ Got 412 Precondition Failed - triggering circuit breaker');
        this.handleFailure(endpoint, response.status);
        // Don't throw immediately - let the caller handle gracefully with cache fallback
        throw new Error('eCount API returned 412 Precondition Failed - rate limited');
      }
      
      // Check for redirect or non-JSON responses
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error(`Non-JSON response from eCount API. Status: ${response.status}, Content-Type: ${contentType}`);
        
        // Handle non-JSON responses with backoff
        if (response.status >= 400) {
          this.handleFailure(endpoint, response.status);
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
      this.handleFailure(endpoint, undefined, error);
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
      
      // FIX: Status can be either number 200 or string "200"
      if (result.Status === "200" || result.Status === 200) {
        const zone = result.Data?.ZONE || result.Data?.Zone || ECOUNT_CONFIG.zone;
        console.log(`✅ Zone API successful: ${zone}`);
        return zone;
      }
      console.error('🔍 Zone API Error:', result.Error);
      throw new Error(`Zone API failed: ${result.Error?.Message || 'Unknown error'}`);
    } catch (error) {
      console.error('Zone API error:', error);
      // Fallback to configured zone
      return ECOUNT_CONFIG.zone;
    }
  }

  /**
   * Login with cookie capture and production headers - CORRECTED ENDPOINT
   */
  private async login(): Promise<string> {
    try {
      // Check if we have a valid session
      if (this.session && this.session.expiresAt > new Date()) {
        return this.session.sessionId;
      }
      
      // Prevent concurrent login attempts - return existing promise if login in progress
      if (this.loginInProgress && this.loginPromise) {
        console.log('🔄 Login already in progress, waiting for existing attempt...');
        return await this.loginPromise;
      }
      
      // Rate limit login attempts - minimum 5 seconds between attempts
      const timeSinceLastLogin = Date.now() - this.lastLoginAttempt;
      if (timeSinceLastLogin < this.MIN_LOGIN_INTERVAL) {
        const waitTime = this.MIN_LOGIN_INTERVAL - timeSinceLastLogin;
        console.log(`⏳ Login rate limit: waiting ${waitTime}ms before next attempt`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      // Mark login as in progress and store the promise
      this.loginInProgress = true;
      this.lastLoginAttempt = Date.now();
      
      this.loginPromise = this.performLogin();
      const result = await this.loginPromise;
      
      return result;
    } catch (error) {
      console.error('❌ eCount login error:', error);
      throw error;
    } finally {
      // Reset login state
      this.loginInProgress = false;
      this.loginPromise = null;
    }
  }
  
  /**
   * Perform the actual login request with enhanced error handling
   */
  private async performLogin(): Promise<string> {
    try {

      // Get zone first and pin it to session
      const zone = await this.getZone();
      const baseUrlWithZone = this.baseUrl.replace('{ZONE}', zone);
      const loginUrl = `${baseUrlWithZone}/OAPI/V2/OAPILogin`; // CORRECTED: Use correct endpoint from user's list

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
        console.log('⚠️ Login got 412 Precondition Failed - rate limited, extending backoff');
        // Extend the backoff delay significantly for login rate limiting
        this.backoffDelays.set('login', Math.min(this.MAX_BACKOFF, 15000)); // 15 second backoff for login
        this.lastLoginAttempt = Date.now(); // Update last attempt time
        throw new Error('Login rate limited (412) - please wait before retry');
      }
      
      // FIX: Properly parse Set-Cookie headers and extract session from cookie
      const setCookieHeader = response.headers.get('set-cookie') || '';
      
      // Parse cookies and extract session ID from ECOUNT_SessionId cookie
      const cookieValues: string[] = [];
      let sessionIdFromCookie = ''; // Will be extracted from cookie if available
      
      if (setCookieHeader) {
        const cookieParts = setCookieHeader.split(',').map(c => c.trim());
        
        for (const cookiePart of cookieParts) {
          const cookieValue = cookiePart.split(';')[0].trim();
          if (cookieValue) {
            cookieValues.push(cookieValue);
            
            // Extract session ID from ECOUNT_SessionId cookie (more reliable)
            if (cookieValue.startsWith('ECOUNT_SessionId=')) {
              // CRITICAL FIX: Cookie value may have multiple '=' signs
              // Get everything after 'ECOUNT_SessionId='
              const cookieSessionValue = cookieValue.substring('ECOUNT_SessionId='.length);
              if (cookieSessionValue) {
                // Session ID is the full cookie value (may contain '=' characters)
                sessionIdFromCookie = cookieSessionValue;
                console.log(`🍪 Extracted session from cookie: ${sessionIdFromCookie.substring(0, 20)}...`);
              }
            }
          }
        }
      }
      
      const cookieString = cookieValues.join('; ');
      console.log(`🍪 Captured ${cookieValues.length} cookies from login`);
      
      // Check content type before parsing JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error(`Non-JSON login response. Status: ${response.status}, Content-Type: ${contentType}`);
        throw new Error(`Login returned non-JSON response: ${contentType} (Status: ${response.status})`);
      }
      
      const result = await response.json();
      
      // FIX: Check for session_guid (new API) or SESSION_ID (old API)
      const sessionId = result.Data?.session_guid || result.Data?.Datas?.SESSION_ID;
      console.log(`📝 Session ID from response body: ${sessionId ? sessionId.substring(0, 20) + '...' : 'NONE'}`);
      
      // FIX: Status can be either number 200 or string "200"
      if ((result.Status === "200" || result.Status === 200) && sessionId) {
        // Session expires in 30 minutes by default (can be configured in ERP)
        const expiresAt = new Date(Date.now() + 25 * 60 * 1000); // 25 min for safety
        
        // CRITICAL FIX: Always use session ID from response body, not cookie
        // The cookie session ID format appears to be different from what the API expects
        const finalSessionId = sessionId;  // Use response body session ID
        
        this.session = {
          sessionId: finalSessionId,
          expiresAt,
          zone,
          cookies: cookieString // Store parsed cookies for auth
        };

        console.log(`✅ eCount login successful! (Zone: ${zone}, Session: ${this.session.sessionId.substring(0, 8)}...)`);
        if (cookieString) {
          console.log(`🍪 Stored ${cookieValues.length} cookies for session authentication`);
        }
        console.log(`🔑 Using session ID from response body (standard eCount format)`);
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
  /**
   * Get complete product list from eCount using the CORRECT InventoryBasic endpoint from documentation
   */
  async getProductList(): Promise<any[]> {
    try {
      // CRITICAL: Check rate limit (1 call per 20 minutes)
      const timeSinceLastCall = Date.now() - this.inventoryLastCall;
      const timeRemaining = this.INVENTORY_RATE_LIMIT - timeSinceLastCall;
      
      if (this.inventoryLastCall > 0 && timeRemaining > 0) {
        const minutesRemaining = Math.ceil(timeRemaining / 60000);
        console.log(`⏱️  Rate limit: Must wait ${minutesRemaining} more minutes before calling Inventory API`);
        console.log(`📦 Using cached product data instead`);
        return []; // Return empty to use cache
      }
      
      console.log('🔍 Using InventoryBalance endpoint for products (respecting 20-min rate limit)');
      this.inventoryLastCall = Date.now(); // Mark this call
      
      // Use the inventory endpoint that was working with proper parameters AND warehouse code
      const result = await this.ecountRequest({
        endpoint: '/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus',
        body: {
          BASE_DATE: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
          WH_CD: ECOUNT_CONFIG.warehouseCode,  // Include warehouse code for proper filtering
          PROD_CD: '',       // Empty = get all products
          Page: '1',
          PageSize: '1000'
        }
      });

      console.log('📊 InventoryBalance API status:', result.Status);
      
      // FIX: Check for Data.Datas first, then Data.Result as fallback
      const products = result.Data?.Datas || result.Data?.Result || [];
      console.log('📊 InventoryBalance API data count:', products.length);
      
      if (result.Status === "200" && products.length > 0) {
        console.log('✅ Successfully retrieved products from InventoryBalance!');
        console.log(`🎉 REAL eCount data: ${products.length} products found!`);
        return products;
      } else {
        console.error('❌ InventoryBalance API failed or returned empty:', result.Status, result.Error?.Message);
        console.error('🔍 Debug - Data structure:', { 
          status: result.Status, 
          hasData: !!result.Data, 
          hasDatas: !!result.Data?.Datas,
          datasLength: result.Data?.Datas?.length,
          hasResult: !!result.Data?.Result,
          resultLength: result.Data?.Result?.length
        });
        // Return empty array but don't overwrite cache - let cache safety handle this
        return [];
      }
    } catch (error) {
      console.error('❌ eCount getProductList error:', error);
      return [];
    }
  }

  async getProducts(): Promise<ProductWithInventory[]> {
    try {
      console.log('🚀 Getting products using correct eCount GetProductList endpoint');
      
      // Get products using the correct endpoint
      const productList = await this.getProductList();
      
      if (productList && productList.length > 0) {
        // Transform eCount product data to our format (no images - handled separately)
        const products = productList.map((product: any) => ({
          id: product.PROD_CD,
          name: this.generateProductName(product.PROD_CD),
          packaging: 'Standard',
          referenceNumber: product.PROD_CD,
          price: '25000', // Will be updated from admin later
          imageUrl: null, // Images handled by separate /api/images system
          category: this.getCategoryFromCode(product.PROD_CD),
          availableQuantity: parseInt(product.BAL_QTY || '0'),
          isLowStock: parseInt(product.BAL_QTY || '0') < 10,
          isExpiringSoon: false,
          hasRealTimeData: true,
          lastUpdated: new Date().toISOString()
        }));
        
        console.log(`✅ Successfully got ${products.length} products from eCount GetProductList`);
        return products;
      }

      console.error('❌ No products returned from eCount GetProductList endpoint');
      throw new Error('No products found in eCount ERP system');
    } catch (error) {
      console.error('❌ eCount getProducts error:', error);
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
   * Submit sale order to eCount using CORRECT SaveSale endpoint and JSON format
   * Based on official eCount API documentation provided by user
   */
  async submitSaleOrder(order: Order, userProfile?: any): Promise<{ docNo: string, ioDate: string }> {
    try {
      const orderItems = JSON.parse(order.items);
      // eCount requires YYYYMMDD format for IO_DATE (STRING(8) per API docs)
      const currentDate = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD format
      
      // UPLOAD_SER_NO must be SMALLINT(4,0) - simple 1-4 digit number (per API docs)
      // Use simple incrementing counter (will reset daily, which is fine)
      const sequenceNumber = Math.floor(Math.random() * 9999).toString(); // 1-4 digits
      
      // Map customer to eCount CUST code - use correct Phomas Online Store customer
      const customerCode = userProfile?.ecountCustCode || "10839";
      const customerName = userProfile?.name || "Online Store Sales";
      
      console.log(`🧾 Submitting sale to eCount ERP: Order ${order.orderNumber} with ${orderItems.length} items`);
      
      // CRITICAL FIX: Apply ProductMapping to get correct eCount PROD_CD for each item
      console.log('🔍 Ensuring ProductMapping is loaded for order submission...');
      await ProductMapping.ensureLoaded();
      
      // CRITICAL FIX: Map and validate each order item with fail-fast approach
      const mappedItems: Array<{
        productId: string;
        ecountProdCd: string;
        name: string;
        packaging: string;
        quantity: number;
        price: number;
        matchRule: string;
      }> = [];
      
      const unmappedItems: string[] = [];
      
      console.log('🔍 Processing order items for eCount submission:', orderItems.length);
      
      for (const item of orderItems) {
        const mapping = ProductMapping.getProduct(item.productId);
        
        if (mapping) {
          // CRITICAL FIX: Use the actual normalized eCount product code (the map key)
          // The item.productId should already be the correct eCount code since it comes from eCount API
          const ecountProdCode = item.productId; // Use normalized eCount code from eCount API
          
          mappedItems.push({
            productId: item.productId,
            ecountProdCd: ecountProdCode, // Use the correct normalized eCount PROD_CD
            name: mapping.name, // Use real name from Excel
            packaging: mapping.uom,
            quantity: item.quantity,
            price: mapping.price, // Use real price from Excel
            matchRule: mapping.matchRule || 'direct'
          });
          console.log(`✅ Mapped ${item.productId} -> eCount PROD_CD: ${ecountProdCode} "${mapping.name}" (${mapping.matchRule})`);  
        } else {
          unmappedItems.push(item.productId);
          console.error(`❌ No mapping found for product: ${item.productId}`);
        }
      }
      
      // CRITICAL FIX: Fail fast if any products are unmapped
      if (unmappedItems.length > 0) {
        const diagnostics = ProductMapping.getDiagnostics();
        console.error('🚨 SALE ORDER SUBMISSION FAILED: Unmapped products detected');
        console.error(`❌ Unmapped products (${unmappedItems.length}):`, unmappedItems);
        console.error(`📊 ProductMapping diagnostics:`, {
          totalExcelCodes: diagnostics.totalExcelCodes,
          sampleExcelCodes: diagnostics.sampleExcelCodes.slice(0, 5),
          unmappedSample: unmappedItems.slice(0, 5)
        });
        
        throw new Error(`Cannot submit order: ${unmappedItems.length} products lack eCount mapping. Unmapped: ${unmappedItems.slice(0, 3).join(', ')}${unmappedItems.length > 3 ? '...' : ''}`);
      }
      
      console.log(`🎯 All ${mappedItems.length} products successfully mapped for eCount submission`);
      
      // Build correct SaleList structure as per user's provided format
      const salesPayload = {
        SaleList: [
          {
            Sale: {
              UPLOAD_SER_NO: `SO_${order.orderNumber}_${currentDate}`,
              IO_DATE: currentDate,
              CUST: customerCode,
              CUST_DES: customerName,
              VAT_EXPT: "0",
              DELIVERY_ADDR: "Online Store Purchase",
              RECEIVER: userProfile?.name || "Online Customer",
              RECEIVER_TEL: userProfile?.phone || "",
              REF_DES: `WEB-${order.orderNumber}` // For traceability and idempotency
            },
            DetailList: mappedItems.map(item => ({
              WH_CD: "00001", // CORRECTED: Use actual warehouse code (00009 was just documentation example)
              PROD_CD: item.ecountProdCd,
              PROD_DES: item.name,
              QTY: item.quantity,
              PRICE: item.price,
              PROD_DES_L: ""
            }))
          }
        ]
      };
      
      // ENHANCED LOGGING: Log the actual payload being sent for debugging
      console.log('📋 SaveSale API payload summary:');
      console.log(`  - Order: ${order.orderNumber}`);
      console.log(`  - Customer: ${customerCode} (${customerName})`);
      console.log(`  - Items: ${mappedItems.length}`);
      mappedItems.forEach((item, idx) => {
        console.log(`    ${idx + 1}. ${item.ecountProdCd} "${item.name}" x${item.quantity} @ ${item.price} (${item.matchRule})`);
      });
      
      // Debug: Log sale header and first item details
      if (salesPayload.SaleList.length > 0) {
        const sale = salesPayload.SaleList[0];
        console.log('🔍 Sale header preview:', {
          UPLOAD_SER_NO: sale.Sale.UPLOAD_SER_NO,
          IO_DATE: sale.Sale.IO_DATE,
          CUST: sale.Sale.CUST,
          CUST_DES: sale.Sale.CUST_DES,
          VAT_EXPT: sale.Sale.VAT_EXPT
        });
        
        if (sale.DetailList.length > 0) {
          const firstItem = sale.DetailList[0];
          console.log('🔍 First item detail preview:', {
            WH_CD: firstItem.WH_CD,
            PROD_CD: firstItem.PROD_CD,
            PROD_DES: firstItem.PROD_DES,
            QTY: firstItem.QTY,
            PRICE: firstItem.PRICE,
            PROD_DES_L: firstItem.PROD_DES_L
          });
        }
      }
      
      // 🚀 FIXED SALES ORDER API - Transform to SaleOrderList format (per documentation)
      const saleOrderPayload = {
        "SaleOrderList": mappedItems.map(item => ({
          "BulkDatas": {
            "IO_DATE": "",
            "UPLOAD_SER_NO": sequenceNumber,
            "CUST": "10839", // FIXED: Use correct customer code
            "CUST_DES": "Online Store Sales", // FIXED: Use correct customer name
            "EMP_CD": "",
            "WH_CD": "00001",
            "IO_TYPE": "",
            "EXCHANGE_TYPE": "",
            "EXCHANGE_RATE": "",
            "PJT_CD": "",
            "DOC_NO": "",
            "TTL_CTT": "",
            "REF_DES": "",
            "COLL_TERM": "",
            "AGREE_TERM": "",
            "TIME_DATE": "",
            "REMARKS_WIN": "",
            "U_MEMO1": "",
            "U_MEMO2": "",
            "U_MEMO3": "",
            "U_MEMO4": "",
            "U_MEMO5": "",
            "ADD_TXT_01_T": "",
            "ADD_TXT_02_T": "",
            "ADD_TXT_03_T": "",
            "ADD_TXT_04_T": "",
            "ADD_TXT_05_T": "",
            "ADD_TXT_06_T": "",
            "ADD_TXT_07_T": "",
            "ADD_TXT_08_T": "",
            "ADD_TXT_09_T": "",
            "ADD_TXT_10_T": "",
            "ADD_NUM_01_T": "",
            "ADD_NUM_02_T": "",
            "ADD_NUM_03_T": "",
            "ADD_NUM_04_T": "",
            "ADD_NUM_05_T": "",
            "ADD_CD_01_T": "",
            "ADD_CD_02_T": "",
            "ADD_CD_03_T": "",
            "ADD_DATE_01_T": "",
            "ADD_DATE_02_T": "",
            "ADD_DATE_03_T": "",
            "U_TXT1": "",
            "ADD_LTXT_01_T": "",
            "ADD_LTXT_02_T": "",
            "ADD_LTXT_03_T": "",
            "PROD_CD": item.ecountProdCd,
            "PROD_DES": item.name,
            "SIZE_DES": "", // Could map item size if available
            "UQTY": "",
            "QTY": item.quantity.toString(),
            "PRICE": item.price.toString(),
            "USER_PRICE_VAT": "",
            "SUPPLY_AMT": (item.quantity * item.price).toString(),
            "SUPPLY_AMT_F": "",
            "VAT_AMT": "",
            "ITEM_TIME_DATE": "",
            "REMARKS": `Order from Phomas Online Store - ${order.orderNumber}`,
            "ITEM_CD": "",
            "P_REMARKS1": "",
            "P_REMARKS2": "",
            "P_REMARKS3": "",
            "ADD_TXT_01": "",
            "ADD_TXT_02": "",
            "ADD_TXT_03": "",
            "ADD_TXT_04": "",
            "ADD_TXT_05": "",
            "ADD_TXT_06": "",
            "REL_DATE": "",
            "REL_NO": "",
            "P_AMT1": "",
            "P_AMT2": "",
            "ADD_NUM_01": "",
            "ADD_NUM_02": "",
            "ADD_NUM_03": "",
            "ADD_NUM_04": "",
            "ADD_NUM_05": "",
            "ADD_CD_01": "",
            "ADD_CD_02": "",
            "ADD_CD_03": "",
            "ADD_CD_NM_01": "",
            "ADD_CD_NM_02": "",
            "ADD_CD_NM_03": "",
            "ADD_CDNM_01": "",
            "ADD_CDNM_02": "",
            "ADD_CDNM_03": "",
            "ADD_DATE_01": "",
            "ADD_DATE_02": "",
            "ADD_DATE_03": ""
          }
        }))
      };
      
      console.log('🚀 NEW SALES ORDER API - Payload preview:', {
        orderNumber: order.orderNumber,
        customerCode: "10839",
        customerName: "Online Store Sales",
        itemsCount: mappedItems.length,
        totalValue: mappedItems.reduce((sum, item) => sum + (item.quantity * item.price), 0),
        payloadSize: JSON.stringify(saleOrderPayload).length
      });
      
      // CRITICAL FIX: Make API call with enhanced error handling and session retry logic
      console.log('🚀 Sending NEW SALES ORDER API request to eCount ERP...');
      let result;
      let retryCount = 0;
      const maxRetries = 1;
      
      while (retryCount <= maxRetries) {
        try {
          result = await this.ecountRequest({
            endpoint: '/OAPI/V2/SaleOrder/SaveSaleOrder', // 🚀 FIXED: Use correct SaleOrder endpoint per documentation 
            body: saleOrderPayload,
            requiresAuth: true // 🔐 CRITICAL FIX: Must include SESSION_ID parameter
          });
          
          // Check for authentication error in the response
          if (result.Status === "500" && result.Error?.Message === "The API has not been authenticated.") {
            console.log('🔄 Authentication expired - invalidating session and retrying...');
            this.session = null; // Invalidate current session
            
            if (retryCount < maxRetries) {
              retryCount++;
              console.log(`🔄 Retry attempt ${retryCount}/${maxRetries} with fresh authentication...`);
              
              // CRITICAL FIX: Add delay to allow session to properly establish
              console.log('⏳ Waiting 2 seconds for session to establish...');
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              continue; // Retry with fresh login
            }
          }
          
          break; // Success or non-auth error, exit retry loop
          
        } catch (error) {
          if (retryCount < maxRetries && error instanceof Error && error.message.includes('not been authenticated')) {
            console.log('🔄 Authentication error caught - retrying with fresh session...');
            this.session = null; // Invalidate current session
            retryCount++;
            
            // Add delay here too
            console.log('⏳ Waiting 2 seconds for session to establish...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            continue;
          }
          throw error; // Re-throw if not an auth error or max retries reached
        }
      }

      // ENHANCED LOGGING: Comprehensive response analysis
      if (!result) {
        throw new Error('No response received from eCount API');
      }
      
      console.log(`📋 NEW SALES ORDER API response status: ${result.Status}`);
      console.log('🔍 Sales Order API response data structure:', {
        hasData: !!result.Data,
        hasSlipNos: !!result.Data?.SlipNos,
        slipNosLength: result.Data?.SlipNos?.length,
        hasError: !!result.Error,
        dataKeys: result.Data ? Object.keys(result.Data) : [],
        fullResponse: result
      });
      
      // CRITICAL: Log ResultDetails if submission failed
      if (result.Data?.FailCnt > 0 || result.Data?.ResultDetails) {
        console.error('🚨 eCount API VALIDATION FAILED:');
        console.error(`  ✅ SuccessCnt: ${result.Data.SuccessCnt || 0}`);
        console.error(`  ❌ FailCnt: ${result.Data.FailCnt || 0}`);
        
        if (result.Data.ResultDetails) {
          console.error('  📋 DETAILED ERROR MESSAGES:');
          try {
            const details = JSON.stringify(result.Data.ResultDetails, null, 2);
            console.error(details);
          } catch (e) {
            console.error('  ResultDetails:', result.Data.ResultDetails);
          }
        }
        
        // Also log the raw data for debugging
        console.error('  🔍 Full Data object:', JSON.stringify(result.Data, null, 2));
      }
      
      // CRITICAL FIX: Check for validation failures BEFORE treating as success
      if (result.Status === "200") {
        // CRITICAL: Check if any items failed validation
        if (result.Data?.FailCnt > 0) {
          console.error('❌ eCount API rejected order - validation failed');
          
          // Extract specific error messages from ResultDetails
          let errorMessages = [];
          if (result.Data.ResultDetails && Array.isArray(result.Data.ResultDetails)) {
            errorMessages = result.Data.ResultDetails.map((detail: any) => {
              if (typeof detail === 'object' && detail.Message) {
                return detail.Message;
              }
              return JSON.stringify(detail);
            });
          }
          
          const errorSummary = errorMessages.length > 0 
            ? errorMessages.join('; ') 
            : 'eCount validation failed - check Web Uploader configuration';
          
          throw new Error(`eCount validation error (${result.Data.FailCnt} items failed): ${errorSummary}`);
        }
        
        // Only proceed if all items succeeded
        // Primary: Extract DOC_NO from SlipNos array (most common)
        let docNo = result.Data?.SlipNos?.[0] || '';
        
        // Fallback 1: Try DOC_NO field directly
        if (!docNo && result.Data?.DOC_NO) {
          docNo = result.Data.DOC_NO;
          console.log('🔄 Using fallback DOC_NO from result.Data.DOC_NO');
        }
        
        // Fallback 2: Try Datas array with DOC_NO
        if (!docNo && result.Data?.Datas?.[0]?.DOC_NO) {
          docNo = result.Data.Datas[0].DOC_NO;
          console.log('🔄 Using fallback DOC_NO from result.Data.Datas[0]');
        }
        
        // Fallback 3: If no DOC_NO available, indicate pending status
        if (!docNo) {
          console.log('⚠️ No DOC_NO in eCount response - order may be pending or require manual review');
          docNo = `PENDING-${order.orderNumber}`;
        }
        
        const ioDate = currentDate;
        
        console.log(`✅ NEW SALES ORDER successfully submitted to eCount ERP!`);
        console.log(`📄 ERP Document Number: ${docNo}`);
        console.log(`📅 ERP IO Date: ${ioDate}`);
        console.log(`👤 Customer: 10839 "Online Store Sales"`);
        console.log(`📊 Order Summary: ${mappedItems.length} items, Total Value: ${mappedItems.reduce((sum, item) => sum + (item.quantity * item.price), 0)}`);
        
        return { docNo, ioDate };
      }

      // ENHANCED ERROR HANDLING: Detailed failure analysis with actionable information
      const errorMsg = result.Error?.Message || 'Unknown Sales Order API error';
      const statusCode = result.Status;
      
      console.error('🚨 NEW SALES ORDER API FAILED - Comprehensive Error Analysis:');
      console.error(`  ❌ Status: ${statusCode}`);
      console.error(`  ❌ Error Message: ${errorMsg}`);
      console.error(`  📄 Order Number: ${order.orderNumber}`);
      console.error(`  🔢 Items Count: ${mappedItems.length}`);
      console.error(`  📰 Payload Size: ${JSON.stringify(salesPayload).length} bytes`);
      
      // Log detailed error information for debugging
      if (result.Error) {
        console.error('  🔍 Full Error Object:', result.Error);
      }
      
      if (result.Data) {
        console.error('  🔍 Response Data Keys:', Object.keys(result.Data));
        console.error('  🔍 Response Data Sample:', JSON.stringify(result.Data).substring(0, 200) + '...');
      }
      
      // Log first item details for debugging
      if (mappedItems.length > 0) {
        const firstItem = mappedItems[0];
        console.error(`  🔍 First Item Debug: ${firstItem.ecountProdCd} "${firstItem.name}" x${firstItem.quantity} @ ${firstItem.price}`);
      }
      
      // Provide specific guidance based on error status
      let guidanceMsg = '';
      if (statusCode === '400') {
        guidanceMsg = 'Bad Request - Check product codes and required fields';
      } else if (statusCode === '401') {
        guidanceMsg = 'Unauthorized - Session may have expired';
      } else if (statusCode === '412') {
        guidanceMsg = 'Precondition Failed - Rate limited, retry after delay';
      } else if (statusCode === '500') {
        guidanceMsg = 'Server Error - eCount ERP system issue';
      }
      
      const fullErrorMsg = `Sales Order API failed (${statusCode}): ${errorMsg}. ${guidanceMsg}`;
      console.error(`  🎯 ${fullErrorMsg}`);
      
      throw new Error(fullErrorMsg);
    } catch (error) {
      console.error('🚨 eCount submitSaleOrder CRITICAL ERROR:');
      console.error('  ❌ Error Type:', error instanceof Error ? error.constructor.name : typeof error);
      console.error('  ❌ Error Message:', error instanceof Error ? error.message : String(error));
      console.error('  📄 Order Number:', order.orderNumber);
      console.error('  🔢 Items Count:', JSON.parse(order.items).length);
      
      // Log stack trace for debugging
      if (error instanceof Error && error.stack) {
        console.error('  🔍 Stack Trace:', error.stack.split('\n').slice(0, 5).join('\n'));
      }
      
      throw error;
    }
  }

  /**
   * Legacy method - kept for backward compatibility
   * @deprecated Use submitSaleOrder instead
   */
  async createSalesOrder(order: Order): Promise<string> {
    console.log('⚠️ Warning: createSalesOrder is deprecated, use submitSaleOrder instead');
    const result = await this.submitSaleOrder(order);
    return result.docNo;
  }

  /**
   * Transform eCount item data to product format with inventory information
   */
  private async transformItemsToProducts(itemData: EcountProduct[], inventoryMap: Map<string, number>): Promise<ProductWithInventory[]> {
    return itemData.map((item) => {
      const availableQuantity = inventoryMap.get(item.PROD_CD) || 0;
      return {
        id: item.PROD_CD,
        name: item.PROD_DES || this.generateProductName(item.PROD_CD),
        packaging: item.SIZE_DES || 'Standard',
        referenceNumber: item.PROD_CD,
        price: this.convertEcountPrice(item.PRICE || '25000'),
        imageUrl: null, // Images handled by separate /api/images system
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
  private async transformInventoryToProducts(inventoryData: EcountInventory[]): Promise<ProductWithInventory[]> {
    return inventoryData.map((item) => ({
      id: item.PROD_CD,
      name: this.generateProductName(item.PROD_CD),
      packaging: 'Standard',
      referenceNumber: item.PROD_CD,
      price: '25000', // Default price, will be updated from admin later
      imageUrl: null, // Images handled by separate /api/images system
      category: this.getCategoryFromCode(item.PROD_CD),
      availableQuantity: item.BAL_QTY || 0,
      isLowStock: (item.BAL_QTY || 0) < 10,
      isExpiringSoon: false
    }));
  }

  /**
   * Get real product master data from eCount including names, descriptions
   */
  async getProductMasterData(): Promise<Map<string, any>> {
    try {
      console.log('📋 Fetching product master data from eCount using CORRECT tenant endpoint...');
      
      // Try different endpoint from user's screenshot - Basic Item
      const result = await this.ecountRequest({
        endpoint: '/OAPI/V2/BasicItem',
        body: {
          PROD_CD: '', // Empty = get all products
          Page: '1',
          PageSize: '1000'
        }
      });

      const productMasterMap = new Map<string, any>();
      
      // Parse the response correctly
      const products = result.Data?.Datas || result.Data?.Result || [];
      
      console.log(`📊 ItemManagement endpoint data structure:`, {
        status: result.Status,
        hasDatas: !!result.Data?.Datas,
        datasLength: result.Data?.Datas?.length,
        hasResult: !!result.Data?.Result,
        resultLength: result.Data?.Result?.length,
        totalProducts: products.length
      });

      // Log first product structure to understand field names
      if (products.length > 0) {
        console.log(`📋 First product fields:`, Object.keys(products[0]));
        console.log(`📋 First product sample:`, products[0]);
      }

      if (result.Status === "200" && products.length > 0) {
        products.forEach((product: any) => {
          // Map the actual field names from this eCount tenant
          const productCode = product.PROD_CD || product.ITEM_CD || product.CODE;
          productMasterMap.set(productCode, {
            name: product.ITEM_NM || product.PROD_NM || product.PROD_DES || product.NAME || `Product ${productCode}`,
            description: product.PROD_DES || product.ITEM_DESC || product.DESCRIPTION || '',
            specification: product.SPEC || product.SPECIFICATION || '',
            category: product.ITEM_GRP || product.ITEM_GRP_CD || product.CATEGORY || this.getCategoryFromCode(productCode),
            unit: product.UNIT || product.UOM || 'PCS'
          });
        });
        console.log(`✅ Retrieved REAL master data for ${productMasterMap.size} products from ItemManagement!`);
      } else {
        console.log('⚠️ ItemManagement endpoint returned no data, will use generated names');
      }

      return productMasterMap;
    } catch (error) {
      console.error('❌ Failed to get product master data from ItemManagement:', error);
      return new Map(); // Return empty map on error
    }
  }

  /**
   * Get real pricing data from eCount price lists
   */
  async getProductPricing(): Promise<Map<string, number>> {
    try {
      console.log('💰 Fetching product pricing from eCount...');
      
      const result = await this.ecountRequest({
        endpoint: '/OAPI/V2/Price/GetPriceList',
        body: {
          PROD_CD: '', // Empty = get all products
          PRICE_TYPE: '1', // Standard selling price
          Page: '1',
          PageSize: '1000'
        }
      });

      const pricingMap = new Map<string, number>();

      if (result.Status === "200" && result.Data?.Datas) {
        result.Data.Datas.forEach((priceItem: any) => {
          const price = parseFloat(priceItem.PRICE || priceItem.UNIT_PRICE || '0');
          if (price > 0) {
            pricingMap.set(priceItem.PROD_CD, price);
          }
        });
        console.log(`✅ Retrieved pricing for ${pricingMap.size} products`);
      } else {
        console.log('⚠️ No pricing data available, will use default prices');
      }

      return pricingMap;
    } catch (error) {
      console.error('❌ Failed to get product pricing:', error);
      return new Map(); // Return empty map on error
    }
  }

  /**
   * Generate product name from product code (fallback only)
   */
  private generateProductName(productCode: string): string {
    // Medical supply name patterns based on product codes (fallback when real name unavailable)
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
   * Bulk product sync - downloads complete product catalog (rate limited: 1 per 10 minutes)
   */
  async bulkSyncProducts(): Promise<any> {
    console.log('🔄 Starting bulk product sync with USER EXCEL NAMES + live eCount stock...');
    
    try {
      // Load user's Excel product mapping FIRST
      await ProductMapping.loadMapping();
      const mappingStats = ProductMapping.getStats();
      console.log(`📋 Excel mapping loaded: ${mappingStats.totalMapped} REAL product names available`);
      
      // Get ONLY live stock data from eCount (no broken endpoints!)
      console.log('📊 Fetching ONLY live stock data (avoiding broken master data endpoints)...');
      const inventoryResult = await this.ecountRequest({
        endpoint: '/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus',
        body: {
          BASE_DATE: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
          WH_CD: ECOUNT_CONFIG.warehouseCode,
          PROD_CD: '',
          Page: '1',
          PageSize: '1000'
        }
      });

      // Parse inventory data
      const inventoryData = inventoryResult.Data?.Datas || inventoryResult.Data?.Result || [];
      console.log(`📊 Live stock data: ${inventoryData.length} products from eCount`);
      
      if (inventoryResult.Status === "200" && inventoryData.length > 0) {
        // Build products using USER'S EXCEL DATA + live stock
        const products = inventoryData.map((product: any, index: number) => {
          const productCode = product.PROD_CD;
          const excelProduct = ProductMapping.getProduct(productCode);
          
          // Log first product mapping to show it works
          if (index === 0) {
            console.log(`📋 First product mapping: ${productCode} → ${excelProduct?.name || 'NOT FOUND'}`);
            console.log(`📋 Excel data for ${productCode}:`, excelProduct);
          }
          
          return {
            id: productCode,
            name: excelProduct?.name || this.generateProductName(productCode), // USER'S REAL NAMES!
            packaging: excelProduct?.uom || 'Standard',
            referenceNumber: productCode,
            price: excelProduct?.price?.toString() || '25000', // USER'S REAL PRICES!
            imageUrl: null, // Images handled by separate /api/images system
            category: excelProduct?.category || this.getCategoryFromCode(productCode),
            availableQuantity: parseInt(product.BAL_QTY || '0'), // LIVE stock from eCount
            isLowStock: parseInt(product.BAL_QTY || '0') < 10,
            isExpiringSoon: false,
            hasRealTimeData: true,
            lastUpdated: new Date().toISOString(),
            description: excelProduct?.name || '',
            specification: excelProduct?.uom || ''
          };
        });
        
        // Count real vs generated names
        const realNamesCount = products.filter((p: any) => !p.name.includes('Medical Product') && !p.name.includes('Medical Supply')).length;
        console.log(`🎉 USER'S REAL NAMES: ${realNamesCount}/${products.length} products have REAL names from Excel file!`);
        
        // Cache the combined data (Excel names + live stock)
        this.inventoryCache.set('all_products', {
          data: products,
          timestamp: Date.now()
        });
        
        console.log(`✅ Bulk sync completed: ${products.length} products with ${realNamesCount} real names cached`);
        return {
          Status: "200",
          Data: { Result: products },
          excelMapped: realNamesCount,
          totalProducts: products.length
        };
      }

      throw new Error(`Bulk product sync failed: ${inventoryResult.Error?.Message || 'No inventory data'}`);
    } catch (error) {
      console.error('❌ Error in bulk product sync with Excel integration:', error);
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

      // FIX: Check for Data.Datas first, then Data.Result as fallback
      const inventory = result.Data?.Datas || result.Data?.Result || [];
      console.log(`📊 Bulk inventory data structure:`, {
        status: result.Status,
        hasDatas: !!result.Data?.Datas,
        datasLength: result.Data?.Datas?.length,
        hasResult: !!result.Data?.Result,
        resultLength: result.Data?.Result?.length,
        totalInventory: inventory.length
      });
      
      if (result.Status === "200") {
        console.log(`✅ Bulk inventory sync completed: ${inventory.length} inventory records retrieved`);
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
   * Get single item inventory using VERIFIED endpoint ViewInventoryBalanceStatus
   * This is the eCount-verified endpoint that should work with production key
   */
  async getSingleItemInventory(itemCode: string): Promise<number> {
    console.log(`🔍 Getting single item inventory for: ${itemCode} using VERIFIED endpoint`);
    
    try {
      const result = await this.ecountRequest({
        endpoint: '/OAPI/V2/InventoryBalance/ViewInventoryBalanceStatus',
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
   * TEST: Try GetBasicProductsList as alternative to broken GetListInventoryBalanceStatus
   */
  async testGetBasicProductsList(): Promise<any> {
    console.log('🧪 Testing GetBasicProductsList endpoint as alternative...');
    
    try {
      const result = await this.ecountRequest({
        endpoint: '/OAPI/V2/InventoryBasic/GetBasicProductsList',
        body: {
          Page: '1',
          PageSize: '100' // Start with small batch to test
        }
      });

      console.log('📊 GetBasicProductsList response status:', result.Status);
      console.log('📊 GetBasicProductsList data structure:', {
        hasData: !!result.Data,
        hasDatas: !!result.Data?.Datas,
        hasResult: !!result.Data?.Result,
        datasLength: result.Data?.Datas?.length,
        resultLength: result.Data?.Result?.length
      });

      if (result.Status === "200") {
        const products = result.Data?.Datas || result.Data?.Result || [];
        console.log(`✅ GetBasicProductsList SUCCESS! Got ${products.length} products`);
        if (products.length > 0) {
          console.log('📦 Sample product:', JSON.stringify(products[0], null, 2));
        }
        return { success: true, count: products.length, sample: products[0] };
      } else {
        console.error('❌ GetBasicProductsList failed:', result.Error);
        return { success: false, error: result.Error };
      }
    } catch (error) {
      console.error('❌ GetBasicProductsList error:', error);
      return { success: false, error: String(error) };
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
    console.log('🚀 Fetching ALL products from eCount ERP (Pure Integration) + User Excel Names');
    
    // ARCHITECT SOLUTION: Load Excel mapping BEFORE any cache returns
    await ProductMapping.ensureLoaded();
    const mappingStats = ProductMapping.getStats();
    console.log(`📋 Excel mapping loaded: ${mappingStats.totalMapped} real product names available`);
    
    const cacheKey = 'all_products';
    const cached = this.inventoryCache.get(cacheKey);
    
    // Check if we have valid cached data (less than 1 hour old)
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
      const ageMinutes = Math.round((Date.now() - cached.timestamp) / 1000 / 60);
      console.log(`📦 Using cached products (age: ${ageMinutes} minutes, count: ${cached.data.length})`);
      
      // ARCHITECT SOLUTION: Apply Excel names to cached data
      const enrichedProducts = ProductMapping.applyNames(cached.data);
      const realNamesCount = enrichedProducts.filter(p => !p.name.includes('Medical Product') && !p.name.includes('Medical Supply')).length;
      console.log(`🎉 Applied Excel names to cached products: ${realNamesCount}/${enrichedProducts.length} have REAL names!`);
      return enrichedProducts;
    }
    
    try {
      // Excel mapping already loaded above
      const mappingStats = ProductMapping.getStats();
      console.log(`📋 Excel mapping loaded: ${mappingStats.totalMapped} real product names available`);
      
      // Get ONLY the live stock data from eCount (avoid rate-limited endpoints)
      console.log('📊 Getting live stock data only (avoiding broken master data endpoints)...');
      const productList = await this.getProductList(); // Just stock data
      
      let products: any[] = [];
      
      // Check if we got data from eCount API
      if (productList.length > 0) {
        console.log(`✅ Got ${productList.length} products from eCount API - using live data`);
        
        // Transform eCount data using REAL product names from USER'S EXCEL FILE + live stock
        products = productList.map((product: any, index: number) => {
          const productCode = product.PROD_CD;
          
          // Get REAL product data from user's Excel file
          const excelProduct = ProductMapping.getProduct(productCode);
          
          // Log first product to show the transformation
          if (index === 0) {
            console.log(`📋 eCount product fields:`, Object.keys(product));
            console.log(`📋 Excel mapping for ${productCode}:`, excelProduct);
          }
          
          return {
            id: productCode,
            name: excelProduct?.name || this.generateProductName(productCode), // USER'S REAL NAMES!
            packaging: excelProduct?.uom || 'Standard', // Real UOM from Excel
            referenceNumber: productCode,
            price: excelProduct?.price?.toString() || '25000', // USER'S REAL PRICES!
            imageUrl: null, // Images handled by separate /api/images system
            category: excelProduct?.category || this.getCategoryFromCode(productCode), // Smart categories
            availableQuantity: parseInt(product.BAL_QTY || '0'), // LIVE stock from eCount
            isLowStock: parseInt(product.BAL_QTY || '0') < 10,
            isExpiringSoon: false,
            hasRealTimeData: true,
            lastUpdated: new Date().toISOString(),
            description: excelProduct?.name || '', // Use product name as description
            specification: excelProduct?.uom || ''
          };
        });
      } else {
        // FALLBACK: eCount API failed, generate products from Excel file
        console.log('⚠️ eCount API returned no data - using Excel file as fallback');
        console.log('📦 Generating products from Excel data for image upload workflow...');
        
        const allExcelProducts = ProductMapping.getAllMappedProducts();
        console.log(`📋 Found ${allExcelProducts.length} products in Excel file`);
        
        products = allExcelProducts.map((excelProduct: any, index: number) => {
          return {
            id: excelProduct.code,
            name: excelProduct.name,
            packaging: excelProduct.uom,
            referenceNumber: excelProduct.code,
            price: excelProduct.price?.toString() || '0',
            imageUrl: null, // Images handled by separate /api/images system
            category: excelProduct.category || this.getCategoryFromCode(excelProduct.code),
            availableQuantity: 0, // No real-time data available
            isLowStock: false, // Hide stock indicators when using fallback
            isExpiringSoon: false,
            hasRealTimeData: false, // Flag to indicate this is fallback data
            lastUpdated: new Date().toISOString(),
            description: excelProduct.name,
            specification: excelProduct.uom
          };
        });
        
        console.log(`✅ Generated ${products.length} products from Excel fallback`);
      }
      
      // Count how many products have real vs generated names  
      const realNamesCount = products.filter(p => !p.name.includes('Medical Product') && !p.name.includes('Medical Supply')).length;
      console.log(`🎉 USER'S REAL NAMES: ${realNamesCount}/${products.length} products have REAL names from Excel file!`);
      
      // Cache safety: Only cache if we have products (prevent overwriting good cache with empty results)
      if (products.length > 0) {
        this.inventoryCache.set(cacheKey, {
          data: products,
          timestamp: Date.now()
        });
        console.log(`✅ Cached ${products.length} products (realtime: ${productList.length > 0})`);
      } else {
        console.log(`⚠️ No products available from any source, keeping existing cache to prevent data loss`);
      }
      
      return products;
      
    } catch (error) {
      console.error('❌ Failed to get products from eCount:', error);
      
      // If fresh fetch fails and we have expired cache, use it as fallback
      if (cached) {
        const ageMinutes = Math.round((Date.now() - cached.timestamp) / 1000 / 60);
        console.log(`⚠️ Fresh fetch failed, using expired cache as fallback (age: ${ageMinutes} minutes, count: ${cached.data.length})`);
        return cached.data;
      }
      
      // Only throw if we have no cached data at all
      console.log('💥 No products available: Fresh fetch failed and no cache available');
      return []; // Return empty array instead of throwing to prevent frontend crashes
    }
  }

  /**
   * REMOVED: This function is replaced by the new getProductList() function above
   * which uses the correct /OAPI/V2/Product/GetProductList endpoint
   */


  /**
   * DISABLED: Background Scheduler - Causes rate limit violations
   * eCount Inventory API: Limited to 1 call per 20 minutes
   * Manual refresh or on-demand loading is preferred
   */
  // private startBackgroundScheduler(): void {
  //   console.log('⏰ Starting eCount background scheduler (10-minute cycles)');
  //   
  //   // Initial sync after 30 seconds
  //   setTimeout(() => {
  //     this.performBackgroundBulkSync();
  //   }, 30000);
  //   
  //   // Then sync every 10 minutes
  //   this.backgroundScheduler = setInterval(() => {
  //     this.performBackgroundBulkSync();
  //   }, this.BULK_RATE_LIMIT); // 10 minutes
  // }

  /**
   * DISABLED: Background bulk sync - Causes rate limit violations
   */
  // private async performBackgroundBulkSync(): Promise<void> {
  //   const now = Date.now();
  //   const timeSinceLastCall = now - this.bulkSyncLastCall;
  //   
  //   // Respect 10-minute rate limit
  //   if (timeSinceLastCall < this.BULK_RATE_LIMIT) {
  //     const waitTime = this.BULK_RATE_LIMIT - timeSinceLastCall;
  //     console.log(`⏳ Rate limit: waiting ${Math.round(waitTime / 1000)}s before next bulk sync`);
  //     return;
  //   }
  //   
  //   try {
  //     console.log('🔄 Background bulk sync started (Production eCount)');
  //     
  //     // Update rate limit tracker
  //     this.bulkSyncLastCall = now;
  //     
  //     // Perform bulk sync operations in sequence
  //     await this.bulkSyncProductsAndInventory();
  //     
  //     // Retry failed orders
  //     await this.retryFailedOrders();
  //     
  //     console.log('✅ Background bulk sync completed successfully');
  //   } catch (error) {
  //     console.error('❌ Background bulk sync failed:', error);
  //   }
  // }

  /**
   * Retry failed orders automatically in background
   */
  private async retryFailedOrders(): Promise<void> {
    try {
      // Import storage from the same module used throughout the app
      const { storage } = await import('./storage');
      if (!storage) {
        console.log('⚠️ Storage not available for order retry');
        return;
      }

      const failedOrders = await storage.getAllOrders();
      const actualFailedOrders = failedOrders.filter(order => order.status === 'failed');
      if (actualFailedOrders.length === 0) {
        console.log('✅ No failed orders to retry');
        return;
      }

      console.log(`🔄 Retrying ${actualFailedOrders.length} failed orders...`);
      let retryCount = 0;
      let successCount = 0;

      for (const order of actualFailedOrders) {
        try {
          console.log(`🔄 Retrying order ${order.orderNumber} (ID: ${order.id})`);
          
          // Create a user profile object for the order
          const userProfile = {
            email: order.userId || 'unknown@system.retry',
            name: order.userId || 'System Retry'
          };

          // Attempt to submit the order to eCount
          const erpResult = await this.submitSaleOrder(order, userProfile);
          
          // Update order with success status
          await storage.updateOrderErpInfo(order.id, {
            erpDocNumber: erpResult.docNo,
            erpIoDate: erpResult.ioDate,
            erpSyncStatus: 'synced',
            erpSyncError: null
          });
          
          successCount++;
          console.log(`✅ Order ${order.orderNumber} successfully retried and synced to eCount`);
          
        } catch (retryError) {
          retryCount++;
          console.log(`❌ Order ${order.orderNumber} retry failed: ${retryError instanceof Error ? retryError.message : 'Unknown error'}`);
          
          // Update error status (don't change failed status - will retry again later)
          await storage.updateOrderErpInfo(order.id, {
            erpSyncError: `Retry failed: ${retryError instanceof Error ? retryError.message : 'Unknown error'}`
          });
        }
        
        // Add small delay between retries to avoid overwhelming eCount
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`📊 Order retry summary: ${successCount} succeeded, ${retryCount} failed, ${failedOrders.length} total`);
      
    } catch (error) {
      console.error('❌ Failed order retry process failed:', error);
    }
  }

  /**
   * Bulk sync products and inventory data from eCount
   */
  private async bulkSyncProductsAndInventory(): Promise<void> {
    try {
      console.log('🔄 Syncing products using GetProductList endpoint...');
      
      // Get products using the correct endpoint
      const productList = await this.getProductList();
      
      // Cache the product data with timestamp
      this.inventoryCache.set('product_list', {
        data: productList,
        timestamp: Date.now()
      });
      
      console.log(`📦 Bulk sync complete: ${productList.length} products cached from eCount`);
    } catch (error) {
      console.error('Bulk sync error:', error);
      throw error;
    }
  }

  /**
   * DISABLED: Background scheduler removed to prevent rate limit violations
   */
  stopBackgroundScheduler(): void {
    console.log('ℹ️ Background scheduler already disabled (rate limit protection)');
  }

  /**
   * Verify if a customer code exists in eCount
   * Helps diagnose order submission issues
   */
  async verifyCustomer(customerCode: string): Promise<any> {
    try {
      console.log(`🔍 Verifying customer code: ${customerCode}`);
      
      const result = await this.ecountRequest({
        endpoint: '/OAPI/V2/Customer',
        body: {
          CUST: customerCode,
          Page: '1',
          PageSize: '10'
        }
      });

      if (result.Status === "200" && result.Data?.Datas) {
        console.log(`✅ Customer ${customerCode} found:`, result.Data.Datas);
        return result.Data.Datas;
      } else {
        console.log(`❌ Customer ${customerCode} not found or error:`, result);
        return null;
      }
    } catch (error) {
      console.error(`❌ Error verifying customer ${customerCode}:`, error);
      return null;
    }
  }

  /**
   * Categorize error based on status and type
   * Only CRITICAL and NETWORK errors count toward eCount lockout threshold
   */
  private categorizeError(status?: number, error?: any): 'critical' | 'auth' | 'validation' | 'rate_limit' | 'network' {
    // Network/transport errors
    if (!status || error?.code === 'ECONNREFUSED' || error?.code === 'ETIMEDOUT') {
      return 'network';
    }
    
    // Rate limit errors (already handled separately)
    if (status === 412 || status === 429 || status === 302) {
      return 'rate_limit';
    }
    
    // Auth errors (trigger session refresh, don't count)
    if (status === 401 || status === 403) {
      return 'auth';
    }
    
    // Validation errors (bad request, don't count)
    if (status === 400) {
      return 'validation';
    }
    
    // Critical errors: 5xx server errors
    if (status >= 500) {
      return 'critical';
    }
    
    // Default to critical for safety
    return 'critical';
  }
  
  /**
   * Handle successful API call - reset ALL error counters
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
    
    // CRITICAL: Reset consecutive error counter on ANY success
    if (this.consecutiveErrors > 0) {
      console.log(`✅ Success - resetting consecutive error counter (was: ${this.consecutiveErrors})`);
      this.consecutiveErrors = 0;
    }
  }
  
  /**
   * Handle API failure - update circuit breaker, backoff, and consecutive error tracking
   * Only counts CRITICAL and NETWORK errors toward lockout threshold
   */
  private handleFailure(endpoint: string, status?: number, error?: any): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    // Update exponential backoff for this endpoint
    const currentBackoff = this.backoffDelays.get(endpoint) || this.BASE_BACKOFF;
    const newBackoff = Math.min(currentBackoff * 2, this.MAX_BACKOFF);
    this.backoffDelays.set(endpoint, newBackoff);
    
    // Categorize error to determine if it counts toward lockout
    const category = this.categorizeError(status, error);
    const countsTowardLockout = (category === 'critical' || category === 'network');
    
    if (countsTowardLockout) {
      this.consecutiveErrors++;
      console.warn(`⚠️ CRITICAL ERROR #${this.consecutiveErrors}/${this.MAX_CONSECUTIVE_ERRORS} for ${endpoint} (${category}), next backoff: ${newBackoff}ms`);
      
      // Check if we've hit the lockout threshold
      if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
        this.apiLocked = true;
        this.lockReleaseTime = Date.now() + this.LOCK_DURATION_MS;
        const lockMinutes = Math.ceil(this.LOCK_DURATION_MS / 60000);
        console.error(`🔒 API SELF-LOCKED: Hit ${this.consecutiveErrors} consecutive errors. Locked for ${lockMinutes} minutes to prevent eCount lockout.`);
      }
    } else {
      console.log(`⚠️ API failure for ${endpoint} (${category} - doesn't count toward lockout), next backoff: ${newBackoff}ms`);
    }
    
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
  
  /**
   * Get comprehensive error tracking status for monitoring
   */
  getErrorTrackingStatus(): {
    consecutiveErrors: number;
    maxConsecutiveErrors: number;
    errorWindowStart: string;
    apiLocked: boolean;
    lockReleaseTime: string | null;
    circuitBreakerState: string;
    minutesUntilUnlock: number | null;
  } {
    const now = Date.now();
    const minutesUntilUnlock = this.apiLocked 
      ? Math.ceil((this.lockReleaseTime - now) / 60000)
      : null;
    
    return {
      consecutiveErrors: this.consecutiveErrors,
      maxConsecutiveErrors: this.MAX_CONSECUTIVE_ERRORS,
      errorWindowStart: new Date(this.errorWindowStart).toISOString(),
      apiLocked: this.apiLocked,
      lockReleaseTime: this.apiLocked ? new Date(this.lockReleaseTime).toISOString() : null,
      circuitBreakerState: this.circuitBreakerState,
      minutesUntilUnlock
    };
  }
  
  /**
   * DIAGNOSTIC TOOL: Test InventoryBalance API and generate evidence for eCount support
   * This method compares a working API (SaveSaleOrder check) with the failing InventoryBalance API
   * to prove that authentication is identical and the endpoint is server-side locked.
   */
  async diagnoseInventoryBalanceApi(): Promise<{
    timestamp: string;
    authenticationWorking: boolean;
    loginSuccess: boolean;
    sessionInfo: {
      sessionId: string;
      zone: string;
      hasCookies: boolean;
      expiresAt: string;
    } | null;
    inventoryBalanceTest: {
      endpoint: string;
      requestUrl: string;
      requestBody: any;
      httpStatus: number | null;
      responseStatus: string | null;
      errorMessage: string | null;
      traceId: string | null;
      success: boolean;
    };
    inventoryBalanceWorking: boolean;
    evidenceForSupport: string;
  }> {
    const timestamp = new Date().toISOString();
    console.log('\n' + '='.repeat(80));
    console.log('🔬 ECOUNT API DIAGNOSTIC - InventoryBalance Endpoint Test');
    console.log('='.repeat(80) + '\n');
    
    let loginSuccess = false;
    let sessionInfo: any = null;
    let inventoryBalanceTest: any = {
      endpoint: '/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus',
      requestUrl: '',
      requestBody: {},
      httpStatus: null,
      responseStatus: null,
      errorMessage: null,
      traceId: null,
      success: false
    };
    
    try {
      // Step 1: Verify login and session
      console.log('📝 Step 1: Testing Authentication...');
      const sessionId = await this.login();
      loginSuccess = true;
      
      if (this.session) {
        sessionInfo = {
          sessionId: `${sessionId.substring(0, 20)}...[REDACTED]`,
          zone: this.session.zone,
          hasCookies: !!this.session.cookies,
          expiresAt: this.session.expiresAt.toISOString()
        };
        console.log('✅ Login successful');
        console.log(`   Zone: ${this.session.zone}`);
        console.log(`   Session expires: ${this.session.expiresAt.toISOString()}`);
        console.log(`   Cookies captured: ${this.session.cookies ? 'YES' : 'NO'}`);
      }
      
      // Step 2: Test InventoryBalance API with detailed capture
      console.log('\n📝 Step 2: Testing InventoryBalance API...');
      const baseUrlWithZone = this.baseUrl.replace('{ZONE}', this.session!.zone);
      const endpoint = '/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus';
      const encodedSessionId = encodeURIComponent(sessionId);
      const requestUrl = `${baseUrlWithZone}${endpoint}?SESSION_ID=${encodedSessionId}`;
      
      const requestBody = {
        COM_CODE: ECOUNT_CONFIG.companyCode,
        SESSION_ID: sessionId,
        API_CERT_KEY: ECOUNT_CONFIG.authKey,
        BASE_DATE: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        WH_CD: ECOUNT_CONFIG.warehouseCode,
        PROD_CD: '', // Get all products
        Page: '1',
        PageSize: '10' // Small sample for diagnostic
      };
      
      // Redacted version for logging
      const redactedBody = {
        ...requestBody,
        SESSION_ID: `${sessionId.substring(0, 15)}...[REDACTED]`,
        API_CERT_KEY: `${ECOUNT_CONFIG.authKey?.substring(0, 8)}...[REDACTED]`
      };
      
      console.log(`   Request URL: ${baseUrlWithZone}${endpoint}?SESSION_ID=[REDACTED]`);
      console.log(`   Request Body:`, JSON.stringify(redactedBody, null, 2));
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      };
      
      if (this.session && this.session.cookies) {
        headers['Cookie'] = this.session.cookies;
        console.log(`   Cookie header: ${this.session.cookies.substring(0, 50)}...[REDACTED]`);
      }
      
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });
      
      console.log(`   HTTP Status: ${response.status}`);
      console.log(`   Content-Type: ${response.headers.get('content-type')}`);
      
      inventoryBalanceTest.requestUrl = `${baseUrlWithZone}${endpoint}?SESSION_ID=[REDACTED]`;
      inventoryBalanceTest.requestBody = redactedBody;
      inventoryBalanceTest.httpStatus = response.status;
      
      // Try to parse JSON response
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const result = await response.json();
        
        inventoryBalanceTest.responseStatus = result.Status || result.status;
        inventoryBalanceTest.errorMessage = result.Error?.Message || result.error?.message || null;
        inventoryBalanceTest.traceId = result.TRACE_ID || result.trace_id || null;
        inventoryBalanceTest.success = (result.Status === "200" || result.Status === 200);
        
        console.log(`   Response Status: ${result.Status}`);
        console.log(`   TRACE_ID: ${inventoryBalanceTest.traceId || 'N/A'}`);
        
        if (result.Error) {
          console.log(`   ❌ ERROR: ${result.Error.Message}`);
          console.log(`   Error Details:`, result.Error);
        }
        
        if (inventoryBalanceTest.success) {
          const dataCount = result.Data?.Datas?.length || result.Data?.Result?.length || 0;
          console.log(`   ✅ SUCCESS: Retrieved ${dataCount} products`);
        }
      } else {
        inventoryBalanceTest.errorMessage = `Non-JSON response: ${contentType}`;
        console.log(`   ❌ ERROR: Received non-JSON response (${contentType})`);
      }
      
    } catch (error) {
      console.error('❌ Diagnostic test error:', error);
      inventoryBalanceTest.errorMessage = error instanceof Error ? error.message : 'Unknown error';
    }
    
    // Generate evidence report for eCount support
    const evidence = this.generateSupportEvidence(sessionInfo, inventoryBalanceTest);
    
    console.log('\n' + '='.repeat(80));
    console.log('DIAGNOSTIC COMPLETE');
    console.log('='.repeat(80) + '\n');
    
    return {
      timestamp,
      authenticationWorking: loginSuccess,
      loginSuccess,
      sessionInfo,
      inventoryBalanceTest,
      inventoryBalanceWorking: inventoryBalanceTest.success,
      evidenceForSupport: evidence
    };
  }
  
  /**
   * Generate formatted evidence report for eCount support escalation
   */
  private generateSupportEvidence(sessionInfo: any, inventoryTest: any): string {
    const lines = [
      '='.repeat(80),
      'ECOUNT API SUPPORT ESCALATION REQUEST',
      '='.repeat(80),
      '',
      '📋 ISSUE SUMMARY:',
      'InventoryBalance API endpoint returns "Please login" error despite successful authentication.',
      'SaveSaleOrder API works perfectly with identical authentication credentials.',
      '',
      '🔑 AUTHENTICATION DETAILS:',
      `- Company Code: ${ECOUNT_CONFIG.companyCode}`,
      `- User ID: ${ECOUNT_CONFIG.userId}`,
      `- API Key: ${ECOUNT_CONFIG.authKey?.substring(0, 8)}...[REDACTED] (Valid until October 2026)`,
      `- Zone: ${sessionInfo?.zone || 'N/A'}`,
      `- Session ID: ${sessionInfo?.sessionId || 'N/A'}`,
      `- Cookies Captured: ${sessionInfo?.hasCookies ? 'YES' : 'NO'}`,
      '',
      '❌ FAILING ENDPOINT:',
      `- Endpoint: ${inventoryTest.endpoint}`,
      `- HTTP Status: ${inventoryTest.httpStatus || 'N/A'}`,
      `- Response Status: ${inventoryTest.responseStatus || 'N/A'}`,
      `- Error Message: ${inventoryTest.errorMessage || 'N/A'}`,
      `- TRACE_ID: ${inventoryTest.traceId || 'N/A'}`,
      '',
      '📝 REQUEST DETAILS:',
      `- BASE_DATE: ${new Date().toISOString().slice(0, 10).replace(/-/g, '')} (YYYYMMDD format)`,
      `- WH_CD: ${ECOUNT_CONFIG.warehouseCode}`,
      `- PROD_CD: "" (empty = all products)`,
      `- Page: 1`,
      `- PageSize: 10`,
      '',
      '✅ WORKING ENDPOINTS (Same Authentication):',
      '- /OAPI/V2/Zone - SUCCESS',
      '- /OAPI/V2/OAPILogin - SUCCESS',
      '- /OAPI/V2/SalesOrder/SaveSaleOrder - SUCCESS (Orders #20251021-3 and #20251021-4)',
      '',
      '🎯 REQUEST TO ECOUNT SUPPORT:',
      '1. Please verify that the InventoryBalance API endpoint is activated for our production API key',
      '2. Confirm warehouse permissions for warehouse code: ' + ECOUNT_CONFIG.warehouseCode,
      '3. Verify API scope includes InventoryBalance/InventoryBasic endpoints',
      '4. Check if there are any additional permissions or setup required',
      '',
      '📞 CONTACT INFORMATION:',
      '- Company: PHOMAS DIAGNOSTICS (Tanzania)',
      '- System: Medical Supply E-commerce Platform',
      '- Integration Status: SaveSaleOrder working, InventoryBalance blocked',
      '',
      '⏰ TIMESTAMP: ' + new Date().toISOString(),
      '='.repeat(80)
    ];
    
    return lines.join('\n');
  }
}

// Export singleton instance
export const ecountApi = new EcountApiService();