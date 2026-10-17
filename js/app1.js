const STORAGE_KEYS = {
  cart: 'arabica_cart', session: 'arabica_session', customer: 'arabica_customer',
  orders: 'arabica_orders', tableNumber: 'arabica_table_number', orderMode: 'arabica_order_mode',
  adminSession: 'arabica_admin_session', uiPrefs: 'arabica_ui_prefs'
};
const ORDER_STATUSES = ['New', 'Confirmed', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered', 'Completed', 'Cancelled'];
const db = firebase.firestore();
const auth = firebase.auth();
const storage = firebase.storage();
const functions = firebase.functions();

function readStorage(key, fallback) {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
  catch (error) { return fallback; }
}
function writeStorage(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
    .format(Number(value || 0) * 100);
}
function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function generateOrderId() {
  return `AR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}
function emitDataUpdated() { document.dispatchEvent(new CustomEvent('app:data-updated')); }

let productsCache = [];
let ordersCache = [];
let customerProfiles = [];
let currentProfile = null;
let adminAuthorized = false;
let websiteContent = {};
let tablesCache = [];
let privateUnsubscribers = [];
let firstProductsLoaded;
const productsLoaded = new Promise((resolve) => { firstProductsLoaded = resolve; });
let firstAuthLoaded;
const authLoaded = new Promise((resolve) => { firstAuthLoaded = resolve; });

// Remove the prior demo's plaintext passwords and fake admin/customer sessions.
try {
  ['arabica_customer', 'arabica_session', 'arabica_admin_session', 'arabica_orders'].forEach((key) => localStorage.removeItem(key));
  const activeOrder = readStorage('arabica_active_order', null);
  if (activeOrder && String(activeOrder.id || '').startsWith('AR-') && !localStorage.getItem('arabica_tracking_token')) localStorage.removeItem('arabica_active_order');
  const confirmation = readStorage('arabica_last_confirmation', null);
  if (confirmation && String(confirmation.id || '').startsWith('AR-')) localStorage.removeItem('arabica_last_confirmation');
} catch (error) { console.warn('Legacy local data cleanup was unavailable:', error); }

const menuService = {
  getAllProducts() { return productsCache; },
  getProductById(id) { return productsCache.find((product) => product.id === id) || null; },
  getCategoryList() { return ['All', ...new Set(productsCache.map((product) => product.category).filter(Boolean))]; },
  async saveProducts(products) {
    if (!adminAuthorized) throw new Error('Admin access required.');
    const batch = db.batch();
    const existing = await db.collection('products').get();
    const keep = new Set(products.map((product) => String(product.id)));
    existing.docs.forEach((doc) => { if (!keep.has(doc.id)) batch.delete(doc.ref); });
    products.forEach((product) => {
      const { id, ...data } = product;
      batch.set(db.collection('products').doc(String(id)), { ...data, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    });
    await batch.commit();
  },
  async saveProduct(id, data) {
    if (!adminAuthorized) throw new Error('Admin access required.');
    const ref = id ? db.collection('products').doc(String(id)) : db.collection('products').doc();
    await ref.set({ ...data, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return { id: ref.id, ...data };
  },
  async deleteProduct(id) {
    if (!adminAuthorized) throw new Error('Admin access required.');
    await db.collection('products').doc(String(id)).delete();
  }
};

const cartService = {
  getCart() { return readStorage(STORAGE_KEYS.cart, []); },
  addToCart(product, qty = 1, options = {}) {
    const cart = this.getCart();
    const key = (item) => item.id === product.id && item.selectedSize === (options.size || 'Regular') && item.selectedTemp === (options.temp || 'Hot');
    const match = cart.find(key);
    if (match) match.quantity = Math.min(99, match.quantity + Number(qty || 1));
    else cart.push({ id: product.id, quantity: Math.min(99, Math.max(1, Number(qty) || 1)), selectedSize: options.size || 'Regular', selectedTemp: options.temp || 'Hot', note: options.note || '', addedAt: Date.now() });
    writeStorage(STORAGE_KEYS.cart, cart); this.updateCount(); return cart;
  },
  removeItem(productId, size, temp) {
    const cart = this.getCart().filter((item) => !(item.id === productId && item.selectedSize === (size || 'Regular') && item.selectedTemp === (temp || 'Hot')));
    writeStorage(STORAGE_KEYS.cart, cart); this.updateCount(); return cart;
  },
  updateQuantity(productId, size, temp, delta) {
    const cart = this.getCart(); const item = cart.find((entry) => entry.id === productId && entry.selectedSize === (size || 'Regular') && entry.selectedTemp === (temp || 'Hot'));
    if (!item) return cart;
    item.quantity = Math.min(99, item.quantity + delta);
    if (item.quantity <= 0) return this.removeItem(productId, size, temp);
    writeStorage(STORAGE_KEYS.cart, cart); this.updateCount(); return cart;
  },
  clearCart() { writeStorage(STORAGE_KEYS.cart, []); this.updateCount(); return []; },
  getItemCount() { return this.getCart().reduce((sum, item) => sum + Number(item.quantity || 0), 0); },
  getSubtotal() { return this.getCart().reduce((sum, item) => { const product = menuService.getProductById(item.id); return sum + (product ? Number(product.price) * item.quantity : 0); }, 0); },
  getGrandTotal() { const subtotal = this.getSubtotal(); return subtotal + (this.getCart().length && localStorage.getItem(STORAGE_KEYS.orderMode) !== 'dine-in' ? 2.5 : 0) - (subtotal > 20 ? 4 : 0); },
  updateCount() {
    const count = this.getItemCount();
    document.querySelectorAll('.cart-badge').forEach((badge) => { badge.textContent = count; badge.hidden = count === 0; });
  }
};

const authService = {
  getCurrentUser() { return currentProfile; },
  getFirebaseUser() { return auth.currentUser; },
  isAdmin() { return adminAuthorized; },
  async register(payload) {
    const email = payload.email.trim().toLowerCase();
    const currentAuth = auth.currentUser;
    const credential = currentAuth?.isAnonymous
      ? await currentAuth.linkWithCredential(firebase.auth.EmailAuthProvider.credential(email, payload.password))
      : await auth.createUserWithEmailAndPassword(email, payload.password);
    const profile = { uid: credential.user.uid, fullName: payload.fullName.trim(), mobile: payload.mobile.trim(), email: credential.user.email, savedAddresses: [], createdAt: new Date().toISOString() };
    await db.collection('users').doc(credential.user.uid).set(profile);
    currentProfile = profile;
    return profile;
  },
  async login(email, password) {
    if (!String(email).includes('@')) throw new Error('Sign in with your email address. Phone-number sign-in requires Firebase Phone Authentication setup.');
    const credential = await auth.signInWithEmailAndPassword(email.trim().toLowerCase(), password);
    await credential.user.getIdToken(true);
    const profile = await db.collection('users').doc(credential.user.uid).get();
    currentProfile = profile.exists ? { uid: credential.user.uid, ...profile.data() } : { uid: credential.user.uid, email: credential.user.email };
    return currentProfile;
  },
  async adminLogin(email, password) {
    const credential = await auth.signInWithEmailAndPassword(email.trim().toLowerCase(), password);
    const token = await credential.user.getIdTokenResult(true);
    if (token.claims.admin !== true) { await auth.signOut(); throw new Error('This account has not been authorized as an admin.'); }
    adminAuthorized = true;
    return true;
  },
  async logout() { await auth.signOut(); localStorage.removeItem(STORAGE_KEYS.session); },
  async logoutAdmin() { await auth.signOut(); localStorage.removeItem(STORAGE_KEYS.adminSession); },
  getAdminSession() { return adminAuthorized ? { uid: auth.currentUser?.uid } : null; }
};

const customerService = {
  getSavedAddresses() { return currentProfile?.savedAddresses || []; },
  async saveAddress(address) {
    if (!auth.currentUser || auth.currentUser.isAnonymous) throw new Error('Sign in to save an address.');
    const updated = { ...currentProfile, savedAddresses: [{ ...address, id: address.id || String(Date.now()), isDefault: true }] };
    await db.collection('users').doc(auth.currentUser.uid).set({ savedAddresses: updated.savedAddresses }, { merge: true });
    currentProfile = updated; return updated;
  },
  async deleteAddress() {
    if (!auth.currentUser || auth.currentUser.isAnonymous) throw new Error('Sign in to manage saved addresses.');
    await db.collection('users').doc(auth.currentUser.uid).set({ savedAddresses: [] }, { merge: true });
    currentProfile = { ...currentProfile, savedAddresses: [] };
    return currentProfile;
  },
  getLastOrder() { return ordersCache[0] || null; }
};

const orderService = {
  getOrders() { return ordersCache; },
  saveOrders() { throw new Error('Orders can only be changed through the trusted backend.'); },
  async createOrder(orderData, idempotencyKey) {
    if (!auth.currentUser) await auth.signInAnonymously();
    const result = await functions.httpsCallable('createOrder')({ ...orderData, idempotencyKey });
    const created = result.data.order;
    if (result.data.trackingToken) localStorage.setItem('arabica_tracking_token', result.data.trackingToken);
    localStorage.setItem('arabica_active_order', JSON.stringify(created));
    return created;
  },
  getActiveOrder() {
    const saved = readStorage('arabica_active_order', null);
    return (saved && ordersCache.find((order) => order.id === saved.id)) || ordersCache[0] || saved || null;
  },
  async updateOrderStatus(orderId, newStatus) {
    if (!adminAuthorized) throw new Error('Admin access required.');
    const result = await functions.httpsCallable('updateOrderStatus')({ orderId, status: newStatus });
    return result.data.order;
  }
};

const adminService = {
  getOverview() {
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayOrders = ordersCache.filter((order) => String(order.createdAt || '').slice(0, 10) === todayKey);
    return { totalOrders: todayOrders.length, revenue: todayOrders.reduce((sum, order) => sum + Number(order.total || 0), 0), pending: ordersCache.filter((order) => ['New', 'Confirmed', 'Preparing', 'Ready', 'Out for Delivery'].includes(order.status)).length, completed: ordersCache.filter((order) => order.status === 'Completed').length, customers: customerProfiles.length };
  },
  getCustomers() { return customerProfiles; }
};
const tableService = {
  getTables() { return tablesCache; },
  async saveTable(id, values) {
    if (!adminAuthorized) throw new Error('Admin access required.');
    const ref = id ? db.collection('tables').doc(String(id)) : db.collection('tables').doc();
    await ref.set({ ...values, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  },
  async deleteTable(id) {
    if (!adminAuthorized) throw new Error('Admin access required.');
    await db.collection('tables').doc(String(id)).delete();
  }
};

async function uploadAdminImage(file, folder) {
  if (!adminAuthorized || !auth.currentUser) throw new Error('Admin access required.');
  if (!file || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG, WEBP, or GIF image under 5 MB.');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${folder}/${auth.currentUser.uid}/${Date.now()}-${safeName}`;
  const ref = storage.ref(path);
  await ref.put(file, { contentType: file.type });
  return { url: await ref.getDownloadURL(), path };
}
async function deleteAdminImage(path) {
  if (!adminAuthorized || !path || !/^(products|banners)\/[a-zA-Z0-9_-]+\//.test(path)) return;
  await storage.ref(path).delete().catch((error) => { if (error.code !== 'storage/object-not-found') throw error; });
}
async function saveWebsiteContent(content) {
  if (!adminAuthorized) throw new Error('Admin access required.');
  await db.collection('websiteContent').doc('home').set({ ...content, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
}
function applyWebsiteContent() {
  const homeTitle = document.querySelector('[data-home-title]');
  const homeSubtitle = document.querySelector('[data-home-subtitle]');
  const homeKicker = document.querySelector('[data-home-kicker]');
  const heroBg = document.querySelector('.hero-bg');
  if (homeTitle && websiteContent.heroTitle) homeTitle.textContent = websiteContent.heroTitle;
  if (homeSubtitle && websiteContent.heroSubtitle) homeSubtitle.textContent = websiteContent.heroSubtitle;
  if (homeKicker && websiteContent.heroKicker) homeKicker.textContent = websiteContent.heroKicker;
  if (heroBg && websiteContent.heroImageUrl) heroBg.style.backgroundImage = `url("${String(websiteContent.heroImageUrl).replace(/["\\]/g, '')}")`;
  const featured = document.querySelector('[data-home-featured]');
  if (featured) {
    featured.innerHTML = [...productsCache].filter((product) => product.featured && product.available !== false).slice(0, 3).map((product) => `
      <a class="product-card product-card-link" href="./product.html?id=${encodeURIComponent(product.id)}">
        <div class="image-wrap"><img src="${escapeHTML(product.image || '')}" alt="${escapeHTML(product.name || '')}" loading="lazy"><span class="product-badge">${escapeHTML(product.badge || product.category || '')}</span></div>
        <div class="meta"><span class="kicker">${escapeHTML(product.category || '')}</span><span class="price">${formatCurrency(product.price)}</span></div>
        <h4>${escapeHTML(product.name || '')}</h4><p class="description">${escapeHTML(product.description || '')}</p>
      </a>`).join('');
  }
}

function showToast(message, type = 'success') {
  const container = document.querySelector('.toast-container') || (() => { const wrap = document.createElement('div'); wrap.className = 'toast-container'; document.body.appendChild(wrap); return wrap; })();
  const toast = document.createElement('div'); toast.className = `toast ${type}`; toast.textContent = message; container.appendChild(toast); setTimeout(() => toast.remove(), 3000);
}
function setActiveHeaderLink() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach((link) => { const slug = link.getAttribute('href')?.split('/').pop() || 'index.html'; if (slug === path) link.classList.add('active'); });
}
function initMobileNav() {
  const toggle = document.querySelector('.mobile-toggle'); const panel = document.querySelector('.mobile-panel');
  if (!toggle || !panel) return;
  toggle.addEventListener('click', () => panel.classList.toggle('open'));
  panel.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => panel.classList.remove('open')));
}
function initRevealAnimations() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { document.querySelectorAll('.reveal').forEach((item) => item.classList.add('visible')); return; }
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } }), { threshold: 0.18 });
  document.querySelectorAll('.reveal').forEach((item) => observer.observe(item));
}
function hydrateSession() {
  const user = authService.getCurrentUser(); const accountButton = document.querySelector('[data-account-link]'); const loginButton = document.querySelector('[data-login-link]');
  if (accountButton) { accountButton.textContent = user ? (user.fullName || 'Account') : 'Account'; accountButton.href = user ? './account.html' : './login.html'; }
  if (loginButton) loginButton.href = user ? './account.html' : './login.html';
}
function bindGlobalActions() {
  document.addEventListener('click', (event) => {
    const searchButton = event.target.closest('[aria-label="Search"]');
    if (searchButton) { const input = document.getElementById('menu-search'); if (input) { input.focus(); input.scrollIntoView({ behavior: 'smooth', block: 'center' }); } else window.location.href = './menu.html?focusSearch=1'; return; }
    const addButton = event.target.closest('[data-add-to-cart]');
    if (addButton) {
      const product = menuService.getProductById(addButton.dataset.addToCart);
      if (product?.available !== false) {
        const detail = addButton.closest('.product-order-actions');
        const optionGroups = detail?.closest('.product-detail-content')?.querySelectorAll('.option-row') || [];
        const size = optionGroups[0]?.querySelector('.option-btn.active')?.textContent.trim() || 'Regular';
        const temp = optionGroups[1]?.querySelector('.option-btn.active')?.textContent.trim() || 'Hot';
        const quantity = Number(detail?.querySelector('#quantity-value')?.textContent || 1);
        cartService.addToCart(product, quantity, { size, temp }); showToast(`${product.name} added to cart.`);
      }
      return;
    }
    const buyButton = event.target.closest('[data-buy-now]');
    if (buyButton) {
      const product = menuService.getProductById(buyButton.dataset.buyNow);
      if (product?.available !== false) {
        const detail = buyButton.closest('.product-order-actions'); const groups = detail?.closest('.product-detail-content')?.querySelectorAll('.option-row') || [];
        cartService.clearCart(); cartService.addToCart(product, Number(detail?.querySelector('#quantity-value')?.textContent || 1), { size: groups[0]?.querySelector('.option-btn.active')?.textContent.trim() || 'Regular', temp: groups[1]?.querySelector('.option-btn.active')?.textContent.trim() || 'Hot' });
        window.location.href = './checkout.html';
      }
      return;
    }
    const logout = event.target.closest('[data-logout]');
    if (logout) { authService.logout().then(() => { localStorage.removeItem('arabica_active_order'); window.location.href = './index.html'; }); return; }
    const adminLogout = event.target.closest('[data-admin-logout]');
    if (adminLogout) { event.preventDefault(); authService.logoutAdmin().then(() => { window.location.href = './login.html'; }); }
  });
}

