const STORAGE_KEYS = {
  cart: 'arabica_cart', session: 'arabica_session', customer: 'arabica_customer',
  orders: 'arabica_orders', tableNumber: 'arabica_table_number', orderMode: 'arabica_order_mode',
  adminSession: 'arabica_admin_session', uiPrefs: 'arabica_ui_prefs', cartOwner: 'arabica_cart_owner'
};
const ORDER_STATUSES = ['New', 'Confirmed', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered', 'Completed', 'Cancelled'];
const ORDER_TRANSITIONS = {
  New: ['Confirmed', 'Cancelled'], Confirmed: ['Preparing', 'Cancelled'],
  Preparing: ['Ready', 'Cancelled'], Ready: ['Out for Delivery', 'Delivered', 'Completed'],
  'Out for Delivery': ['Delivered'], Delivered: ['Completed'], Completed: [], Cancelled: []
};
// Shop pricing rules (all amounts in INR). Change them here only.
const SHOP_CONFIG = { deliveryFee: 40, discountThreshold: 500, discountAmount: 0 };
const ADMIN_UID = 'MHx9d4SOLhci8zY7T18iXlhVoi93';
function calcTotals(subtotal, isDelivery) {
  const deliveryFee = subtotal > 0 && isDelivery ? SHOP_CONFIG.deliveryFee : 0;
  const discount = SHOP_CONFIG.discountAmount > 0 && subtotal > SHOP_CONFIG.discountThreshold ? SHOP_CONFIG.discountAmount : 0;
  const total = Math.max(0, Math.round((subtotal + deliveryFee - discount) * 100) / 100);
  return { subtotal, deliveryFee, discount, total };
}
const db = firebase.firestore();
const auth = firebase.auth();
const authPersistenceReady = auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
const storage = firebase.storage ? firebase.storage() : null;
const functions = firebase.functions();

function authErrorMessage(error, fallback) {
  const map = {
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/user-not-found': 'No account found with this email. Please register first.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
    'auth/network-request-failed': 'Network error. Check your internet connection and try again.',
    'auth/operation-not-allowed': 'Email/Password sign-in is not enabled in Firebase Authentication.',
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/weak-password': 'Password must contain at least 6 characters.',
    'auth/invalid-api-key': 'Firebase configuration is invalid. Check js/firebase-config.js.',
    'auth/configuration-not-found': 'Firebase Authentication is not configured for this project. Enable Email/Password in Firebase Console and run this site on localhost or HTTPS.',
    'auth/quota-exceeded': 'Firebase sign-up limit reached. Try again later or check the Firebase plan.',
    'auth/unauthorized-domain': 'This domain is not authorized in Firebase Authentication > Settings > Authorized domains.',
    'auth/admin-restricted-operation': 'Anonymous/Email sign-in is not enabled in Firebase Authentication.',
    'permission-denied': 'Permission denied. Please sign in again, or publish the latest Firestore rules.'
  };
  if (map[error?.code]) return map[error.code];
  if (error?.code) return `Request failed (${error.code}). Check Firebase setup and try again.`;
  return error?.message || fallback || 'Something went wrong.';
}

async function checkIsAdmin(user) {
  if (!user || user.isAnonymous) return false;
  if (user.uid === ADMIN_UID) return true;
  try { return (await db.collection('admins').doc(user.uid).get()).exists; }
  catch (error) { return false; }
}

function phoneLoginEmail(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) throw new Error('Enter a valid mobile number with 7 to 15 digits.');
  return `${digits}@phone.arabicacoffee.invalid`;
}

