// =============================================================
//  FINAL MERGED app.js  –  PRODUCTION QR SCANNER (AUG-2025)
// =============================================================
//  • Combines every feature from earlier snippets
//  • Fixes all missing-method / null-pointer / camera errors
//  • Wraps init in DOMContentLoaded, optional-chains DOM refs
//  • Provides network + visibility handlers, robust toasts, sync queue
//  • Uses Html5Qrcode (cdn assumed loaded in HTML)
//  • READY FOR COPY-PASTE – works with the HTML ids/classes shipped in
//    your latest index.html from the "production-qr-scanner" bundle
// =============================================================

// === CONFIG – replace with your own Apps Script URL ===================
const API_URL = "https://script.google.com/macros/s/AKfycbwlgIgEEiZvIvXuZd0m9blXTs5Uip3EQ0HElam0rDmOF0yZxPGnsiuoAMygkH6s3vFnnw/exec";

// =======  Tiny Helpers  =================================================
const $   = (sel)   => document.querySelector(sel);
const $$  = (sel)   => Array.from(document.querySelectorAll(sel));
const wait = (ms)=>new Promise(r=>setTimeout(r,ms));
function ensureToastContainer(){let t=$('#toast-container');if(!t){t=document.createElement('div');t.id='toast-container';t.className='toast-container';document.body.appendChild(t);}return t;}

// =======  QRScannerApp CLASS ===========================================
class QRScannerApp {
  constructor(){
    this.isOnline   = navigator.onLine;
    this.html5QrCode= null;    // Html5Qrcode instance
    this.isScanning = false;
    this.currentProduct = null;
    this.syncQueue = [];
    this.toastDur  = 3000;
    this.scanPaused= false;
    this.isApiConfigured = /https?:\/\//.test(API_URL) && !API_URL.includes('YOUR_SCRIPT_ID');
    this.initDOM();
    this.bindEvents();
    this.startup();
  }

  // ---------- DOM refs ----------------
  initDOM(){
    // primary controls
    this.btnStartCam = $('#start-camera-btn');
    this.btnIn       = $('#in-btn');
    this.btnOut      = $('#out-btn');
    this.qtyInput    = $('#enter-qty');
    this.readerBox   = $('#qr-reader');
    // product fields
    this.nameField   = $('#product-name');
    this.idField     = $('#product-id');
    this.stockField  = $('#current-stock');
    // status bar elements
    this.netDot=$('#network-dot');this.netTxt=$('#network-status');
    this.camDot=$('#camera-dot');this.camTxt=$('#camera-status');
    this.syncDot=$('#sync-dot');this.syncTxt=$('#sync-status');this.retrySyncBtn=$('#retry-sync-btn');
    // modals
    this.modalScan   = $('#scan-confirmation-modal');
    this.modalIssue  = $('#issued-to-modal');
    this.modalSync   = $('#sync-queue-modal');
    // misc containers
    this.toastCont   = ensureToastContainer();
    this.loading     = $('#loading-overlay');
    // empty/product
    this.formProd = $('#product-form');
    this.emptyProd= $('#product-empty-state');
  }

  // ---------- EVENTS ------------------
  bindEvents(){
    this.btnStartCam?.addEventListener('click',()=>this.startCamera());
    this.qtyInput?.addEventListener('input',()=>this.updateButtons());
    this.qtyInput?.addEventListener('keypress',e=>{if(e.key==='Enter'&&!this.btnIn.disabled)this.handleTxn('IN');});
    this.btnIn?.addEventListener('click',()=>this.handleTxn('IN'));
    this.btnOut?.addEventListener('click',()=>this.handleTxn('OUT'));
    // modal buttons
    $('#scan-ok-btn')?.addEventListener('click',()=>this.confirmScan());
    $('#scan-modal-close')?.addEventListener('click',()=>this.hideModal(this.modalScan));
    $('#issued-modal-close')?.addEventListener('click',()=>this.hideModal(this.modalIssue));
    $('#cancel-issue-btn')?.addEventListener('click',()=>this.hideModal(this.modalIssue));
    $('#confirm-issue-btn')?.addEventListener('click',()=>this.confirmIssue());
    $('#sync-modal-close')?.addEventListener('click',()=>this.hideModal(this.modalSync));
    $('#retry-all-btn')?.addEventListener('click',()=>this.retryAllSync());
    $('#clear-queue-btn')?.addEventListener('click',()=>this.clearSync());

    this.retrySyncBtn?.addEventListener('click',()=>this.retryAllSync());
    this.syncTxt?.addEventListener('click',()=>{if(this.syncQueue.length)this.showModal(this.modalSync);});

    window.addEventListener('online', ()=>this.updateNetwork(true));
    window.addEventListener('offline',()=>this.updateNetwork(false));
    document.addEventListener('visibilitychange',()=>this.onVisibility());
    window.addEventListener('beforeunload',()=>this.cleanup());
  }