function subscribeData() {
  db.collection('products').onSnapshot((snapshot) => {
    productsCache = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })); firstProductsLoaded(); applyWebsiteContent(); emitDataUpdated();
  }, (error) => { console.error('Products read failed:', error); firstProductsLoaded(); showToast('Unable to load the menu from Firebase.', 'error'); });
  db.collection('websiteContent').doc('home').onSnapshot((snapshot) => { websiteContent = snapshot.exists ? snapshot.data() : {}; applyWebsiteContent(); emitDataUpdated(); }, (error) => console.error('Website content read failed:', error));
  db.collection('tables').onSnapshot((snapshot) => { tablesCache = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })); emitDataUpdated(); }, (error) => console.error('Table read failed:', error));
}
function attachPrivateListeners(user, isAdmin) {
  privateUnsubscribers.forEach((unsubscribe) => unsubscribe()); privateUnsubscribers = [];
  ordersCache = []; customerProfiles = [];
  const ordersQuery = isAdmin ? db.collection('orders') : db.collection('orders').where('customerUid', '==', user.uid);
  privateUnsubscribers.push(ordersQuery.onSnapshot((snapshot) => {
    ordersCache = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    emitDataUpdated();
  }, (error) => { console.error('Orders read failed:', error); }));
  if (isAdmin) privateUnsubscribers.push(db.collection('users').onSnapshot((snapshot) => { customerProfiles = snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() })); emitDataUpdated(); }, (error) => console.error('Customer list failed:', error)));
}

