#!/bin/bash

# Test eCount SaveSaleOrder API with cURL
# This script will help diagnose authentication issues

echo "🔐 Step 1: Getting eCount Zone..."

# Use Zone IA directly (we know this from logs)
ZONE="IA"
echo "✅ Using Zone: $ZONE"

# Build the login URL
LOGIN_URL="https://oapi${ZONE}.ecount.com/OAPI/V2/OAPILogin"

echo ""
echo "🔐 Step 2: Logging in to eCount..."
echo "Login URL: $LOGIN_URL"

# Login and capture cookies (using hardcoded credentials from logs)
LOGIN_RESPONSE=$(curl -v -X POST "$LOGIN_URL" \
  -H "Content-Type: application/json" \
  -c /tmp/ecount_cookies.txt \
  -d '{
    "COMPANY_CODE": "PHOMAS",
    "USER_ID": "PHOMAS",
    "USER_PWD": "Phomas@2025"
  }' 2>&1)

echo "Login Response:"
echo "$LOGIN_RESPONSE"
echo ""

# Extract SESSION_ID from the response
SESSION_ID=$(echo "$LOGIN_RESPONSE" | grep -o '"SESSION_ID":"[^"]*"' | cut -d'"' -f4)

if [ -z "$SESSION_ID" ]; then
  echo "❌ Failed to get SESSION_ID from login response"
  echo "Full login response:"
  echo "$LOGIN_RESPONSE"
  exit 1
fi

echo "✅ SESSION_ID: ${SESSION_ID:0:8}..."
echo ""

# Build the SaveSaleOrder URL
ORDER_URL="https://oapi${ZONE}.ecount.com/OAPI/V2/SaleOrder/SaveSaleOrder?SESSION_ID=${SESSION_ID}"

echo "🚀 Step 3: Submitting Sales Order..."
echo "Order URL: $ORDER_URL"
echo ""

# Prepare the order payload
ORDER_PAYLOAD='{
  "SaleOrderList": [
    {
      "BulkDatas": {
        "IO_DATE": "20251002",
        "UPLOAD_SER_NO": "TEST_CURL_001_20251002",
        "CUST": "10839",
        "CUST_DES": "Online Store Sales",
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
        "PROD_CD": "BMR10",
        "PROD_DES": "10L round sharp container",
        "SIZE_DES": "",
        "UQTY": "",
        "QTY": "1",
        "PRICE": "15000",
        "USER_PRICE_VAT": "",
        "SUPPLY_AMT": "15000",
        "SUPPLY_AMT_F": "",
        "VAT_AMT": "",
        "ITEM_TIME_DATE": "",
        "REMARKS": "Test order from cURL",
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
    }
  ]
}'

# Make the API call with cookies
ORDER_RESPONSE=$(curl -v -X POST "$ORDER_URL" \
  -H "Content-Type: application/json" \
  -b /tmp/ecount_cookies.txt \
  -d "$ORDER_PAYLOAD" 2>&1)

echo "📋 Order Response:"
echo "$ORDER_RESPONSE"
echo ""

# Check if successful
if echo "$ORDER_RESPONSE" | grep -q '"Status":"200"'; then
  echo "✅ SUCCESS! Order submitted successfully"
  
  # Try to extract DOC_NO
  DOC_NO=$(echo "$ORDER_RESPONSE" | grep -o '"SlipNos":\["[^"]*"' | cut -d'"' -f4)
  if [ ! -z "$DOC_NO" ]; then
    echo "📄 Document Number: $DOC_NO"
  fi
elif echo "$ORDER_RESPONSE" | grep -q "not been authenticated"; then
  echo "❌ AUTHENTICATION ERROR: The API has not been authenticated"
  echo ""
  echo "💡 Possible reasons:"
  echo "   1. Web Uploader fields not properly configured (need all 90 fields)"
  echo "   2. API user lacks Sales Order write permissions"
  echo "   3. SaveSaleOrder endpoint requires different authentication"
else
  echo "❌ Order submission failed"
  echo "Check the response above for error details"
fi

# Cleanup
rm -f /tmp/ecount_cookies.txt

echo ""
echo "✅ Test complete!"