function readStorage(key, fallback) {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
  catch (error) { return fallback; }
}
function writeStorage(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
    .format(Number(value || 0));
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
let firstAuthInitialized;
const authInitialized = new Promise((resolve) => { firstAuthInitialized = resolve; });
let cartRevision = 0;

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
  getProductById(id) {
    return productsCache.find((product) => product.id === id)
      || (productsCache.length ? null : (window.STARTER_PRODUCTS || []).find((product) => product.id === id) || null);
  },
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
  getProductForCart(item) {
    const liveProduct = menuService.getAllProducts().find((product) => product.id === item.id);
    if (liveProduct) return liveProduct;
    const starterProduct = (window.STARTER_PRODUCTS || []).find((product) => product.id === item.id);
    const snapshot = item.productSnapshot || {};
    if (starterProduct || snapshot.name || snapshot.image) {
      return { ...(starterProduct || {}), ...snapshot, id: item.id };
    }
    return { id: item.id, name: item.name || 'Menu item', image: item.image || '', price: Number(item.price) || 0, available: false };
  },
  persist(cart) {
    cartRevision += 1;
    writeStorage(STORAGE_KEYS.cart, cart);
    this.updateCount();
    this.syncToFirebase(cart).catch((error) => console.warn('Cart could not be synced to Firebase:', error));
  },
  async syncToFirebase(cart = this.getCart()) {
    let user = auth.currentUser;
    if (!user) user = (await auth.signInAnonymously()).user;
    await db.collection('carts').doc(user.uid).set({ items: cart, updatedAt: new Date().toISOString() });
    localStorage.setItem(STORAGE_KEYS.cartOwner, user.uid);
  },
  async loadFromFirebase(user) {
    if (!user) return;
    const revision = cartRevision;
    const owner = localStorage.getItem(STORAGE_KEYS.cartOwner);
    const localCart = this.getCart();
    const snapshot = await db.collection('carts').doc(user.uid).get();
    const remoteCart = snapshot.exists ? snapshot.data().items || [] : [];
    if (revision !== cartRevision) {
      await this.syncToFirebase(this.getCart());
      return;
    }
    if (owner && owner !== user.uid) writeStorage(STORAGE_KEYS.cart, []);
    else if (localCart.length && !remoteCart.length) {
      await db.collection('carts').doc(user.uid).set({ items: localCart, updatedAt: new Date().toISOString() });
    }
    else if (snapshot.exists) writeStorage(STORAGE_KEYS.cart, remoteCart);
    else if (localCart.length) await db.collection('carts').doc(user.uid).set({ items: localCart, updatedAt: new Date().toISOString() });
    localStorage.setItem(STORAGE_KEYS.cartOwner, user.uid);
    this.updateCount();
    emitDataUpdated();
  },
  addToCart(product, qty = 1, options = {}) {
    const cart = this.getCart();
    const key = (item) => item.id === product.id && item.selectedSize === (options.size || 'Regular') && item.selectedTemp === (options.temp || 'Hot');
    const match = cart.find(key);
    const productSnapshot = { name: product.name, image: product.image, price: Number(product.price) || 0 };
    if (match) { match.quantity = Math.min(99, match.quantity + Number(qty || 1)); match.productSnapshot = productSnapshot; }
    else cart.push({ id: product.id, quantity: Math.min(99, Math.max(1, Number(qty) || 1)), selectedSize: options.size || 'Regular', selectedTemp: options.temp || 'Hot', note: options.note || '', productSnapshot, addedAt: Date.now() });
    this.persist(cart); return cart;
  },
  removeItem(productId, size, temp) {
    const cart = this.getCart().filter((item) => !(item.id === productId && item.selectedSize === (size || 'Regular') && item.selectedTemp === (temp || 'Hot')));
    this.persist(cart); return cart;
  },
  updateQuantity(productId, size, temp, delta) {
    const cart = this.getCart(); const item = cart.find((entry) => entry.id === productId && entry.selectedSize === (size || 'Regular') && entry.selectedTemp === (temp || 'Hot'));
    if (!item) return cart;
    item.quantity = Math.min(99, item.quantity + delta);
    if (item.quantity <= 0) return this.removeItem(productId, size, temp);
    this.persist(cart); return cart;
  },
  clearCart() { this.persist([]); return []; },
  getItemCount() { return this.getCart().reduce((sum, item) => sum + Number(item.quantity || 0), 0); },
  getSubtotal() { return this.getCart().reduce((sum, item) => { const product = this.getProductForCart(item); return sum + Number(product.price || 0) * item.quantity; }, 0); },
  getGrandTotal() { return calcTotals(this.getSubtotal(), localStorage.getItem(STORAGE_KEYS.orderMode) !== 'dine-in').total; },
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
    await authPersistenceReady;
    const email = phoneLoginEmail(payload.mobile);
    const currentAuth = auth.currentUser;
    const credential = currentAuth?.isAnonymous
      ? await currentAuth.linkWithCredential(firebase.auth.EmailAuthProvider.credential(email, payload.password))
      : await auth.createUserWithEmailAndPassword(email, payload.password);
    await credential.user.getIdToken(true);
    const profile = { uid: credential.user.uid, fullName: payload.fullName.trim(), mobile: payload.mobile.trim(), email: '', savedAddresses: [], createdAt: new Date().toISOString() };
    await db.collection('users').doc(credential.user.uid).set(profile);
    currentProfile = profile;
    return profile;
  },
  async login(identifier, password) {
    await authPersistenceReady;
    const value = String(identifier || '').trim();
    const email = value.includes('@') ? value.toLowerCase() : phoneLoginEmail(value);
    const credential = await auth.signInWithEmailAndPassword(email, password);
    let data = null;
    try {
      const profile = await db.collection('users').doc(credential.user.uid).get();
      if (profile.exists) data = profile.data();
    } catch (error) { console.warn('Profile could not be read after login:', error); }
    currentProfile = { uid: credential.user.uid, email: credential.user.email, ...(data || {}) };
    return currentProfile;
  },
  async adminLogin(email, password) {
    await authPersistenceReady;
    const credential = await auth.signInWithEmailAndPassword(email.trim().toLowerCase(), password);
    if (!(await checkIsAdmin(credential.user))) { await auth.signOut(); throw new Error('This account is not an authorized admin.'); }
    adminAuthorized = true;
    return true;
  },
  async logout() { await auth.signOut(); localStorage.removeItem(STORAGE_KEYS.session); },
  async logoutAdmin() { await auth.signOut(); localStorage.removeItem(STORAGE_KEYS.adminSession); },
  getAdminSession() { return adminAuthorized ? { uid: auth.currentUser?.uid } : null; }
};