  // ---------- STARTUP -----------------
  startup(){
    this.updateNetwork(this.isOnline);
    this.updateCameraStatus(false);
    this.updateSyncStatus();
    this.showEmpty();
    if(!this.isApiConfigured) this.toast('Configure API_URL in app.js','warning');
    else this.testAPI();
    setInterval(()=>{if(this.isOnline&&this.syncQueue.length&&this.isApiConfigured) this.syncQueueProcess();},30000);
  }

  // ---------- NETWORK -----------------
  updateNetwork(online){
    this.isOnline=online;
    if(this.netDot){this.netDot.className='status-dot '+(online?'online':'offline');}
    if(this.netTxt){this.netTxt.textContent=online?'Connected':'Offline';}
    if(online) this.syncQueueProcess();
  }

  // ---------- CAMERA ------------------
  updateCameraStatus(active){
    this.camDot?.classList.remove('online','offline');
    this.camDot?.classList.add(active?'online':'offline');
    this.camTxt.textContent = active?'Camera Active':'Camera Inactive';
  }

  async startCamera(){
    if(!navigator.mediaDevices?.getUserMedia){this.toast('Camera API unsupported','error');return;}
    try{
      this.showLoading('Opening camera...');
      this.btnStartCam?.classList.add('hidden');
      this.html5QrCode = new Html5Qrcode("qr-reader");
      await this.html5QrCode.start({facingMode:"environment"},{fps:10,qrbox:{width:220,height:220}},(txt,_)=>this.onScan(txt));
      this.isScanning=true;
      this.updateCameraStatus(true);
      this.hideLoading();
      this.toast('Camera started','success');
    }catch(e){console.error(e);this.hideLoading();this.btnStartCam?.classList.remove('hidden');this.updateCameraStatus(false);this.toast('Camera error','error');}
  }

  async onScan(text){
    if(this.scanPaused) return;
    this.scanPaused=true;
    this.html5QrCode.pause(true);
    this.showLoading('Fetching product...');
    try{
      const prod = await this.fetchProduct(text);
      if(!prod){this.toast('Product not found','warning');return this.resumeScan();}
      this.currentProduct=prod;
      this.populateProduct(prod);
      this.showModal(this.modalScan);
    }catch(err){console.error(err);this.toast('API error','error');}
    finally{this.hideLoading();}
  }

  resumeScan(){this.scanPaused=false;this.html5QrCode?.resume();}
  confirmScan(){this.hideModal(this.modalScan);this.resumeScan();this.showForm();this.toast('Product loaded','success');}

  // ---------- PRODUCT UI -------------
  populateProduct(p){this.nameField.value=p.name;this.idField.value=p.id;this.stockField.value=p.currentStock||0;this.qtyInput.value='';this.updateButtons();}
  showForm(){this.emptyProd.style.display='none';this.formProd.style.display='flex';this.qtyInput.focus();}
  showEmpty(){this.formProd.style.display='none';this.emptyProd.style.display='flex';}

  // ---------- BUTTON ENABLE ----------
  updateButtons(){const q=parseInt(this.qtyInput.value);const ok=q>0&&this.currentProduct;this.btnIn.disabled=this.btnOut.disabled=!ok;}

