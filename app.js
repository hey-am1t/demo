// =============================================
// QR SCANNER - FULL FIXED (FEATURE-PRESERVING)
// =============================================

// --- CONFIG: Replace with your deployed Google Apps Script Web App URL ---
const API_URL = "https://script.google.com/macros/s/AKfycby4KuculymxfbaLSmn04Em-ANo12HCHYJHlA0GllaVDCK3wxblBe3wePo_cdXU8p4h3/exec";

// small helpers
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const safeParseJSON = (txt, fallback = {}) => {
  try { return JSON.parse(txt); } catch(e) { return fallback; }
};

class QRScannerApp {
  constructor() {
    // core
    this.html5QrCode = null;
    this.isScanning = false;
    this.currentProduct = null;
    this.scannedQRCode = null;
    this.syncQueue = [];
    this.isOnline = navigator.onLine;
    this.retryLimit = 3;

    // config
    this.config = {
      offlineSyncInterval: 25000,
      apiTimeout: 12000,
      toastDuration: 3500,
      cameraConfig: { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 }
    };

    // UI elements
    this.initElements();

    // restore queue
    this.loadQueueFromStorage();

    // bind events
    this.bindEvents();

    // initialize UI & status
    this.initializeApp();
  }

  // -----------------------
  // init DOM refs
  // -----------------------
  initElements() {
    // camera
    this.startCameraBtn = $('#start-camera-btn');
    this.cameraContainer = $('#qr-reader');

    // product form elements
    this.productNameEl = $('#product-name');
    this.productIdEl = $('#product-id');
    this.currentStockEl = $('#current-stock');
    this.enterQtyEl = $('#enter-qty');

    // actions
    this.inBtn = $('#in-btn');
    this.outBtn = $('#out-btn');

    // status
    this.networkDot = $('#network-dot');
    this.networkStatus = $('#network-status');
    this.cameraDot = $('#camera-dot');
    this.cameraStatus = $('#camera-status');
    this.syncDot = $('#sync-dot');
    this.syncStatus = $('#sync-status');
    this.retrySyncBtn = $('#retry-sync-btn');

    // modals
    this.scanModal = $('#scan-confirmation-modal');
    this.scanModalClose = $('#scan-modal-close');
    this.scanOkBtn = $('#scan-ok-btn');

    this.issuedModal = $('#issued-to-modal');
    this.issuedModalClose = $('#issued-modal-close');
    this.cancelIssueBtn = $('#cancel-issue-btn');
    this.confirmIssueBtn = $('#confirm-issue-btn');
    this.issuedToInput = $('#issued-to-name');
    this.issueProductName = $('#issue-product-name');
    this.issueQuantityEl = $('#issue-quantity');

    this.syncQueueModal = $('#sync-queue-modal');
    this.syncModalClose = $('#sync-modal-close');
    this.syncQueueList = $('#sync-queue-list');
    this.retryAllBtn = $('#retry-all-btn');
    this.clearQueueBtn = $('#clear-queue-btn');

    // other UI
    this.toastContainer = $('#toast-container') || this.createToastContainer();
    this.loadingOverlay = $('#loading-overlay');
    this.productForm = $('#product-form');
    this.productEmptyState = $('#product-empty-state');
  }