const customerService = {
  getSavedAddresses() { return currentProfile?.savedAddresses || []; },
  async writeProfile(values) {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) throw new Error('Sign in to update your profile.');
    const ref = db.collection('users').doc(user.uid);
    const snapshot = await ref.get();
    const initialProfile = snapshot.exists ? {} : {
      uid: user.uid,
      email: user.email || '',
      fullName: currentProfile?.fullName || user.displayName || '',
      mobile: currentProfile?.mobile || '',
      savedAddresses: currentProfile?.savedAddresses || [],
      createdAt: new Date().toISOString()
    };
    await ref.set({ ...initialProfile, ...values }, { merge: true });
  },
  async updateProfile(values) {
    if (!auth.currentUser || auth.currentUser.isAnonymous) throw new Error('Sign in to update your profile.');
    const fullName = String(values.fullName || '').trim();
    const mobile = String(values.mobile ?? currentProfile?.mobile ?? '').trim();
    if (!fullName) throw new Error('Enter your name.');
    await auth.currentUser.updateProfile({ displayName: fullName });
    await this.writeProfile({ fullName, mobile });
    currentProfile = { ...currentProfile, fullName, mobile };
    emitDataUpdated();
    return currentProfile;
  },
  async saveAddress(address) {
    if (!auth.currentUser || auth.currentUser.isAnonymous) throw new Error('Sign in to save an address.');
    const fullName = String(address.fullName || currentProfile?.fullName || '').trim();
    const mobile = String(address.mobile || currentProfile?.mobile || '').trim();
    const savedAddresses = [{ ...address, fullName, mobile, id: address.id || String(Date.now()), isDefault: true }];
    await auth.currentUser.updateProfile({ displayName: fullName });
    await this.writeProfile({ fullName, mobile, savedAddresses });
    const updated = { ...currentProfile, fullName, mobile, savedAddresses };
    currentProfile = updated; return updated;
  },
  async deleteAddress() {
    if (!auth.currentUser || auth.currentUser.isAnonymous) throw new Error('Sign in to manage saved addresses.');
    await this.writeProfile({ savedAddresses: [] });
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
    const user = auth.currentUser;
    const clean = (value, max = 300) => String(value || '').trim().slice(0, max);
    const orderType = orderData.orderType;
    if (!['Dine-In', 'Home Delivery'].includes(orderType)) throw new Error('Invalid order type.');
    const customerName = clean(orderData.customerName, 100);
    const tableNumber = clean(orderData.tableNumber, 40);
    const mobile = clean(orderData.mobile, 30);
    const address = clean(orderData.address, 500);
    if (orderType === 'Dine-In' && (!customerName || !tableNumber)) throw new Error('Please enter your name and select a table.');
    if (orderType === 'Home Delivery' && (!customerName || !mobile || !address)) throw new Error('Please complete the delivery contact and address details.');
    const rawItems = Array.isArray(orderData.items) ? orderData.items : [];
    if (!rawItems.length || rawItems.length > 30) throw new Error('Your bag is empty or contains too many items.');

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const suffix = String(idempotencyKey || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase() || Math.random().toString(36).slice(2, 8).toUpperCase();
    const orderId = `AR-${stamp}-${suffix}`;
    const orderRef = db.collection('orders').doc(orderId);
    // A retry of an order that was already saved must not create a duplicate.
    const existing = await orderRef.get().catch(() => null);
    if (existing && existing.exists) return { id: existing.id, ...existing.data() };

    const merged = new Map();
    rawItems.forEach((raw) => {
      const productId = clean(raw?.id, 128);
      const quantity = Number(raw?.quantity);
      if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error('A cart item is invalid. Please refresh and try again.');
      const selectedSize = clean(raw.selectedSize, 32) || 'Regular';
      const selectedTemp = clean(raw.selectedTemp, 32) || 'Hot';
      const key = `${productId}:${selectedSize}:${selectedTemp}`;
      const entry = merged.get(key) || { productId, quantity: 0, selectedSize, selectedTemp, note: clean(raw.note, 200) };
      entry.quantity = Math.min(99, entry.quantity + quantity);
      merged.set(key, entry);
    });

    // Prices always come from the live menu, never from the browser's cart.
    const catalogEmpty = (await db.collection('products').limit(1).get()).empty;
    const starter = new Map((window.STARTER_PRODUCTS || []).map((product) => [product.id, product]));
    const items = await Promise.all([...merged.values()].map(async (item) => {
      const snapshot = await db.collection('products').doc(item.productId).get();
      const product = snapshot.exists ? snapshot.data() : (catalogEmpty ? starter.get(item.productId) : null);
      if (!product || product.available === false) throw new Error('An item in your cart is no longer available. Please remove it and try again.');
      const price = Number(product.price);
      if (!Number.isFinite(price) || price < 0) throw new Error('A menu item has an invalid price.');
      return { productId: item.productId, name: clean(product.name, 120), image: product.image || '', qty: item.quantity, price, selectedSize: item.selectedSize, selectedTemp: item.selectedTemp, note: item.note };
    }));

    let tableRef = null;
    if (orderType === 'Dine-In') {
      const tableQuery = await db.collection('tables').where('number', '==', tableNumber).limit(1).get();
      if (tableQuery.empty) throw new Error('That table does not exist. Please select an available table.');
      if (tableQuery.docs[0].get('status') !== 'Available') throw new Error('That table is no longer available. Please select another table.');
      tableRef = tableQuery.docs[0].ref;
    }

    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const totals = calcTotals(Number(subtotal.toFixed(2)), orderType === 'Home Delivery');
    const now = new Date().toISOString();
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const trackingToken = [...tokenBytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const order = {
      customerUid: user.uid, customerName,
      mobile: orderType === 'Home Delivery' ? mobile : '',
      email: '', address: orderType === 'Home Delivery' ? address : '',
      tableNumber: orderType === 'Dine-In' ? tableNumber : '',
      tableId: tableRef ? tableRef.id : '',
      orderType, items, subtotal: totals.subtotal, deliveryFee: totals.deliveryFee, discount: totals.discount, total: totals.total,
      paymentMethod: orderType === 'Dine-In' ? 'Pay at Café' : 'Cash on Delivery',
      notes: clean(orderData.notes, 500), status: 'New', trackingToken, createdAt: now, updatedAt: now
    };
    const batch = db.batch();
    batch.set(orderRef, order);
    batch.set(db.collection('orderStatusTokens').doc(trackingToken), { orderId, status: 'New', updatedAt: now });
    if (tableRef) batch.update(tableRef, { status: 'Ordering', updatedAt: now });
    try { await batch.commit(); }
    catch (error) {
      const saved = await orderRef.get().catch(() => null);
      if (saved && saved.exists) return { id: saved.id, ...saved.data() };
      throw error;
    }
    const created = { id: orderId, ...order };
    localStorage.setItem('arabica_tracking_token', trackingToken);
    localStorage.setItem('arabica_active_order', JSON.stringify(created));
    return created;
  },
  getActiveOrder() {
    const saved = readStorage('arabica_active_order', null);
    return (saved && ordersCache.find((order) => order.id === saved.id)) || ordersCache[0] || saved || null;
  },
  async repeatOrder(orderId) {
    await productsLoaded;
    const order = ordersCache.find((entry) => entry.id === orderId);
    if (!order?.items?.length) throw new Error('This order has no items to repeat.');
    if (cartService.getCart().length && !window.confirm('Replace your current cart with this order?')) return false;
    const items = order.items.map((item) => {
      const id = item.productId || item.id;
      const product = menuService.getProductById(id);
      if (!product || product.available === false) throw new Error(`${item.name || 'A product'} is no longer available.`);
      return {
        id,
        quantity: Number(item.qty || item.quantity),
        selectedSize: item.selectedSize || 'Regular',
        selectedTemp: item.selectedTemp || 'Hot',
        note: item.note || '',
        productSnapshot: { name: product.name, image: product.image, price: Number(product.price) || 0 },
        addedAt: Date.now()
      };
    });
    cartService.persist(items);
    window.location.href = './checkout.html';
    return true;
  },
  async updateOrderStatus(orderId, newStatus) {
    if (!adminAuthorized) throw new Error('Admin access required.');
    if (!ORDER_STATUSES.includes(newStatus)) throw new Error('Invalid status.');
    const ref = db.collection('orders').doc(String(orderId));
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error('Order not found.');
    const order = snapshot.data();
    if (newStatus !== order.status && !(ORDER_TRANSITIONS[order.status] || []).includes(newStatus)) throw new Error(`Cannot change an order from ${order.status} to ${newStatus}.`);
    if (order.orderType === 'Dine-In' && newStatus === 'Out for Delivery') throw new Error('Dine-in orders cannot be dispatched.');
    const now = new Date().toISOString();
    const batch = db.batch();
    batch.update(ref, { status: newStatus, updatedAt: now });
    if (order.trackingToken) batch.update(db.collection('orderStatusTokens').doc(order.trackingToken), { status: newStatus, updatedAt: now });
    if (order.tableId && ['Completed', 'Cancelled'].includes(newStatus) && tablesCache.some((table) => table.id === order.tableId)) {
      batch.update(db.collection('tables').doc(order.tableId), { status: 'Available', updatedAt: now });
    }
    await batch.commit();
    return { id: snapshot.id, ...order, status: newStatus, updatedAt: now };
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

async function uploadAdminImage(file, folder, onProgress) {
  if (!adminAuthorized || !auth.currentUser) throw new Error('Admin access required.');
  if (!file || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG, WEBP, or GIF image under 5 MB.');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${folder}/${auth.currentUser.uid}/${Date.now()}-${safeName}`;
  const ref = storage.ref(path);
  const task = ref.put(file, { contentType: file.type });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      task.cancel();
      reject(new Error('Image upload timed out. Check Firebase Storage setup and deployed Storage rules.'));
    }, 60000);
    task.on('state_changed', (snapshot) => {
      if (onProgress && snapshot.totalBytes) onProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
    }, (error) => { clearTimeout(timeout); reject(error); }, () => { clearTimeout(timeout); resolve(); });
  });
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
    const featuredProducts = (productsCache.length ? productsCache : window.STARTER_PRODUCTS || [])
      .filter((product) => product.featured && product.available !== false).slice(0, 3);
    const isDineIn = localStorage.getItem(STORAGE_KEYS.orderMode) === 'dine-in';
    featured.innerHTML = featuredProducts.map((product) => `
      <article class="product-card">
        <a class="product-card-link" href="./product.html?id=${encodeURIComponent(product.id)}">
        <div class="image-wrap"><img src="${escapeHTML(product.image || '')}" alt="${escapeHTML(product.name || '')}" loading="lazy"><span class="product-badge">${escapeHTML(product.badge || product.category || '')}</span></div>
        <div class="meta"><span class="kicker">${escapeHTML(product.category || '')}</span><span class="price">${formatCurrency(product.price)}</span></div>
        <h4>${escapeHTML(product.name || '')}</h4><p class="description">${escapeHTML(product.description || '')}</p>
        </a>
        <div class="actions">
          ${isDineIn ? '' : `<button class="secondary-btn half-btn mini-btn" type="button" data-add-to-cart="${escapeHTML(product.id)}">Add to bag</button>`}
          <button class="primary-btn half-btn mini-btn" type="button" data-buy-now="${escapeHTML(product.id)}">Order now</button>
        </div>
      </article>`).join('');
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
        cartService.addToCart(product, Number(detail?.querySelector('#quantity-value')?.textContent || 1), { size: groups[0]?.querySelector('.option-btn.active')?.textContent.trim() || 'Regular', temp: groups[1]?.querySelector('.option-btn.active')?.textContent.trim() || 'Hot' });
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
  const page = document.body.dataset.page;
  const productPages = ['home', 'menu', 'product', 'cart', 'checkout', 'account', 'orders', 'confirmation', 'track-order', 'admin-dashboard', 'admin-menu', 'admin-orders'];
  if (productPages.includes(page)) {
    db.collection('products').onSnapshot((snapshot) => {
      productsCache = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })); firstProductsLoaded(); applyWebsiteContent(); emitDataUpdated();
    }, (error) => { console.error('Products read failed:', error); firstProductsLoaded(); showToast('Unable to load the menu from Firebase.', 'error'); });
  } else firstProductsLoaded();
  if (page === 'home') {
    db.collection('websiteContent').doc('home').onSnapshot((snapshot) => { websiteContent = snapshot.exists ? snapshot.data() : {}; applyWebsiteContent(); emitDataUpdated(); }, (error) => console.error('Website content read failed:', error));
  }
  if (['dine-in', 'admin-orders', 'admin-tables'].includes(page)) {
    db.collection('tables').onSnapshot((snapshot) => { tablesCache = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })); emitDataUpdated(); }, (error) => console.error('Table read failed:', error));
  }
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
  Promise.race([productsLoaded, new Promise((resolve) => setTimeout(resolve, 350))]),
  Promise.race([authLoaded, new Promise((resolve) => setTimeout(resolve, 4000))])
]);
if (location.protocol === 'file:') console.warn('Open this site through a local server (http://localhost), not as a file. Firebase sign-in does not work from file://.');
subscribeData();
auth.onAuthStateChanged(async (user) => {
  adminAuthorized = false; currentProfile = null;
  if (user && !user.isAnonymous) currentProfile = {
    uid: user.uid,
    email: user.email,
    fullName: user.displayName || '',
    mobile: '',
    savedAddresses: []
  };
  firstAuthLoaded();
  if (user) {
    cartService.loadFromFirebase(user).catch((error) => console.warn('Saved cart could not be loaded:', error));
    try {
      const [isAdmin, profile] = await Promise.all([
        checkIsAdmin(user),
        user.isAnonymous
          ? Promise.resolve(null)
          : db.collection('users').doc(user.uid).get().catch((error) => {
              console.warn('Profile could not be loaded:', error);
              return null;
            })
      ]);
      adminAuthorized = isAdmin;
      if (!user.isAnonymous) currentProfile = profile?.exists
        ? { uid: user.uid, ...profile.data() }
        : { uid: user.uid, email: user.email, fullName: user.displayName || '' };
      attachPrivateListeners(user, adminAuthorized);
      if (!user.isAnonymous) privateUnsubscribers.push(db.collection('users').doc(user.uid).onSnapshot((snapshot) => {
        if (snapshot.exists) { currentProfile = { uid: user.uid, ...snapshot.data() }; emitDataUpdated(); }
      }, (error) => console.error('Profile listener failed:', error)));
    } catch (error) { console.error('Account initialization failed:', error); }
  } else { privateUnsubscribers.forEach((unsubscribe) => unsubscribe()); privateUnsubscribers = []; ordersCache = []; customerProfiles = []; }
  hydrateSession(); emitDataUpdated(); firstAuthInitialized();
});

document.addEventListener('DOMContentLoaded', async () => {
  try { await appReady; } catch (error) { console.error(error); }
  setActiveHeaderLink(); initMobileNav(); initRevealAnimations(); bindGlobalActions(); hydrateSession(); cartService.updateCount();
});