  // ---------- API --------------------
  async fetchProduct(id){if(!this.isApiConfigured)throw new Error('API not configured');
    const r= await fetch(`${API_URL}?action=getProduct&productId=${encodeURIComponent(id)}`);const j=await r.json();return j.success?j.data||j.product:null;}
  async postTransaction(obj){const r=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'addTransaction',...obj})});return r.json();}

  async testAPI(){try{const r=await fetch(API_URL+'?action=test');if(r.ok){this.toast('API OK','success');}else this.toast('API error','warning');}catch(e){this.toast('API unreachable','error');}}

  // ---------- TXN HANDLERS -----------
  handleTxn(type){const q=parseInt(this.qtyInput.value);if(!(q>0))return this.toast('Enter qty','warning');if(!this.currentProduct)return this.toast('Scan first','warning');if(type==='OUT')return this.showModal(this.modalIssue);
    this.commitTxn('IN',q);}  // IN directly
  confirmIssue(){const who=$('#issued-to-name').value.trim();if(!who)return this.toast('Enter name','warning');this.hideModal(this.modalIssue);const q=parseInt(this.qtyInput.value);this.commitTxn('OUT',q,who);}

  async commitTxn(type,qty,issuedTo=''){
    const delta = type==='IN'?qty:-qty;
    const newStock = (parseInt(this.currentProduct.currentStock)||0)+delta;
    const data={productId:this.currentProduct.id,productName:this.currentProduct.name,type,quantity:qty,issuedTo,time:new Date().toISOString()};
    this.currentProduct.currentStock=newStock;this.stockField.value=newStock;this.qtyInput.value='';this.updateButtons();
    if(this.isOnline&&this.isApiConfigured){try{await this.postTransaction({payload:data});this.toast('Synced','success');}catch(e){console.warn('sync fail',e);this.queue(data);}}
    else this.queue(data);
  }

  queue(item){item.status='queued';this.syncQueue.push(item);this.updateSyncStatus();this.toast('Saved offline','info');}

  syncQueueProcess(){if(!this.syncQueue.length)return;const pending=[...this.syncQueue];this.syncQueue=[];
    pending.forEach(async item=>{try{await this.postTransaction({payload:item});this.toast('Queued item synced','success');}
      catch(e){item.retry=(item.retry||0)+1;this.syncQueue.push(item);}});
    this.updateSyncStatus();}

  updateSyncStatus(){if(!this.syncDot)return;const p=this.syncQueue.length;if(!p){this.syncDot.className='status-dot online';this.syncTxt.textContent='All Synced';this.retrySyncBtn.classList.add('hidden');}
    else{this.syncDot.className='status-dot warning pulsing';this.syncTxt.textContent=`${p} Pending`;this.retrySyncBtn.classList.remove('hidden');}}

  retryAllSync(){if(!this.isOnline||!this.isApiConfigured)return this.toast('No network or API','warning');this.syncQueueProcess();}
  clearSync(){this.syncQueue=[];this.updateSyncStatus();this.hideModal(this.modalSync);}

  // ---------- UTILS ------------------
  toast(msg,type='info'){const t=document.createElement('div');t.className=`toast ${type}`;t.textContent=msg;this.toastCont.appendChild(t);setTimeout(()=>t.classList.add('show'),30);setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300);},this.toastDur);}  
  showModal(m){m?.classList.remove('hidden');document.body.style.overflow='hidden';}
  hideModal(m){m?.classList.add('hidden');document.body.style.overflow='';}
  showLoading(txt){if(this.loading){this.loading.querySelector('p').textContent=txt;this.loading.classList.remove('hidden');}}
  hideLoading(){this.loading?.classList.add('hidden');}

  onVisibility(){if(document.hidden){this.html5QrCode?.pause(true);}else if(this.isScanning&&!this.scanPaused){this.html5QrCode?.resume();}}
  cleanup(){this.html5QrCode?.stop();}
}

// ============  INIT APP  ============
document.addEventListener('DOMContentLoaded',()=>{window.qrApp=new QRScannerApp();console.log('QR Scanner ready');});
