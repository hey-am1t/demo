// ====================================
// PRODUCTION QR SCANNER SYSTEM
// ====================================

// 🔧 CONFIGURATION - UPDATE THIS WITH YOUR GOOGLE APPS SCRIPT URL
const API_URL = "https://script.google.com/macros/s/AKfycbwlgIgEEiZvIvXuZd0m9blXTs5Uip3EQ0HElam0rDmOF0yZxPGnsiuoAMygkH6s3vFnnw/exec";

// ====================================
// Main Application Class
// ====================================
class QRScannerApp {
    constructor() {
        // Core scanner properties
        this.html5QrCode = null;
        this.isScanning = false;
        this.currentProduct = null;
        this.scannedQRCode = null;
        this.isApiConfigured = this.checkApiConfiguration();
        
        // App configuration
        this.config = {
            offlineSyncInterval: 30000,
            maxRetryAttempts: 3,
            toastDuration: 3000,
            cameraPermissionTimeout: 10000,
            apiTimeout: 10000
        };

        // Status messages
        this.statusMessages = {
            networkOnline: "Connected",
            networkOffline: "Offline", 
            cameraActive: "Camera Active",
            cameraInactive: "Camera Inactive",
            syncComplete: "All Synced",
            syncPending: "Sync Pending",
            syncFailed: "Sync Failed",
            apiNotConfigured: "API Not Configured"
        };

        // Error messages from configuration
        this.errorMessages = {
            apiNotConfigured: "Please configure your Google Apps Script URL in app.js",
            noProducts: "No products found. Please add products to your Google Sheets",
            cameraError: "Unable to access camera. Please check permissions",
            networkError: "Network error. Operating in offline mode"
        };

        // Offline sync queue (in-memory only, no localStorage)
        this.syncQueue = [];
        this.isOnline = navigator.onLine;
        this.retryCount = {};

        // Initialize app immediately (completely non-blocking)
        this.initializeElements();
        this.bindEvents();
        this.initializeApp();
    }

    // ====================================
    // Configuration Check
    // ====================================
    checkApiConfiguration() {
        return API_URL && API_URL !== "https://script.google.com/macros/s/AKfycbwlgIgEEiZvIvXuZd0m9blXTs5Uip3EQ0HElam0rDmOF0yZxPGnsiuoAMygkH6s3vFnnw/exec" && API_URL.startsWith('http');
    }

    // ====================================
    // Element Initialization
    // ====================================
    initializeElements() {
        // Camera elements
        this.startCameraBtn = document.getElementById('start-camera-btn');
        this.cameraContainer = document.getElementById('qr-reader');
        
        // Product form elements
        this.productNameEl = document.getElementById('product-name');
        this.productIdEl = document.getElementById('product-id');
        this.currentStockEl = document.getElementById('current-stock');
        this.enterQtyEl = document.getElementById('enter-qty');
        
        // Action buttons
        this.inBtn = document.getElementById('in-btn');
        this.outBtn = document.getElementById('out-btn');

        // Status bar elements
        this.networkDot = document.getElementById('network-dot');
        this.networkStatus = document.getElementById('network-status');
        this.cameraDot = document.getElementById('camera-dot');
        this.cameraStatus = document.getElementById('camera-status');
        this.syncDot = document.getElementById('sync-dot');
        this.syncStatus = document.getElementById('sync-status');
        this.retrySyncBtn = document.getElementById('retry-sync-btn');

        // Modal elements
        this.scanConfirmationModal = document.getElementById('scan-confirmation-modal');
        this.issuedToModal = document.getElementById('issued-to-modal');
        this.syncQueueModal = document.getElementById('sync-queue-modal');
        
        // Toast container
        this.toastContainer = document.getElementById('toast-container');
        
        // Loading overlay
        this.loadingOverlay = document.getElementById('loading-overlay');

        // Product form and empty state
        this.productForm = document.getElementById('product-form');
        this.productEmptyState = document.getElementById('product-empty-state');
    }