  // -----------------------
  // EVENTS
  // -----------------------
  bindEvents() {
    // camera
    this.startCameraBtn?.addEventListener('click', () => this.startCamera());

    // quantity input
    this.enterQtyEl?.addEventListener('input', () => this.updateButtonStates());
    this.enterQtyEl?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !this.inBtn.disabled) this.handleInventoryTransaction('IN');
    });

    // in/out
    this.inBtn?.addEventListener('click', () => this.handleInventoryTransaction('IN'));
    this.outBtn?.addEventListener('click', () => this.handleInventoryTransaction('OUT'));

    // modal controls
    this.scanModalClose?.addEventListener('click', () => this.hideScanConfirmationModal());
    this.scanOkBtn?.addEventListener('click', () => this.confirmScan());

    this.issuedModalClose?.addEventListener('click', () => this.hideIssuedToModal());
    this.cancelIssueBtn?.addEventListener('click', () => this.hideIssuedToModal());
    this.confirmIssueBtn?.addEventListener('click', () => this.confirmIssue());

    this.syncModalClose?.addEventListener('click', () => this.hideSyncQueueModal());
    this.retryAllBtn?.addEventListener('click', () => this.retryAllSync());
    this.clearQueueBtn?.addEventListener('click', () => this.clearSyncQueue());

    // clicking sync status opens queue modal
    this.syncStatus?.addEventListener('click', () => {
      if (this.syncQueue.length > 0) this.showSyncQueueModal();
    });

    // network
    window.addEventListener('online', () => this.handleNetworkChange(true));
    window.addEventListener('offline', () => this.handleNetworkChange(false));

    // visibility - pause camera when tab hidden
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pauseCamera();
      } else {
        this.resumeCamera();
      }
    });

    // global click for modal overlay closing (already in HTML - ensure behavior)
    $$('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          const modal = overlay.closest('.modal');
          if (modal) modal.classList.add('hidden');
          document.body.style.overflow = '';
        }
      });
    });

    // expose functions for inline onclick from rendered HTML (queue items)
    window.qrApp = this;
  }

  initializeApp() {
    this.updateNetworkStatus();
    this.updateCameraStatus('inactive');
    this.updateSyncStatus();
    this.initializeButtonStates();
    this.showProductEmptyState();
    this.startSyncInterval();

    // quick API test if configured
    if (this.isApiConfigured()) {
      this.testApiConnection();
    } else {
      this.showToast('API not configured. Set API_URL in app.js', 'warning');
    }
  }

  // -----------------------
  // API CONFIG CHECK
  // -----------------------
  isApiConfigured() {
    return typeof API_URL === 'string' && API_URL.startsWith('http') && !API_URL.includes('YOUR_SCRIPT_ID');
  }

  // -----------------------
  // CAMERA: start -> scan -> pause/resume/stop
  // -----------------------
  async startCamera() {
    if (!this.isApiConfigured()) {
      this.showToast('Please configure API_URL in app.js first', 'warning');
      return;
    }

    try {
      this.showLoading('Starting camera...');
      if (this.startCameraBtn) this.startCameraBtn.style.display = 'none';

      // instantiate Html5Qrcode
      if (!this.html5QrCode) this.html5QrCode = new Html5Qrcode("qr-reader");

      // Try environment (back) first, then user (front)
      const tryStart = async (constraints) => {
        return this.html5QrCode.start(
          constraints,
          this.config.cameraConfig,
          (decodedText, decodedResult) => this.onScanSuccess(decodedText, decodedResult),
          (error) => { /* ignore frequent scan errors */ }
        );
      };

      try {
        await tryStart({ facingMode: { exact: "environment" } });
      } catch (err) {
        // fallback - try generic environment, then user
        try {
          await tryStart({ facingMode: "environment" });
        } catch (err2) {
          await tryStart({ facingMode: "user" });
        }
      }

      this.isScanning = true;
      this.updateCameraStatus('active');
      this.hideLoading();
      this.showToast('Camera started', 'success');

    } catch (err) {
      console.error('startCamera error', err);
      this.updateCameraStatus('inactive');
      if (this.startCameraBtn) this.startCameraBtn.style.display = 'block';
      this.hideLoading();
      this.showToast('Unable to start camera — check permissions', 'error');
    }
  }

  async onScanSuccess(decodedText /*, decodedResult*/) {
    console.log('QR scanned:', decodedText);
    this.scannedQRCode = decodedText;

    // pause scanning while processing
    if (this.html5QrCode && this.isScanning) {
      try { await this.html5QrCode.pause(true); } catch (e) { /* ignore */ }
    }

    this.showLoading('Fetching product...');

    try {
      const product = await this.fetchProductFromGoogleSheets(decodedText);
      this.hideLoading();

      if (product) {
        // show confirmation modal
        this.showScanConfirmationModal(product);
        // flash UI
        this.cameraContainer?.classList?.add('scan-success');
        setTimeout(() => this.cameraContainer?.classList?.remove('scan-success'), 650);
      } else {
        this.showToast('Product not found in inventory', 'warning');
        await this.resumeCamera();
      }
    } catch (err) {
      console.error('fetch product failed', err);
      this.hideLoading();
      this.showToast('Error fetching product. Check API or network.', 'error');
      await this.resumeCamera();
    }
  }

  async resumeCamera() {
    if (this.html5QrCode && this.isScanning) {
      try { await this.html5QrCode.resume(); } catch(e) { /* ignore */ }
    }
  }

  async pauseCamera() {
    if (this.html5QrCode && this.isScanning) {
      try { await this.html5QrCode.pause(true); } catch(e) { /* ignore */ }
    }
  }

  async stopCamera() {
    if (this.html5QrCode) {
      try {
        await this.html5QrCode.stop();
        this.html5QrCode.clear();
      } catch (e) { /* ignore */ }
    }
    this.isScanning = false;
    this.updateCameraStatus('inactive');
    if (this.startCameraBtn) this.startCameraBtn.style.display = 'block';
  }

  // -----------------------
  // MODAL UI helpers
  // -----------------------
  showModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  hideModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.add('hidden');
    document.body.style.overflow = '';
  }

  showScanConfirmationModal(product) {
    // fill elements
    $('#scan-product-name').textContent = product.Product_Name || product.name || 'Unknown';
    $('#scan-product-id').textContent = product.Product_ID || product.id || '';
    $('#scan-current-stock').textContent = (product.Current_Stock != null) ? product.Current_Stock : 0;
    this.currentProduct = product;
    this.showModal(this.scanModal);
  }
  hideScanConfirmationModal() {
    this.hideModal(this.scanModal);
    // resume scanning after close
    this.resumeCamera();
  }
  confirmScan() {
    // user clicked OK -> populate form and close modal
    this.hideModal(this.scanModal);
    this.populateProductInfo(this.currentProduct);
    this.showToast(`Product loaded: ${this.currentProduct.Product_Name || this.currentProduct.name}`, 'success');
    // no immediate resume — user chooses camera use
  }

  showIssuedToModal(product, quantity) {
    if (!product) return;
    this.issueProductName.textContent = product.Product_Name || product.name || '';
    this.issueQuantityEl.textContent = quantity;
    this.issuedToInput.value = '';
    this.showModal(this.issuedModal);
    setTimeout(() => this.issuedToInput?.focus(), 200);
  }
  hideIssuedToModal() {
    this.hideModal(this.issuedModal);
    // keep scanning paused until user confirms/cancels
  }
  confirmIssue() {
    const person = (this.issuedToInput?.value || '').trim();
    if (!person) {
      this.showToast('Please enter recipient name', 'warning');
      return;
    }
    this.hideIssuedToModal();
    this.processStockOut(person);
  }

  showSyncQueueModal() {
    this.renderSyncQueueList();
    this.showModal(this.syncQueueModal);
  }
  hideSyncQueueModal() {
    this.hideModal(this.syncQueueModal);
  }

  // -----------------------
  // API CALLS (GET/POST)
  // - tolerant for both application/json and text/plain
  // -----------------------
  async testApiConnection() {
    if (!this.isApiConfigured()) return;
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), this.config.apiTimeout);
      const res = await fetch(`${API_URL}?action=test`, { method: 'GET', signal: controller.signal });
      clearTimeout(id);
      if (res.ok) {
        const j = await res.json();
        if (j && j.success) this.showToast('Connected to API', 'success');
        else this.showToast('API responded, but unexpected payload', 'warning');
      } else {
        this.showToast('API responded with error', 'warning');
      }
    } catch (err) {
      console.warn('API test failed', err);
      this.showToast('Cannot reach API — working offline', 'warning');
    }
  }

  async fetchProductFromGoogleSheets(productId) {
    if (!this.isApiConfigured()) throw new Error('API not configured');
    const url = `${API_URL}?action=getProduct&productId=${encodeURIComponent(productId)}`;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.config.apiTimeout);
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    if (!payload.success) return null;
    // flexible mapping: ensure both uppercase and lowercase expected fields
    const d = payload.data || {};
    return {
      Product_ID: d.Product_ID || d.productId || d.id || d.ProductId || '',
      Product_Name: d.Product_Name || d.productName || d.name || '',
      Current_Stock: typeof d.Current_Stock !== 'undefined' ? Number(d.Current_Stock) :
                     typeof d.currentStock !== 'undefined' ? Number(d.currentStock) :
                     (Number(d.stock) || 0),
      // keep fallbacks for original code that may read lowercase props
      id: d.id || d.productId || d.Product_ID || '',
      name: d.name || d.productName || d.Product_Name || '',
      currentStock: typeof d.currentStock !== 'undefined' ? Number(d.currentStock) : (Number(d.Current_Stock) || 0)
    };
  }

  // Send transaction to server. Use 'text/plain' content-type to avoid preflight (Apps Script friendly),
  // but also accept application/json. If you prefer strict JSON and have CORS configured, you can change.
  async syncToGoogleSheets(transactionData) {
    if (!this.isApiConfigured()) throw new Error('API not configured');
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.config.apiTimeout);

    // We'll send as text/plain to avoid CORS preflight on Apps Script deployments.
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'addTransaction', payload: transactionData }),
      signal: controller.signal
    });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message || 'Sync failed');
    return json;
  }

  // -----------------------
  // INVENTORY TRANSACTION FLOW
  // -----------------------
  handleInventoryTransaction(type) {
    const rawQty = (this.enterQtyEl?.value || '').toString().trim();
    const qty = parseInt(rawQty, 10);
    if (isNaN(qty) || qty <= 0) {
      this.showToast('Please enter a valid quantity', 'warning');
      return;
    }
    if (!this.currentProduct) {
      this.showToast('Scan a product first', 'warning');
      return;
    }
    const currentStock = Number(this.currentProduct.Current_Stock || this.currentProduct.currentStock || 0);
    if (type === 'OUT' && qty > currentStock) {
      this.showToast('Insufficient stock', 'error');
      return;
    }

    if (type === 'OUT') {
      // ask for issued-to
      this.showIssuedToModal(this.currentProduct, qty);
      return;
    }

    // IN flow
    const tx = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      productId: this.currentProduct.Product_ID || this.currentProduct.id,
      productName: this.currentProduct.Product_Name || this.currentProduct.name,
      type,
      quantity: qty,
      oldStock: currentStock,
      newStock: currentStock + qty,
      user: 'QR Scanner User'
    };
    this.processStockIn(tx);
  }

  async processStockIn(transactionData) {
    this.showLoading('Processing stock IN...');
    try {
      if (this.isOnline) {
        await this.syncToGoogleSheets(transactionData);
        this.updateProductStock(transactionData);
        this.showToast(`Added ${transactionData.quantity} to inventory`, 'success');
      } else {
        this.addToSyncQueue(transactionData);
        this.updateProductStock(transactionData);
        this.showToast(`Added ${transactionData.quantity} (queued for sync)`, 'warning');
      }
    } catch (err) {
      console.error('processStockIn error', err);
      this.addToSyncQueue(transactionData);
      this.updateProductStock(transactionData);
      this.showToast('Sync failed, item queued', 'warning');
    } finally {
      this.hideLoading();
      this.clearForm();
    }
  }

  async processStockOut(issuedTo) {
    const qty = parseInt(this.enterQtyEl?.value || 0, 10);
    const currentStock = Number(this.currentProduct.Current_Stock || this.currentProduct.currentStock || 0);

    const tx = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      productId: this.currentProduct.Product_ID || this.currentProduct.id,
      productName: this.currentProduct.Product_Name || this.currentProduct.name,
      type: 'OUT',
      quantity: qty,
      oldStock: currentStock,
      newStock: currentStock - qty,
      issuedTo,
      user: 'QR Scanner User'
    };

    this.showLoading('Processing stock OUT...');
    try {
      if (this.isOnline) {
        await this.syncToGoogleSheets(tx);
        this.updateProductStock(tx);
        this.showToast(`Issued ${qty} to ${issuedTo}`, 'success');
      } else {
        this.addToSyncQueue(tx);
        this.updateProductStock(tx);
        this.showToast(`Issued ${qty} (queued for sync)`, 'warning');
      }
    } catch (err) {
      console.error('processStockOut error', err);
      this.addToSyncQueue(tx);
      this.updateProductStock(tx);
      this.showToast('Sync failed, item queued', 'warning');
    } finally {
      this.hideLoading();
      this.clearForm();
    }
  }

  // -----------------------
  // PRODUCT FORM UI helpers
  // -----------------------
  populateProductInfo(product) {
    this.currentProduct = product;
    if (this.productNameEl) this.productNameEl.value = product.Product_Name || product.name || '';
    if (this.productIdEl) this.productIdEl.value = product.Product_ID || product.id || '';
    if (this.currentStockEl) this.currentStockEl.value = product.Current_Stock != null ? product.Current_Stock : (product.currentStock || 0);
    if (this.enterQtyEl) this.enterQtyEl.value = '';
    this.updateButtonStates();
    this.showProductForm();
    setTimeout(() => this.enterQtyEl?.focus(), 120);
  }

  updateProductStock(transaction) {
    if (!this.currentProduct) return;
    this.currentProduct.Current_Stock = transaction.newStock;
    this.currentProduct.currentStock = transaction.newStock;
    if (this.currentStockEl) this.currentStockEl.value = transaction.newStock;
    this.updateSyncStatus(); // maybe reflect pending
  }

  clearForm() {
    if (this.enterQtyEl) this.enterQtyEl.value = '';
    this.updateButtonStates();
    this.enterQtyEl?.focus();
  }

  updateButtonStates() {
    const qty = parseInt(this.enterQtyEl?.value || 0, 10);
    const ok = !isNaN(qty) && qty > 0;
    if (this.inBtn) this.inBtn.disabled = !ok;
    if (this.outBtn) this.outBtn.disabled = !ok;
  }

  initializeButtonStates() {
    if (this.inBtn) this.inBtn.disabled = true;
    if (this.outBtn) this.outBtn.disabled = true;
  }

  showProductForm() {
    if (this.productEmptyState) this.productEmptyState.style.display = 'none';
    if (this.productForm) this.productForm.style.display = 'flex';
  }
  showProductEmptyState() {
    if (this.productForm) this.productForm.style.display = 'none';
    if (this.productEmptyState) this.productEmptyState.style.display = 'flex';
  }

  // -----------------------
  // SYNC QUEUE (localStorage persistence)
  // -----------------------
  saveQueueToStorage() {
    try {
      localStorage.setItem('qr_sync_queue_v1', JSON.stringify(this.syncQueue));
    } catch (e) {
      console.warn('Failed to save queue', e);
    }
  }

  loadQueueFromStorage() {
    try {
      const raw = localStorage.getItem('qr_sync_queue_v1');
      this.syncQueue = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(this.syncQueue)) this.syncQueue = [];
    } catch (e) {
      this.syncQueue = [];
    }
  }

  addToSyncQueue(item) {
    item.status = item.status || 'pending';
    item.retryCount = item.retryCount || 0;
    this.syncQueue.push(item);
    this.saveQueueToStorage();
    this.updateSyncStatus();
  }

  removeSyncItem(index) {
    if (index >= 0 && index < this.syncQueue.length) {
      this.syncQueue.splice(index, 1);
      this.saveQueueToStorage();
      this.updateSyncStatus();
      this.renderSyncQueueList();
    }
  }

  retrySyncItem(index) {
    const item = this.syncQueue[index];
    if (!item) return;
    // attempt immediate sync for this item
    item.retryCount = (item.retryCount || 0) + 1;
    this.saveQueueToStorage();
    this.processSingleQueueItem(item, index);
  }

  clearSyncQueue() {
    this.syncQueue = [];
    this.saveQueueToStorage();
    this.updateSyncStatus();
    this.renderSyncQueueList();
    this.showToast('Sync queue cleared', 'info');
  }

  renderSyncQueueList() {
    if (!this.syncQueueList) return;
    if (this.syncQueue.length === 0) {
      this.syncQueueList.innerHTML = '<p style="text-align:center;color:#666;padding:18px">No pending items</p>';
      return;
    }

    this.syncQueueList.innerHTML = this.syncQueue.map((item, i) => {
      const issuedToHtml = item.issuedTo ? `<p>Issued to: ${this.escapeHtml(item.issuedTo)}</p>` : '';
      const status = item.status || 'pending';
      const time = item.timestamp ? new Date(item.timestamp).toLocaleString() : new Date(item.id ? Number(item.id) : Date.now()).toLocaleString();
      return `
        <div class="sync-queue-item" style="border-bottom:1px solid #eee;padding:12px 8px;display:flex;justify-content:space-between;gap:12px">
          <div style="flex:1">
            <h5 style="margin:0 0 6px 0">${this.escapeHtml((item.type||'').toUpperCase())}: ${this.escapeHtml(item.productName || item.product || '')}</h5>
            <p style="margin:0 0 4px 0">Qty: ${this.escapeHtml(String(item.quantity || '0'))} | ${this.escapeHtml(time)}</p>
            ${issuedToHtml}
            <p style="margin:6px 0 0 0;color:#666">Status: ${this.escapeHtml(status)} (${item.retryCount || 0} retries)</p>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
            <button class="btn btn--sm btn--outline" onclick="qrApp.retrySyncItem(${i})">Retry</button>
            <button class="btn btn--sm btn--secondary" onclick="qrApp.removeSyncItem(${i})">Delete</button>
          </div>
        </div>
      `;
    }).join('');
  }

  escapeHtml(str) {
    if (!str) return '';
    return (''+str).replace(/[&<>"']/g, function(m){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]; });
  }

  // process single queued item (used by retry)
  async processSingleQueueItem(item, index) {
    try {
      await this.syncToGoogleSheets(item);
      // remove the item at index (if it still exists)
      const idx = this.syncQueue.indexOf(item);
      if (idx !== -1) {
        this.syncQueue.splice(idx, 1);
        this.saveQueueToStorage();
      }
      this.updateSyncStatus();
      this.renderSyncQueueList();
      this.showToast('Queued item synced', 'success');
    } catch (err) {
      console.error('processSingleQueueItem error', err);
      item.status = 'failed';
      item.retryCount = (item.retryCount || 0) + 1;
      this.saveQueueToStorage();
      this.updateSyncStatus();
      this.renderSyncQueueList();
      this.showToast('Failed to sync queued item', 'warning');
    }
  }

  // automatic processing of queue
  async processSyncQueue() {
    if (!this.isOnline || this.syncQueue.length === 0 || !this.isApiConfigured()) return;
    // iterate copy to avoid mutation issues
    for (let i = 0; i < this.syncQueue.length; ) {
      const item = this.syncQueue[i];
      try {
        await this.syncToGoogleSheets(item);
        // if success, remove at i
        this.syncQueue.splice(i, 1);
        this.saveQueueToStorage();
        this.showToast('Queued item synced', 'success');
      } catch (err) {
        console.error('Queued item sync error', err);
        item.status = 'failed';
        item.retryCount = (item.retryCount || 0) + 1;
        i++; // move to next, keep failed item in queue
      }
    }
    this.updateSyncStatus();
    this.renderSyncQueueList();
  }

  startSyncInterval() {
    // run periodically
    setInterval(() => {
      if (this.isOnline) this.processSyncQueue();
    }, this.config.offlineSyncInterval);
  }

  // -----------------------
  // NETWORK / STATUS UI
  // -----------------------
  handleNetworkChange(online) {
    this.isOnline = online;
    this.updateNetworkStatus();
    if (online) {
      // try process queue asap
      this.processSyncQueue();
    }
  }

  updateNetworkStatus() {
    const on = navigator.onLine;
    if (this.networkDot) this.networkDot.className = `status-dot ${on ? 'online' : 'offline'}`;
    if (this.networkStatus) this.networkStatus.textContent = on ? 'Connected' : 'Offline';
  }

  updateCameraStatus(state) {
    if (this.cameraDot) this.cameraDot.className = `status-dot ${state === 'active' ? 'online' : 'offline'}`;
    if (this.cameraStatus) this.cameraStatus.textContent = state === 'active' ? 'Camera Active' : 'Camera Inactive';
  }

  updateSyncStatus() {
    const pending = (this.syncQueue && this.syncQueue.length) || 0;
    if (this.syncDot) this.syncDot.className = `status-dot ${pending === 0 ? 'online' : (this.syncQueue.some(i=>i.status==='failed') ? 'offline' : 'warning')}`;
    if (this.syncStatus) this.syncStatus.textContent = pending === 0 ? 'All Synced' : `${pending} Pending`;
    if (this.retrySyncBtn) {
      if (this.syncQueue.some(i=>i.status === 'failed')) this.retrySyncBtn.classList.remove('hidden');
      else this.retrySyncBtn.classList.add('hidden');
    }
  }

  // -----------------------
  // UI: loading / toast
  // -----------------------
  createToastContainer() {
    const c = document.createElement('div');
    c.id = 'toast-container';
    c.className = 'toast-container';
    document.body.appendChild(c);
    return c;
  }

  showToast(message, type = 'info') {
    if (!this.toastContainer) this.toastContainer = this.createToastContainer();
    const t = document.createElement('div');
    t.className = `toast toast--${type}`;
    t.textContent = message;
    this.toastContainer.appendChild(t);
    setTimeout(() => {
      t.classList.add('toast--hide');
      setTimeout(()=> t.remove(), 350);
    }, this.config.toastDuration);
  }

  showLoading(msg) {
    if (!this.loadingOverlay) return;
    const p = this.loadingOverlay.querySelector('p');
    if (p) p.textContent = msg || 'Loading...';
    this.loadingOverlay.classList.remove('hidden');
  }
  hideLoading() {
    if (!this.loadingOverlay) return;
    this.loadingOverlay.classList.add('hidden');
  }

  // -----------------------
  // Utilities
  // -----------------------
  clearAllData() {
    localStorage.removeItem('qr_sync_queue_v1');
    this.syncQueue = [];
    this.updateSyncStatus();
    this.renderSyncQueueList();
  }
}

// instantiate after DOM ready
window.addEventListener('DOMContentLoaded', () => {
  window.qrApp = new QRScannerApp();
});
