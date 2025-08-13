// app.js - frontend
const API_URL = "https://script.google.com/macros/s/AKfycbyGL_DhQatROcTaj6NuYSOwgroj3Kgn4unK4x_9LPr9UeWHMShdg_9vP_z7YOPjlnjv/exec"; // <<< REPLACE with Apps Script Web App URL

// Locks to avoid duplicate submissions
let scanLock = false;
let submitLock = false;

const $ = (s) => document.querySelector(s);

let html5QrCode;
const qrRegionId = "qr-reader";

window.addEventListener('DOMContentLoaded', () => {
  $('#openDashboard').href = API_URL + '?action=dashboard';
  $('#start-camera-btn').addEventListener('click', startCamera);

  $('#productForm').addEventListener('submit', (e) => {
    e.preventDefault();
    handleFormSubmit();
  });
});

// Start camera and scanning
async function startCamera() {
  if (html5QrCode) return;
  html5QrCode = new Html5Qrcode(qrRegionId);

  const config = { fps: 8, qrbox: { width: 280, height: 280 }, aspectRatio: 1.0 };

  try {
    await html5QrCode.start(
      { facingMode: "environment" },
      config,
      qrCodeMessage => onQrDetected(qrCodeMessage),
      error => { /* ignore minor errors */ }
    );
    $('#start-camera-btn').disabled = true;
  } catch (err) {
    console.error("Camera start error:", err);
    alert("Unable to start camera. Check permissions or try again.");
  }
}

async function onQrDetected(code) {
  if (scanLock) return;
  scanLock = true;

  try {
    const res = await fetch(`${API_URL}?action=getProduct&productId=${encodeURIComponent(code)}`);
    const data = await res.json();
    if (data.success && data.data) {
      $('#productId').value = data.data.Product_ID || data.data.id || code;
      $('#productName').value = data.data.Product_Name || data.data.name || "";
      $('#currentStock').value = data.data.Current_Stock != null ? data.data.Current_Stock : (data.data.currentStock || 0);
    } else {
      alert("Product not found");
    }
  } catch (err) {
    console.error("Fetch product failed", err);
    alert("Error fetching product");
  } finally {
    setTimeout(() => scanLock = false, 1200); // small cooldown
  }
}

async function handleFormSubmit() {
  if (submitLock) return;
  submitLock = true;

  const productId = $('#productId').value.trim();
  const productName = $('#productName').value.trim();
  const qty = parseInt($('#quantity').value, 10) || 0;
  const type = $('#type').value;
  const issuedTo = $('#issuedTo').value.trim();
  const oldStock = parseInt($('#currentStock').value, 10) || 0;
  const newStock = type === 'IN' ? oldStock + qty : oldStock - qty;

  if (!productId) { alert('Scan a product first'); submitLock = false; return; }
  if (qty <= 0) { alert('Enter a valid quantity'); submitLock = false; return; }
  if (type === 'OUT' && qty > oldStock) { alert('Insufficient stock'); submitLock = false; return; }

  const tx = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    productId,
    productName,
    type,
    quantity: qty,
    oldStock,
    newStock,
    issuedTo: issuedTo || "",
    user: 'QR Scanner User'
  };

  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'addTransaction', payload: tx })
    });
    const j = await resp.json();
    if (j.success) {
      alert('Transaction recorded');
      // update UI
      $('#currentStock').value = newStock;
      $('#quantity').value = '';
      $('#issuedTo').value = '';
    } else {
      alert('Failed to save transaction: ' + (j.message || 'unknown'));
    }
  } catch (err) {
    console.error('Submit failed', err);
    alert('Error saving transaction');
  } finally {
    setTimeout(() => submitLock = false, 800);
  }
}