    // ====================================
    // Event Binding
    // ====================================
    bindEvents() {
        // Camera events
        this.startCameraBtn.addEventListener('click', () => this.startCamera());
        
        // Form events
        this.enterQtyEl.addEventListener('input', () => this.updateButtonStates());
        this.enterQtyEl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !this.inBtn.disabled) {
                this.handleInventoryTransaction('in');
            }
        });

        // Action button events
        this.inBtn.addEventListener('click', () => this.handleInventoryTransaction('in'));
        this.outBtn.addEventListener('click', () => this.handleInventoryTransaction('out'));

        // Modal events
        this.bindModalEvents();

        // Network events
        window.addEventListener('online', () => this.handleNetworkChange(true));
        window.addEventListener('offline', () => this.handleNetworkChange(false));

        // Status bar events
        this.retrySyncBtn.addEventListener('click', () => this.retryAllSync());
        this.syncStatus.addEventListener('click', () => {
            if (this.syncQueue.length > 0) {
                this.showSyncQueueModal();
            }
        });

        // App lifecycle events
        document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    bindModalEvents() {
        // Scan confirmation modal
        document.getElementById('scan-modal-close').addEventListener('click', () => this.hideScanConfirmationModal());
        document.getElementById('scan-ok-btn').addEventListener('click', () => this.confirmScan());
        
        // Issued to modal
        document.getElementById('issued-modal-close').addEventListener('click', () => this.hideIssuedToModal());
        document.getElementById('cancel-issue-btn').addEventListener('click', () => this.hideIssuedToModal());
        document.getElementById('confirm-issue-btn').addEventListener('click', () => this.confirmIssue());
        
        // Sync queue modal
        document.getElementById('sync-modal-close').addEventListener('click', () => this.hideSyncQueueModal());
        document.getElementById('retry-all-btn').addEventListener('click', () => this.retryAllSync());
        document.getElementById('clear-queue-btn').addEventListener('click', () => this.clearSyncQueue());

        // Modal overlay clicks
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    const modal = overlay.closest('.modal');
                    if (modal) {
                        this.hideModal(modal);
                    }
                }
            });
        });
    }

    // ====================================
    // Application Initialization (Completely Non-blocking)
    // ====================================
    initializeApp() {
        console.log('🚀 Starting QR Scanner System...');
        
        // Initialize status indicators immediately (synchronously)
        this.updateNetworkStatus();
        this.updateCameraStatus('inactive');
        this.updateSyncStatus();
        
        // Initialize button states immediately
        this.initializeButtonStates();
        
        // Show empty product state
        this.showProductEmptyState();
        
        // Check API configuration and show warning if needed (non-blocking)
        if (!this.isApiConfigured) {
            setTimeout(() => this.showApiConfigurationWarning(), 100);
        } else {
            // Test API connection in background (non-blocking)
            setTimeout(() => this.testApiConnection(), 200);
        }
        
        // Start sync interval
        this.startSyncInterval();
        
        // Show success message (delayed, non-blocking)
        setTimeout(() => {
            const message = this.isApiConfigured 
                ? 'System ready! Scan a QR code to begin.'
                : 'System loaded. Please configure API URL in app.js to begin.';
            const type = this.isApiConfigured ? 'success' : 'warning';
            this.showToast(message, type);
        }, 500);
    }

    // ====================================
    // Product State Management
    // ====================================
    showProductEmptyState() {
        if (this.productForm) {
            this.productForm.style.display = 'none';
        }
        if (this.productEmptyState) {
            this.productEmptyState.style.display = 'flex';
        }
    }

    showProductForm() {
        if (this.productEmptyState) {
            this.productEmptyState.style.display = 'none';
        }
        if (this.productForm) {
            this.productForm.style.display = 'flex';
        }
    }

    // ====================================
    // API Configuration Warning
    // ====================================
    showApiConfigurationWarning() {
        console.warn('⚠️ API URL not configured. Please update the API_URL constant in app.js');
        
        // Show setup instructions
        const setupInstructions = `
            <div class="setup-instructions">
                <h4>⚙️ Setup Required</h4>
                <ol>
                    <li>Open <code>app.js</code> file</li>
                    <li>Find the <code>API_URL</code> variable at the top</li>
                    <li>Replace <code>REPLACE_WITH_YOUR_GOOGLE_APPS_SCRIPT_URL</code> with your Google Apps Script URL</li>
                    <li>Save and refresh the page</li>
                </ol>
                <p>
                    Example: <code>const API_URL = "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec";</code>
                </p>
            </div>
        `;
        
        // Inject setup instructions into the page
        const container = document.querySelector('.main-content');
        if (container) {
            const setupDiv = document.createElement('div');
            setupDiv.innerHTML = setupInstructions;
            container.insertBefore(setupDiv, container.firstChild);
        }
    }

    // ====================================
    // API Connection Test (Non-blocking)
    // ====================================
    async testApiConnection() {
        try {
            console.log('🔗 Testing API connection...');
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.apiTimeout);
            
            const response = await fetch(API_URL + '?action=test', {
                method: 'GET',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                console.log('✅ API connection successful');
                this.showToast('Connected to Google Sheets API', 'success');
            } else {
                console.warn('⚠️ API responded with error:', response.status);
                this.showToast('API connection issue. Check your Google Apps Script.', 'warning');
            }
        } catch (error) {
            console.error('❌ API connection failed:', error);
            if (error.name !== 'AbortError') {
                this.showToast('Could not connect to Google Sheets. Check your API URL.', 'error');
            }
        }
    }

    // ====================================
    // Status Management
    // ====================================
    updateNetworkStatus() {
        const isOnline = navigator.onLine;
        this.isOnline = isOnline;
        
        this.networkDot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
        this.networkStatus.textContent = isOnline ? this.statusMessages.networkOnline : this.statusMessages.networkOffline;
        
        if (isOnline && this.syncQueue.length > 0) {
            setTimeout(() => this.processSyncQueue(), 1000);
        }
    }

    updateCameraStatus(status) {
        const statusClass = status === 'active' ? 'online' : 'offline';
        this.cameraDot.className = `status-dot ${statusClass}`;
        this.cameraStatus.textContent = status === 'active' ? 
            this.statusMessages.cameraActive : 
            this.statusMessages.cameraInactive;
    }

    updateSyncStatus() {
        const pendingCount = this.syncQueue.length;
        const failedItems = this.syncQueue.filter(item => item.status === 'failed');
        
        if (pendingCount === 0) {
            this.syncDot.className = 'status-dot online';
            this.syncStatus.textContent = this.statusMessages.syncComplete;
            this.retrySyncBtn.classList.add('hidden');
        } else if (failedItems.length > 0) {
            this.syncDot.className = 'status-dot offline';
            this.syncStatus.textContent = `${failedItems.length} Failed`;
            this.retrySyncBtn.classList.remove('hidden');
        } else {
            this.syncDot.className = 'status-dot warning pulsing';
            this.syncStatus.textContent = `${pendingCount} Pending`;
            this.retrySyncBtn.classList.add('hidden');
        }
    }

    // ====================================
    // Camera Management
    // ====================================
    async startCamera() {
        if (!this.isApiConfigured) {
            this.showToast('Please configure your Google Apps Script URL first', 'warning');
            return;
        }

        try {
            this.showLoading('Starting camera...');
            this.startCameraBtn.style.display = 'none';
            
            this.html5QrCode = new Html5Qrcode("qr-reader");
            
            const config = {
                fps: 10,
                qrbox: { width: 220, height: 220 },
                aspectRatio: 1.0,
                disableFlip: false
            };

            await this.html5QrCode.start(
                { facingMode: "environment" },
                config,
                (decodedText, decodedResult) => {
                    this.onScanSuccess(decodedText, decodedResult);
                },
                (errorMessage) => {
                    // Ignore frequent scan errors
                }
            );

            this.isScanning = true;
            this.updateCameraStatus('active');
            this.hideLoading();
            this.showToast('Camera started successfully', 'success');
            
        } catch (error) {
            console.error('❌ Error starting camera:', error);
            this.updateCameraStatus('inactive');
            this.startCameraBtn.style.display = 'block';
            this.hideLoading();
            this.showToast(this.errorMessages.cameraError, 'error');
        }
    }

    async onScanSuccess(decodedText, decodedResult) {
        console.log('📱 QR Code detected:', decodedText);
        
        // Temporarily stop scanning to prevent multiple scans
        if (this.html5QrCode && this.isScanning) {
            await this.html5QrCode.pause(true);
        }
        
        this.scannedQRCode = decodedText;
        
        // Show loading while fetching product data
        this.showLoading('Fetching product data...');
        
        try {
            const product = await this.fetchProductFromGoogleSheets(decodedText);
            this.hideLoading();
            
            if (product) {
                this.showScanConfirmationModal(product);
                
                // Add visual feedback
                this.cameraContainer.classList.add('scan-success');
                setTimeout(() => {
                    this.cameraContainer.classList.remove('scan-success');
                }, 600);
            } else {
                this.showToast('Product not found in inventory', 'warning');
                this.resumeScanning();
            }
        } catch (error) {
            console.error('❌ Error fetching product:', error);
            this.hideLoading();
            this.showToast('Error fetching product data. Check connection and API configuration.', 'error');
            this.resumeScanning();
        }
    }

    async resumeScanning() {
        if (this.html5QrCode && this.isScanning) {
            await this.html5QrCode.resume();
        }
    }

    // ====================================
    // Google Sheets Integration (Real API)
    // ====================================
    async fetchProductFromGoogleSheets(productId) {
        if (!this.isApiConfigured) {
            throw new Error('API not configured');
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.apiTimeout);
            
            const response = await fetch(`${API_URL}?action=getProduct&productId=${encodeURIComponent(productId)}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.success) {
                return data.product;
            } else {
                console.warn('⚠️ Product not found:', data.message);
                return null;
            }
        } catch (error) {
            console.error('❌ API request failed:', error);
            throw error;
        }
    }

    async syncToGoogleSheets(transactionData) {
        if (!this.isApiConfigured) {
            throw new Error('API not configured');
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.apiTimeout);
            
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'addTransaction',
                    transaction: transactionData
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message || 'Sync failed');
            }
            
            console.log('✅ Synced to Google Sheets:', transactionData);
            return result;
        } catch (error) {
            console.error('❌ Sync failed:', error);
            throw error;
        }
    }

    // ====================================
    // Modal Management
    // ====================================
    showScanConfirmationModal(product) {
        document.getElementById('scan-product-name').textContent = product.name;
        document.getElementById('scan-product-id').textContent = product.id;
        document.getElementById('scan-current-stock').textContent = product.currentStock || 0;
        
        this.currentProduct = { ...product };
        this.showModal(this.scanConfirmationModal);
    }

    hideScanConfirmationModal() {
        this.hideModal(this.scanConfirmationModal);
        this.resumeScanning();
    }

    confirmScan() {
        this.hideScanConfirmationModal();
        this.populateProductInfo(this.currentProduct);
        this.showToast(`Product loaded: ${this.currentProduct.name}`, 'success');
    }

    showIssuedToModal(product, quantity) {
        document.getElementById('issue-product-name').textContent = product.name;
        document.getElementById('issue-quantity').textContent = quantity;
        document.getElementById('issued-to-name').value = '';
        
        this.showModal(this.issuedToModal);
        
        // Focus on name input
        setTimeout(() => {
            document.getElementById('issued-to-name').focus();
        }, 300);
    }

    hideIssuedToModal() {
        this.hideModal(this.issuedToModal);
    }

    confirmIssue() {
        const personName = document.getElementById('issued-to-name').value.trim();
        
        if (!personName) {
            this.showToast('Please enter person name', 'warning');
            return;
        }
        
        this.hideIssuedToModal();
        this.processStockOut(personName);
    }

    showSyncQueueModal() {
        this.renderSyncQueueList();
        this.showModal(this.syncQueueModal);
    }

    hideSyncQueueModal() {
        this.hideModal(this.syncQueueModal);
    }

    renderSyncQueueList() {
        const container = document.getElementById('sync-queue-list');
        
        if (this.syncQueue.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--color-text-secondary); padding: var(--space-20);">No pending items</p>';
            return;
        }
        
        container.innerHTML = this.syncQueue.map((item, index) => `
            <div class="sync-queue-item">
                <div class="queue-item-info">
                    <h5>${item.type.toUpperCase()}: ${item.productName}</h5>
                    <p>Qty: ${item.quantity} | ${new Date(item.timestamp).toLocaleString()}</p>
                    ${item.issuedTo ? `<p>Issued to: ${item.issuedTo}</p>` : ''}
                    <p>Status: ${item.status} (${item.retryCount || 0} retries)</p>
                </div>
                <div class="queue-item-actions">
                    <button class="btn btn--sm btn--outline" onclick="qrApp.retrySyncItem(${index})">Retry</button>
                    <button class="btn btn--sm btn--secondary" onclick="qrApp.removeSyncItem(${index})">Delete</button>
                </div>
            </div>
        `).join('');
    }

    showModal(modal) {
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    hideModal(modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
    }

    // ====================================
    // Transaction Processing
    // ====================================
    populateProductInfo(product) {
        this.productNameEl.value = product.name;
        this.productIdEl.value = product.id;
        this.currentStockEl.value = product.currentStock || 0;
        
        this.enterQtyEl.value = '';
        this.updateButtonStates();
        
        // Show product form and hide empty state
        this.showProductForm();
        
        // Focus on quantity input
        setTimeout(() => this.enterQtyEl.focus(), 100);
    }

    handleInventoryTransaction(type) {
        if (!this.isApiConfigured) {
            this.showToast('Please configure your Google Apps Script URL first', 'warning');
            return;
        }

        const qty = parseInt(this.enterQtyEl.value);
        
        if (!qty || qty <= 0) {
            this.showToast('Please enter a valid quantity', 'warning');
            return;
        }

        if (!this.currentProduct) {
            this.showToast('Please scan a product first', 'warning');
            return;
        }

        const currentStock = parseInt(this.currentProduct.currentStock) || 0;

        if (type === 'out') {
            if (qty > currentStock) {
                this.showToast('Insufficient stock for this transaction', 'error');
                return;
            }
            this.showIssuedToModal(this.currentProduct, qty);
        } else {
            this.processStockIn(qty);
        }
    }

    async processStockIn(quantity) {
        this.showLoading('Processing stock IN...');
        
        const currentStock = parseInt(this.currentProduct.currentStock) || 0;
        const transactionData = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            productId: this.currentProduct.id,
            productName: this.currentProduct.name,
            type: 'in',
            quantity: quantity,
            oldStock: currentStock,
            newStock: currentStock + quantity,
            user: 'QR Scanner User'
        };

        try {
            if (this.isOnline && this.isApiConfigured) {
                await this.syncToGoogleSheets(transactionData);
                this.updateProductStock(transactionData);
                this.hideLoading();
                this.showToast(`Added ${quantity} items to inventory`, 'success');
            } else {
                this.addToSyncQueue(transactionData);
                this.updateProductStock(transactionData);
                this.hideLoading();
                const message = !this.isOnline ? 
                    `Added ${quantity} items (queued for sync - offline)` :
                    `Added ${quantity} items (queued for sync - API not configured)`;
                this.showToast(message, 'warning');
            }
        } catch (error) {
            console.error('❌ Stock IN failed:', error);
            this.addToSyncQueue(transactionData);
            this.updateProductStock(transactionData);
            this.hideLoading();
            this.showToast(`Added ${quantity} items (sync failed, queued)`, 'warning');
        }

        this.clearForm();
    }

    async processStockOut(issuedTo) {
        const quantity = parseInt(this.enterQtyEl.value);
        this.showLoading('Processing stock OUT...');
        
        const currentStock = parseInt(this.currentProduct.currentStock) || 0;
        const transactionData = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            productId: this.currentProduct.id,
            productName: this.currentProduct.name,
            type: 'out',
            quantity: quantity,
            oldStock: currentStock,
            newStock: currentStock - quantity,
            issuedTo: issuedTo,
            user: 'QR Scanner User'
        };

        try {
            if (this.isOnline && this.isApiConfigured) {
                await this.syncToGoogleSheets(transactionData);
                this.updateProductStock(transactionData);
                this.hideLoading();
                this.showToast(`Issued ${quantity} items to ${issuedTo}`, 'success');
            } else {
                this.addToSyncQueue(transactionData);
                this.updateProductStock(transactionData);
                this.hideLoading();
                const message = !this.isOnline ? 
                    `Issued ${quantity} items (queued for sync - offline)` :
                    `Issued ${quantity} items (queued for sync - API not configured)`;
                this.showToast(message, 'warning');
            }
        } catch (error) {
            console.error('❌ Stock OUT failed:', error);
            this.addToSyncQueue(transactionData);
            this.updateProductStock(transactionData);
            this.hideLoading();
            this.showToast(`Issued ${quantity} items (sync failed, queued)`, 'warning');
        }

        this.clearForm();
    }

    updateProductStock(transactionData) {
        // Update current product
        this.currentProduct.currentStock = transactionData.newStock;
        this.currentStockEl.value = transactionData.newStock;
    }

    clearForm() {
        this.enterQtyEl.value = '';
        this.updateButtonStates();
        this.enterQtyEl.focus();
    }

    // ====================================
    // Sync Queue Management (In-Memory Only)
    // ====================================
    addToSyncQueue(transactionData) {
        transactionData.status = 'pending';
        transactionData.retryCount = 0;
        this.syncQueue.push(transactionData);
        this.updateSyncStatus();
    }

    async processSyncQueue() {
        if (!this.isOnline || this.syncQueue.length === 0 || !this.isApiConfigured) return;
        
        console.log(`🔄 Processing ${this.syncQueue.length} queued items...`);
        
        const pendingItems = this.syncQueue.filter(item => item.status === 'pending' || item.status === 'failed');
        
        for (let item of pendingItems) {
            try {
                await this.syncToGoogleSheets(item);
                this.removeSyncItem(this.syncQueue.indexOf(item));
                console.log('✅ Synced queued item:', item.productName);
            } catch (error) {
                item.status = 'failed';
                item.retryCount = (item.retryCount || 0) + 1;
                console.error(`❌ Failed to sync item (attempt ${item.retryCount}):`, error);
            }
        }
        
        this.updateSyncStatus();
    }

    async retrySyncItem(index) {
        const item = this.syncQueue[index];
        if (!item || !this.isApiConfigured) return;
        
        item.status = 'pending';
        try {
            await this.syncToGoogleSheets(item);
            this.removeSyncItem(index);
            this.showToast('Item synced successfully', 'success');
        } catch (error) {
            item.status = 'failed';
            item.retryCount = (item.retryCount || 0) + 1;
            this.showToast('Sync failed, try again later', 'error');
        }
        
        this.updateSyncStatus();
        this.renderSyncQueueList();
    }

    removeSyncItem(index) {
        this.syncQueue.splice(index, 1);
        this.updateSyncStatus();
        if (this.syncQueueModal && !this.syncQueueModal.classList.contains('hidden')) {
            this.renderSyncQueueList();
        }
    }

    async retryAllSync() {
        if (!this.isOnline || !this.isApiConfigured) {
            this.showToast('Cannot sync: ' + (!this.isOnline ? 'No internet connection' : 'API not configured'), 'error');
            return;
        }
        
        this.showToast('Retrying all failed items...', 'info');
        await this.processSyncQueue();
        this.hideSyncQueueModal();
    }

    clearSyncQueue() {
        this.syncQueue = [];
        this.updateSyncStatus();
        this.hideSyncQueueModal();
        this.showToast('Sync queue cleared', 'info');
    }

    // ====================================
    // Utility Methods
    // ====================================
    initializeButtonStates() {
        this.inBtn.disabled = true;
        this.outBtn.disabled = true;
    }

    updateButtonStates() {
        const hasProduct = this.currentProduct !== null;
        const qtyValue = this.enterQtyEl.value.trim();
        const qty = parseInt(qtyValue);
        const hasValidQuantity = qtyValue !== '' && !isNaN(qty) && qty > 0;
        
        const shouldEnable = hasProduct && hasValidQuantity;
        
        this.inBtn.disabled = !shouldEnable;
        this.outBtn.disabled = !shouldEnable;
    }

    handleNetworkChange(isOnline) {
        this.isOnline = isOnline;
        this.updateNetworkStatus();
        
        if (isOnline) {
            this.showToast('Connection restored', 'success');
            if (this.isApiConfigured) {
                setTimeout(() => this.processSyncQueue(), 1000);
            }
        } else {
            this.showToast('Connection lost - operating in offline mode', 'warning');
        }
    }

    handleVisibilityChange() {
        if (document.hidden && this.isScanning) {
            this.html5QrCode?.pause(true);
        } else if (!document.hidden && this.isScanning) {
            this.html5QrCode?.resume();
        }
    }

    startSyncInterval() {
        setInterval(() => {
            if (this.isOnline && this.syncQueue.length > 0 && this.isApiConfigured) {
                this.processSyncQueue();
            }
        }, this.config.offlineSyncInterval);
    }

    // ====================================
    // UI Feedback Methods
    // ====================================
    showLoading(message = 'Loading...') {
        if (this.loadingOverlay && this.loadingOverlay.querySelector) {
            const messageEl = this.loadingOverlay.querySelector('p');
            if (messageEl) {
                messageEl.textContent = message;
            }
            this.loadingOverlay.classList.remove('hidden');
        }
    }

    hideLoading() {
        if (this.loadingOverlay) {
            this.loadingOverlay.classList.add('hidden');
        }
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icon = this.getToastIcon(type);
        toast.innerHTML = `
            <div class="toast-icon">${icon}</div>
            <div class="toast-message">${message}</div>
        `;
        
        this.toastContainer.appendChild(toast);
        
        // Trigger animation
        setTimeout(() => toast.classList.add('show'), 100);
        
        // Auto remove
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentNode) {
                    this.toastContainer.removeChild(toast);
                }
            }, 300);
        }, this.config.toastDuration);
    }

    getToastIcon(type) {
        const icons = {
            success: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>',
            error: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>',
            warning: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
            info: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>'
        };
        return icons[type] || icons.info;
    }

    async cleanup() {
        if (this.html5QrCode && this.isScanning) {
            try {
                await this.html5QrCode.stop();
                this.html5QrCode.clear();
            } catch (error) {
                console.error('❌ Error during cleanup:', error);
            }
        }
    }
}

// ====================================
// Application Initialization
// ====================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎯 Initializing Production QR Scanner System...');
    
    const app = new QRScannerApp();
    
    // Make app globally available for debugging
    window.qrApp = app;
    
    console.log('✅ QR Scanner System initialized successfully!');
    console.log('📋 Configuration Status:');
    console.log(`   - API Configured: ${app.isApiConfigured ? '✅' : '❌'}`);
    console.log(`   - Network Status: ${app.isOnline ? '🌐 Online' : '📡 Offline'}`);
    console.log('');
    console.log('🛠️  Available Debug Commands:');
    console.log('   - qrApp.testApiConnection() // Test Google Sheets connection');
    console.log('   - qrApp.showSyncQueueModal() // View pending sync items');
    console.log('   - qrApp.clearSyncQueue() // Clear all pending syncs');
    console.log('');
    console.log('ℹ️  To configure: Update API_URL at the top of app.js');
});
