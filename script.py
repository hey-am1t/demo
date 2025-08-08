# Create Google Apps Script backend code for the QR Scanner System
# This will handle the Google Sheets integration

google_apps_script_code = """
// Google Apps Script Backend for QR Scanner System
// This script handles data operations with Google Sheets

// Configuration
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // Replace with actual spreadsheet ID
const SHEET_NAMES = {
  PRODUCTS: 'Products',
  TRANSACTIONS: 'Transactions', 
  LOGS: 'Logs'
};

/**
 * Main function to handle all HTTP requests
 */
function doPost(e) {
  try {
    const requestData = JSON.parse(e.postData.contents);
    const action = requestData.action;
    
    switch(action) {
      case 'getProduct':
        return handleGetProduct(requestData);
      case 'addTransaction':
        return handleAddTransaction(requestData);
      case 'updateStock':
        return handleUpdateStock(requestData);
      case 'logError':
        return handleLogError(requestData);
      case 'syncBatch':
        return handleSyncBatch(requestData);
      default:
        return createErrorResponse('Invalid action');
    }
  } catch (error) {
    logError({
      action: 'doPost',
      error: error.toString(),
      timestamp: new Date().toISOString(),
      userAgent: e.headers['User-Agent']
    });
    return createErrorResponse('Server error: ' + error.toString());
  }
}

/**
 * Handle GET requests (mainly for CORS preflight)
 */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({status: 'API is running'}))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
}

/**
 * Get product information by ID
 */
function handleGetProduct(data) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAMES.PRODUCTS);
    const rows = sheet.getDataRange().getValues();
    
    // Skip header row
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[0] === data.productId) { // Assuming ID is in column A
        const product = {
          id: row[0],
          name: row[1],
          currentStock: row[2],
          category: row[3] || '',
          location: row[4] || '',
          lastUpdated: new Date().toISOString()
        };
        return createSuccessResponse(product);
      }
    }
    
    return createErrorResponse('Product not found');
  } catch (error) {
    logError({
      action: 'getProduct',
      productId: data.productId,
      error: error.toString(),
      timestamp: new Date().toISOString()
    });
    return createErrorResponse('Error fetching product: ' + error.toString());
  }
}

/**
 * Add new transaction record
 */
function handleAddTransaction(data) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAMES.TRANSACTIONS);
    const timestamp = new Date().toISOString();
    
    const newRow = [
      timestamp,
      data.productId,
      data.productName,
      data.type, // 'IN' or 'OUT'
      data.quantity,
      data.user || 'System',
      data.issuedTo || '', // Only for OUT transactions
      data.notes || '',
      data.location || ''
    ];
    
    sheet.appendRow(newRow);
    
    // Update product stock
    updateProductStock(data.productId, data.type, data.quantity);
    
    return createSuccessResponse({
      transactionId: generateTransactionId(),
      timestamp: timestamp,
      status: 'recorded'
    });
  } catch (error) {
    logError({
      action: 'addTransaction',
      data: JSON.stringify(data),
      error: error.toString(),
      timestamp: new Date().toISOString()
    });
    return createErrorResponse('Error adding transaction: ' + error.toString());
  }
}

/**
 * Update product stock levels
 */
function updateProductStock(productId, type, quantity) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAMES.PRODUCTS);
    const rows = sheet.getDataRange().getValues();
    
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === productId) {
        const currentStock = parseInt(rows[i][2]) || 0;
        let newStock;
        
        if (type === 'IN') {
          newStock = currentStock + parseInt(quantity);
        } else if (type === 'OUT') {
          newStock = currentStock - parseInt(quantity);
        }
        
        // Update the stock in the sheet
        sheet.getRange(i + 1, 3).setValue(newStock); // Column C for stock
        sheet.getRange(i + 1, 6).setValue(new Date().toISOString()); // Column F for last updated
        
        break;
      }
    }
  } catch (error) {
    logError({
      action: 'updateProductStock',
      productId: productId,
      type: type,
      quantity: quantity,
      error: error.toString(),
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Handle batch sync operations for offline sync
 */
function handleSyncBatch(data) {
  try {
    const results = [];
    const transactions = data.transactions || [];
    
    for (const transaction of transactions) {
      try {
        const result = handleAddTransaction(transaction);
        results.push({
          localId: transaction.localId,
          success: result.success,
          data: result.data,
          error: result.error
        });
      } catch (error) {
        results.push({
          localId: transaction.localId,
          success: false,
          error: error.toString()
        });
      }
    }
    
    return createSuccessResponse({
      processed: results.length,
      results: results
    });
  } catch (error) {
    return createErrorResponse('Batch sync error: ' + error.toString());
  }
}

/**
 * Log errors to the Logs sheet
 */
function handleLogError(data) {
  return logError(data);
}

function logError(errorData) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAMES.LOGS);
    const timestamp = new Date().toISOString();
    
    const newRow = [
      timestamp,
      errorData.action || 'unknown',
      errorData.error || 'No error message',
      errorData.data || '',
      errorData.userAgent || '',
      errorData.userId || 'anonymous'
    ];
    
    sheet.appendRow(newRow);
    
    return createSuccessResponse({logged: true, timestamp: timestamp});
  } catch (error) {
    console.error('Failed to log error:', error);
    return createErrorResponse('Failed to log error');
  }
}

/**
 * Utility functions
 */
function createSuccessResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      data: data,
      timestamp: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
}

function createErrorResponse(message) {
  return ContentService
    .createTextOutput(JSON.stringify({
      success: false,
      error: message,
      timestamp: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
}

function generateTransactionId() {
  return 'TXN-' + new Date().getTime() + '-' + Math.random().toString(36).substr(2, 5);
}

/**
 * Initialize Google Sheets structure (run once to setup)
 */
function setupGoogleSheets() {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    // Setup Products sheet
    let productsSheet = spreadsheet.getSheetByName(SHEET_NAMES.PRODUCTS);
    if (!productsSheet) {
      productsSheet = spreadsheet.insertSheet(SHEET_NAMES.PRODUCTS);
      productsSheet.getRange(1, 1, 1, 6).setValues([
        ['Product_ID', 'Product_Name', 'Current_Stock', 'Category', 'Location', 'Last_Updated']
      ]);
      
      // Add sample products
      const sampleData = [
        ['WH-001', 'Wireless Headphones', 25, 'Electronics', 'A1-B2', new Date().toISOString()],
        ['USB-002', 'USB Cable', 150, 'Accessories', 'A2-B1', new Date().toISOString()],
        ['PC-003', 'Phone Case', 75, 'Accessories', 'A1-C3', new Date().toISOString()]
      ];
      productsSheet.getRange(2, 1, sampleData.length, 6).setValues(sampleData);
    }
    
    // Setup Transactions sheet
    let transactionsSheet = spreadsheet.getSheetByName(SHEET_NAMES.TRANSACTIONS);
    if (!transactionsSheet) {
      transactionsSheet = spreadsheet.insertSheet(SHEET_NAMES.TRANSACTIONS);
      transactionsSheet.getRange(1, 1, 1, 9).setValues([
        ['Timestamp', 'Product_ID', 'Product_Name', 'Type', 'Quantity', 'User', 'Issued_To', 'Notes', 'Location']
      ]);
    }
    
    // Setup Logs sheet
    let logsSheet = spreadsheet.getSheetByName(SHEET_NAMES.LOGS);
    if (!logsSheet) {
      logsSheet = spreadsheet.insertSheet(SHEET_NAMES.LOGS);
      logsSheet.getRange(1, 1, 1, 6).setValues([
        ['Timestamp', 'Action', 'Error_Message', 'Data', 'User_Agent', 'User_ID']
      ]);
    }
    
    console.log('Google Sheets setup completed successfully');
  } catch (error) {
    console.error('Error setting up Google Sheets:', error);
  }
}
"""

# Save the Google Apps Script code to a file
with open('google_apps_script_backend.js', 'w', encoding='utf-8') as f:
    f.write(google_apps_script_code)

print("✅ Google Apps Script backend code created successfully!")
print("📁 File saved as: google_apps_script_backend.js")
print("\n📋 Setup Instructions:")
print("1. Go to https://script.google.com")
print("2. Create a new project")
print("3. Copy and paste the generated code")
print("4. Replace 'YOUR_SPREADSHEET_ID_HERE' with your actual Google Sheets ID")
print("5. Run the setupGoogleSheets() function once to initialize the sheets")
print("6. Deploy as web app with execute permissions for 'Anyone'")
print("7. Copy the web app URL to use as API endpoint in the frontend")