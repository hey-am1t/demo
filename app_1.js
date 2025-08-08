// Enhanced QR Scanner System Application
class QRScannerApp {
    constructor() {
        // Core scanner properties
        this.html5QrCode = null;
        this.isScanning = false;
        this.currentProduct = null;
        this.scannedQRCode = null;
        
        // App configuration from provided data
        this.config = {
            offlineSyncInterval: 30000,
            maxRetryAttempts: 3,
            toastDuration: 3000,
            cameraPermissionTimeout: 10000
        };

        // Status messages
        this.statusMessages = {
            networkOnline: "Connected",
            networkOffline: "Offline", 
            cameraActive: "Camera Active",
            cameraInactive: "Camera Inactive",
            syncComplete: "All Synced",
            syncPending: "Sync Pending",
            syncFailed: "Sync Failed"
        };

        // Sample products data (simulating Google Sheets data)
        this.sampleProducts = [
            {
                id: "WH-001",
                name: "Wireless Headphones",
                currentStock: 25,
                category: "Electronics",
                location: "A1-B2"
            },
            {
                id: "USB-002", 
                name: "USB Cable",
                currentStock: 150,
                category: "Accessories",
                location: "A2-B1"
            },
            {
                id: "PC-003",
                name: "Phone Case",
                currentStock: 75,
                category: "Accessories", 
                location: "A1-C3"
            }
        ];

        // Offline sync queue
        this.syncQueue = [];
        this.isOnline = navigator.onLine;
        this.retryCount = {};

        // Initialize app immediately
        this.initializeElements();
        this.bindEvents();
        this.initializeApp();
    }

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
    }

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

    async initializeApp() {
        try {
            // Show loading briefly
            this.showLoading('Initializing application...');
            
            // Initialize status indicators
            this.updateNetworkStatus();
            this.updateCameraStatus('inactive');
            this.updateSyncStatus();
            
            // Initialize button states
            this.initializeButtonStates();
            
            // Start sync interval
            this.startSyncInterval();
            
            // Brief initialization delay
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Hide loading and show success
            this.hideLoading();
            
            // Short delay before showing ready message
            setTimeout(() => {
                this.showToast('Application ready! Scan a QR code to begin.', 'success');
            }, 500);
            
        } catch (error) {
            console.error('Initialization error:', error);
            this.hideLoading();
            this.showToast('Initialization failed', 'error');
        }
    }

    // Status Management
    updateNetworkStatus() {
        const isOnline = navigator.onLine;
        this.isOnline = isOnline;
        
        this.networkDot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
        this.networkStatus.textContent = isOnline ? this.statusMessages.networkOnline : this.statusMessages.networkOffline;
        
        if (isOnline && this.syncQueue.length > 0) {
            this.processSyncQueue();
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

    // Camera Management
    async startCamera() {
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
            console.error('Error starting camera:', error);
            this.updateCameraStatus('inactive');
            this.startCameraBtn.style.display = 'block';
            this.hideLoading();
            this.showToast('Camera access denied or not available', 'error');
        }
    }

    async onScanSuccess(decodedText, decodedResult) {
        console.log('QR Code detected:', decodedText);
        
        // Temporarily stop scanning to prevent multiple scans
        if (this.html5QrCode && this.isScanning) {
            await this.html5QrCode.pause(true);
        }
        
        this.scannedQRCode = decodedText;
        
        // Show loading while fetching product data
        this.showLoading('Fetching product data...');
        
        // Simulate Google Sheets API call
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
                this.showToast('Unknown QR code scanned', 'warning');
                this.resumeScanning();
            }
        } catch (error) {
            this.hideLoading();
            this.showToast('Error fetching product data', 'error');
            this.resumeScanning();
        }
    }

    async resumeScanning() {
        if (this.html5QrCode && this.isScanning) {
            await this.html5QrCode.resume();
        }
    }

    // Google Sheets Integration (Simulated)
    async fetchProductFromGoogleSheets(productId) {
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Simulate potential network issues
        if (!this.isOnline) {
            throw new Error('No internet connection');
        }
        
        // Find product in sample data
        return this.sampleProducts.find(p => p.id === productId);
    }

    async syncToGoogleSheets(transactionData) {
        // Simulate API call delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Simulate random failures for offline testing
        if (!this.isOnline || Math.random() < 0.1) {
            throw new Error('Sync failed');
        }
        
        console.log('Synced to Google Sheets:', transactionData);
        return { success: true, timestamp: Date.now() };
    }

    // Modal Management
    showScanConfirmationModal(product) {
        document.getElementById('scan-product-name').textContent = product.name;
        document.getElementById('scan-product-id').textContent = product.id;
        document.getElementById('scan-current-stock').textContent = product.currentStock;
        
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

    // Transaction Processing
    populateProductInfo(product) {
        this.productNameEl.value = product.name;
        this.productIdEl.value = product.id;
        this.currentStockEl.value = product.currentStock;
        
        this.enterQtyEl.value = '';
        this.updateButtonStates();
        this.enterQtyEl.focus();
    }

    handleInventoryTransaction(type) {
        const qty = parseInt(this.enterQtyEl.value);
        
        if (!qty || qty <= 0) {
            this.showToast('Please enter a valid quantity', 'warning');
            return;
        }

        if (!this.currentProduct) {
            this.showToast('Please scan a product first', 'warning');
            return;
        }

        if (type === 'out') {
            if (qty > this.currentProduct.currentStock) {
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
        
        const transactionData = {
            id: Date.now(),
            timestamp: Date.now(),
            productId: this.currentProduct.id,
            productName: this.currentProduct.name,
            type: 'in',
            quantity: quantity,
            oldStock: this.currentProduct.currentStock,
            newStock: this.currentProduct.currentStock + quantity,
            user: 'Current User'
        };

        try {
            if (this.isOnline) {
                await this.syncToGoogleSheets(transactionData);
                this.updateProductStock(transactionData);
                this.hideLoading();
                this.showToast(`Added ${quantity} items to inventory`, 'success');
            } else {
                this.addToSyncQueue(transactionData);
                this.updateProductStock(transactionData);
                this.hideLoading();
                this.showToast(`Added ${quantity} items (queued for sync)`, 'warning');
            }
        } catch (error) {
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
        
        const transactionData = {
            id: Date.now(),
            timestamp: Date.now(),
            productId: this.currentProduct.id,
            productName: this.currentProduct.name,
            type: 'out',
            quantity: quantity,
            oldStock: this.currentProduct.currentStock,
            newStock: this.currentProduct.currentStock - quantity,
            issuedTo: issuedTo,
            user: 'Current User'
        };

        try {
            if (this.isOnline) {
                await this.syncToGoogleSheets(transactionData);
                this.updateProductStock(transactionData);
                this.hideLoading();
                this.showToast(`Issued ${quantity} items to ${issuedTo}`, 'success');
            } else {
                this.addToSyncQueue(transactionData);
                this.updateProductStock(transactionData);
                this.hideLoading();
                this.showToast(`Issued ${quantity} items (queued for sync)`, 'warning');
            }
        } catch (error) {
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
        
        // Update sample products array
        const productIndex = this.sampleProducts.findIndex(p => p.id === transactionData.productId);
        if (productIndex !== -1) {
            this.sampleProducts[productIndex].currentStock = transactionData.newStock;
        }
    }

    clearForm() {
        this.enterQtyEl.value = '';
        this.updateButtonStates();
        this.enterQtyEl.focus();
    }

    // Sync Queue Management
    addToSyncQueue(transactionData) {
        transactionData.status = 'pending';
        transactionData.retryCount = 0;
        this.syncQueue.push(transactionData);
        this.updateSyncStatus();
    }

    async processSyncQueue() {
        if (!this.isOnline || this.syncQueue.length === 0) return;
        
        const pendingItems = this.syncQueue.filter(item => item.status === 'pending' || item.status === 'failed');
        
        for (let item of pendingItems) {
            try {
                await this.syncToGoogleSheets(item);
                this.removeSyncItem(this.syncQueue.indexOf(item));
            } catch (error) {
                item.status = 'failed';
                item.retryCount = (item.retryCount || 0) + 1;
                if (item.retryCount >= this.config.maxRetryAttempts) {
                    console.error('Max retry attempts reached for item:', item);
                }
            }
        }
        
        this.updateSyncStatus();
    }

    async retrySyncItem(index) {
        const item = this.syncQueue[index];
        if (!item) return;
        
        item.status = 'pending';
        try {
            await this.syncToGoogleSheets(item);
            this.removeSyncItem(index);
            this.showToast('Item synced successfully', 'success');
        } catch (error) {
            item.status = 'failed';
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
        if (!this.isOnline) {
            this.showToast('No internet connection', 'error');
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

    // Utility Methods
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
            this.processSyncQueue();
        } else {
            this.showToast('Connection lost', 'warning');
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
            if (this.isOnline && this.syncQueue.length > 0) {
                this.processSyncQueue();
            }
        }, this.config.offlineSyncInterval);
    }

    // UI Feedback Methods
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
                console.error('Error during cleanup:', error);
            }
        }
    }

    // Development utilities
    simulateQRScan(qrCode) {
        const product = this.sampleProducts.find(p => p.id === qrCode);
        if (product) {
            this.onScanSuccess(qrCode);
            console.log(`Simulated scan of ${qrCode}: ${product.name}`);
        } else {
            console.log(`Unknown QR code: ${qrCode}`);
        }
    }

    toggleOfflineMode() {
        this.isOnline = !this.isOnline;
        this.handleNetworkChange(this.isOnline);
        console.log(`Offline mode: ${!this.isOnline}`);
    }

    // Add some demo sync queue items for testing
    addDemoSyncItems() {
        const demoItems = [
            {
                id: Date.now() - 1000,
                timestamp: Date.now() - 1000,
                productId: 'WH-001',
                productName: 'Wireless Headphones',
                type: 'out',
                quantity: 2,
                issuedTo: 'John Doe',
                status: 'failed',
                retryCount: 1
            },
            {
                id: Date.now(),
                timestamp: Date.now(),
                productId: 'USB-002', 
                productName: 'USB Cable',
                type: 'in',
                quantity: 10,
                status: 'pending',
                retryCount: 0
            }
        ];
        
        this.syncQueue.push(...demoItems);
        this.updateSyncStatus();
        this.showToast('Demo sync items added', 'info');
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    const app = new QRScannerApp();
    
    // Make app globally available for testing
    window.qrApp = app;
    
    console.log('Enhanced QR Scanner System loaded!');
    console.log('Available testing commands:');
    console.log('- qrApp.simulateQRScan("WH-001") // Simulate scanning Wireless Headphones');
    console.log('- qrApp.simulateQRScan("USB-002") // Simulate scanning USB Cable'); 
    console.log('- qrApp.simulateQRScan("PC-003") // Simulate scanning Phone Case');
    console.log('- qrApp.toggleOfflineMode() // Toggle offline mode');
    console.log('- qrApp.showSyncQueueModal() // Show sync queue');
    console.log('- qrApp.addDemoSyncItems() // Add demo sync items for testing');
    console.log('Available QR codes: WH-001, USB-002, PC-003');
});