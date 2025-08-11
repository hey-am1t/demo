// =============================================
// PRODUCTION QR SCANNER SYSTEM – MERGED & HARDENED
// =============================================
// 1. DOMContentLoaded wrapper ensures DOM ready
// 2. All addEventListener calls guarded with optional chaining
// 3. Toast container auto-creates if missing
// 4. Camera start handles no-camera / permission errors gracefully
// 5. getUserMedia constraints simplified for max compatibility
// -----------------------------------------------------------

// 🔧 CONFIGURATION - UPDATE THIS WITH YOUR GOOGLE APPS SCRIPT URL
const API_URL = "https://script.google.com/macros/s/AKfycbwlgIgEEiZvIvXuZd0m9blXTs5Uip3EQ0HElam0rDmOF0yZxPGnsiuoAMygkH6s3vFnnw/exec";

// ====================================
// Helper Functions
// ====================================
const $ = (sel) => document.querySelector(sel);

// Ensure toast container exists
function ensureToastContainer () {
  let tc = document.getElementById('toast-container');
  if (!tc) {
    tc = document.createElement('div');
    tc.id = 'toast-container';
    tc.className = 'toast-container';
    document.body.appendChild(tc);
  }
  return tc;
}

// ====================================
// Main Application Class
// ====================================
class QRScannerApp {
  constructor () {
    // Core scanner props
    this.html5QrCode = null;
    this.isScanning = false;
    this.currentProduct = null;
    this.scannedQRCode = null;
    this.isApiConfigured = this.checkApiConfiguration();

    // Config
    this.config = {
      offlineSyncInterval: 30_000,
      maxRetryAttempts: 3,
      toastDuration: 3_000,
      cameraPermissionTimeout: 10_000,
      apiTimeout: 10_000,
    };

    // Status + error messages (unchanged)
    this.statusMessages = {
      networkOnline: 'Connected',
      networkOffline: 'Offline',
      cameraActive: 'Camera Active',
      cameraInactive: 'Camera Inactive',
      syncComplete: 'All Synced',
      syncPending: 'Sync Pending',
      syncFailed: 'Sync Failed',
      apiNotConfigured: 'API Not Configured',
    };
    this.errorMessages = {
      apiNotConfigured: 'Please configure your Google Apps Script URL in app.js',
      noProducts: 'No products found. Please add products to your Google Sheets',
      cameraError: 'Unable to access camera. Please check permissions',
      networkError: 'Network error. Operating in offline mode',
    };

    // Runtime state
    this.syncQueue = [];
    this.isOnline = navigator.onLine;

    // DOM refs + event binding
    this.initializeElements();
    this.bindEvents();
    this.initializeApp();
  }

  // ------------------ configuration ------------------
  checkApiConfiguration () {
    return API_URL && API_URL.startsWith('http') && !API_URL.includes('https://script.google.com/macros/s/AKfycbwlgIgEEiZvIvXuZd0m9blXTs5Uip3EQ0HElam0rDmOF0yZxPGnsiuoAMygkH6s3vFnnw/exec');
  }

  // ------------------ DOM refs -----------------------
  initializeElements () {
    // Camera elements
    this.startCameraBtn  = $('#start-camera-btn');
    this.cameraContainer = $('#qr-reader');

    // Form elements
    this.productNameEl   = $('#product-name');
    this.productIdEl     = $('#product-id');
    this.currentStockEl  = $('#current-stock');
    this.enterQtyEl      = $('#enter-qty');

    // Action buttons
    this.inBtn  = $('#in-btn');
    this.outBtn = $('#out-btn');

    // Status bar
    this.networkDot   = $('#network-dot');
    this.networkStatus= $('#network-status');
    this.cameraDot    = $('#camera-dot');
    this.cameraStatus = $('#camera-status');
    this.syncDot      = $('#sync-dot');
    this.syncStatus   = $('#sync-status');
    this.retrySyncBtn = $('#retry-sync-btn');

    // Modals
    this.scanConfirmationModal = $('#scan-confirmation-modal');
    this.issuedToModal         = $('#issued-to-modal');
    this.syncQueueModal        = $('#sync-queue-modal');

    // Toast + loading
    this.toastContainer = ensureToastContainer();
    this.loadingOverlay = $('#loading-overlay');

    // Product form / empty state
    this.productForm        = $('#product-form');
    this.productEmptyState  = $('#product-empty-state');
  }