const appReady = Promise.all([
  Promise.race([productsLoaded, new Promise((resolve) => setTimeout(resolve, 4000))]),
  authLoaded
]);
subscribeData();
auth.onAuthStateChanged(async (user) => {
  adminAuthorized = false; currentProfile = null;
  if (user) {
    try {
      const token = await user.getIdTokenResult(); adminAuthorized = token.claims.admin === true;
      if (!user.isAnonymous) {
        const profile = await db.collection('users').doc(user.uid).get();
        currentProfile = profile.exists ? { uid: user.uid, ...profile.data() } : { uid: user.uid, email: user.email, fullName: user.displayName || '' };
      }
      attachPrivateListeners(user, adminAuthorized);
      if (!user.isAnonymous) privateUnsubscribers.push(db.collection('users').doc(user.uid).onSnapshot((snapshot) => {
        if (snapshot.exists) { currentProfile = { uid: user.uid, ...snapshot.data() }; emitDataUpdated(); }
      }, (error) => console.error('Profile listener failed:', error)));
    } catch (error) { console.error('Account initialization failed:', error); }
  } else { privateUnsubscribers.forEach((unsubscribe) => unsubscribe()); privateUnsubscribers = []; ordersCache = []; customerProfiles = []; tablesCache = []; }
  hydrateSession(); firstAuthLoaded(); emitDataUpdated();
});

document.addEventListener('DOMContentLoaded', async () => {
  try { await appReady; } catch (error) { console.error(error); }
  setActiveHeaderLink(); initMobileNav(); initRevealAnimations(); bindGlobalActions(); hydrateSession(); cartService.updateCount();
});