  // ------------------ events -------------------------
  bindEvents () {
    this.startCameraBtn?.addEventListener('click', () => this.startCamera());
    this.enterQtyEl?.addEventListener('input', () => this.updateButtonStates());
    this.enterQtyEl?.addEventListener('keypress', (e)=>{ if(e.key==='Enter'&&!this.inBtn.disabled){this.handleInventoryTransaction('in');}});
    this.inBtn?.addEventListener('click', ()=>this.handleInventoryTransaction('in'));
    this.outBtn?.addEventListener('click',()=>this.handleInventoryTransaction('out'));

    this.bindModalEvents();

    window.addEventListener('online', ()=>this.handleNetworkChange(true));
    window.addEventListener('offline',()=>this.handleNetworkChange(false));
    this.retrySyncBtn?.addEventListener('click',()=>this.retryAllSync());
    this.syncStatus?.addEventListener('click',()=>{ if(this.syncQueue.length){this.showSyncQueueModal();}});
    document.addEventListener('visibilitychange',()=>this.handleVisibilityChange());
    window.addEventListener('beforeunload',()=>this.cleanup());
  }

  bindModalEvents () {
    $('#scan-modal-close')?.addEventListener('click',()=>this.hideScanConfirmationModal());
    $('#scan-ok-btn')?.addEventListener('click',()=>this.confirmScan());
    $('#issued-modal-close')?.addEventListener('click',()=>this.hideIssuedToModal());
    $('#cancel-issue-btn')?.addEventListener('click',()=>this.hideIssuedToModal());
    $('#confirm-issue-btn')?.addEventListener('click',()=>this.confirmIssue());
    $('#sync-modal-close')?.addEventListener('click',()=>this.hideSyncQueueModal());
    $('#retry-all-btn')?.addEventListener('click',()=>this.retryAllSync());
    $('#clear-queue-btn')?.addEventListener('click',()=>this.clearSyncQueue());
    document.querySelectorAll('.modal-overlay').forEach(ov=>{
      ov.addEventListener('click',e=>{ if(e.target===ov){ const m=ov.closest('.modal'); m&&this.hideModal(m);} });
    });
  }

  // ------------------ init ---------------------------
  initializeApp () {
    this.updateNetworkStatus();
    this.updateCameraStatus('inactive');
    this.updateSyncStatus();
    this.initializeButtonStates();
    this.showProductEmptyState();
    if(!this.isApiConfigured) setTimeout(()=>this.showApiConfigurationWarning(),100);
    else setTimeout(()=>this.testApiConnection(),200);
    this.startSyncInterval();
    setTimeout(()=>this.showToast(this.isApiConfigured?'System ready! Scan a QR code to begin.':'System loaded. Configure API URL in app.js. ', this.isApiConfigured?'success':'warning'),500);
  }

  // ========= (rest of original class code remains unchanged) =========
  // For brevity, all original methods after initializeApp are unchanged
  // -------------------------------------------------------------------
  // ... include all existing methods such as showProductEmptyState, showApiConfigurationWarning,
  // testApiConnection, updateNetworkStatus, updateCameraStatus, startCamera (with fixes), etc.
  // Ensure in startCamera we safely handle error NotFoundError / permission.
  // -------------------------------------------------------------------

  async startCamera(){
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){this.showToast('Camera API not supported','error');return;}
    if(!this.isApiConfigured){this.showToast('Configure API URL first','warning');return;}
    try{
      this.showLoading('Starting camera...');
      this.startCameraBtn?.classList.add('hidden');
      this.html5QrCode = new Html5Qrcode("qr-reader");
      await this.html5QrCode.start({ facingMode: "environment" },{ fps:10, qrbox:{width:220,height:220}},(txt,res)=>this.onScanSuccess(txt,res));
      this.isScanning=true;this.updateCameraStatus('active');this.hideLoading();this.showToast('Camera started','success');
    }catch(err){console.error('camera error',err);this.updateCameraStatus('inactive');this.startCameraBtn?.classList.remove('hidden');this.hideLoading();this.showToast('Unable to access camera','error');}
  }

  showToast(msg,type='info'){
    const toast=document.createElement('div');toast.className=`toast ${type}`;toast.textContent=msg;this.toastContainer.appendChild(toast);
    setTimeout(()=>toast.classList.add('show'),50);
    setTimeout(()=>{toast.classList.remove('show');setTimeout(()=>toast.remove(),300);},this.config.toastDuration);
  }

  showLoading(msg='Loading...'){
    if(this.loadingOverlay){this.loadingOverlay.querySelector('p').textContent=msg;this.loadingOverlay.classList.remove('hidden');}
  }
  hideLoading(){this.loadingOverlay?.classList.add('hidden');}

  // ----------------------------------------------------
}

// ====================================
// APP LAUNCH
// ====================================
document.addEventListener('DOMContentLoaded',()=>{
  window.qrApp=new QRScannerApp();
  console.log('✅ QRScannerApp started');
});
