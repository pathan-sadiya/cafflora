const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('node:crypto');
const starterCatalog = require('./starter-catalog');

initializeApp();
const db = getFirestore();
const statuses = ['New', 'Confirmed', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered', 'Completed', 'Cancelled'];
const transitions = {
  New: ['Confirmed', 'Cancelled'], Confirmed: ['Preparing', 'Cancelled'],
  Preparing: ['Ready', 'Cancelled'], Ready: ['Out for Delivery', 'Delivered', 'Completed'],
  'Out for Delivery': ['Delivered'], Delivered: ['Completed'], Completed: [], Cancelled: []
};
const fail = (code, message) => { throw new HttpsError(code, message); };
const boundedText = (value, max = 300) => String(value || '').trim().slice(0, max);

exports.createOrder = onCall({ enforceAppCheck: true }, async (request) => {
  if (!request.auth) fail('unauthenticated', 'Sign in or continue as guest before ordering.');
  const data = request.data || {};
  const idempotencyKey = boundedText(data.idempotencyKey, 80);
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(idempotencyKey)) fail('invalid-argument', 'A valid checkout request key is required.');
  const orderType = data.orderType;
  if (!['Dine-In', 'Home Delivery'].includes(orderType)) fail('invalid-argument', 'Invalid order type.');
  if (orderType === 'Dine-In' && (!boundedText(data.customerName, 100) || !boundedText(data.tableNumber, 40))) fail('invalid-argument', 'Dine-in name and table are required.');
  if (orderType === 'Home Delivery' && (!boundedText(data.customerName, 100) || !boundedText(data.mobile, 30) || !boundedText(data.address, 500))) fail('invalid-argument', 'Complete the delivery contact and address details.');
  if (data.paymentMethod && data.paymentMethod !== 'Cash on Delivery' && data.paymentMethod !== 'Pay at Café') fail('failed-precondition', 'The selected payment method is not available yet.');
  if (!Array.isArray(data.items) || !data.items.length || data.items.length > 30) fail('invalid-argument', 'Your cart is empty or contains too many distinct items.');

  const merged = new Map();
  for (const raw of data.items) {
    if (!raw || typeof raw !== 'object') fail('invalid-argument', 'Cart item is invalid.');
    const productId = boundedText(raw.id, 128);
    const quantity = Number(raw.quantity);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) fail('invalid-argument', 'Cart item quantity or product ID is invalid.');
    const selectedSize = boundedText(raw.selectedSize, 32) || 'Regular';
    const selectedTemp = boundedText(raw.selectedTemp, 32) || 'Hot';
    const key = `${productId}:${selectedSize}:${selectedTemp}`;
    const item = merged.get(key) || { productId, quantity: 0, selectedSize, selectedTemp, note: boundedText(raw.note, 200) };
    item.quantity += quantity;
    if (item.quantity > 99) fail('invalid-argument', 'An item quantity cannot exceed 99.');
    merged.set(key, item);
  }

  const uid = request.auth.uid;
  const requestId = crypto.createHash('sha256').update(`${uid}:${idempotencyKey}`).digest('hex');
  const requestRef = db.collection('createRequests').doc(requestId);
  const priorRequest = await requestRef.get();
  if (priorRequest.exists) {
    const priorOrder = await db.collection('orders').doc(priorRequest.get('orderId')).get();
    if (!priorOrder.exists) fail('internal', 'The previous checkout record is incomplete.');
    return { order: { id: priorOrder.id, ...priorOrder.data() }, trackingToken: priorRequest.get('trackingToken') };
  }
  const productRefs = [...new Set([...merged.values()].map((item) => item.productId))].map((id) => db.collection('products').doc(id));
  const useStarterCatalog = (await db.collection('products').limit(1).get()).empty;
  let tableRef = null;
  if (orderType === 'Dine-In') {
    const tableQuery = await db.collection('tables').where('number', '==', boundedText(data.tableNumber, 40)).limit(1).get();
    if (tableQuery.empty) fail('failed-precondition', 'That table does not exist. Select an available table.');
    tableRef = tableQuery.docs[0].ref;
  }
  const orderRef = db.collection('orders').doc();
  const trackingToken = crypto.randomBytes(32).toString('hex');
  const statusRef = db.collection('orderStatusTokens').doc(trackingToken);
  const now = new Date().toISOString();

  const result = await db.runTransaction(async (transaction) => {
    const previous = await transaction.get(requestRef);
    if (previous.exists) {
      const existingOrder = await transaction.get(db.collection('orders').doc(previous.get('orderId')));
      if (!existingOrder.exists) fail('internal', 'The previous checkout record is incomplete.');
      return { order: { id: existingOrder.id, ...existingOrder.data() }, trackingToken: previous.get('trackingToken') };
    }
    const snapshots = await transaction.getAll(...productRefs, ...(tableRef ? [tableRef] : []));
    const productSnapshots = snapshots.slice(0, productRefs.length);
    if (tableRef) {
      const table = snapshots[snapshots.length - 1];
      if (!table.exists || table.get('status') !== 'Available') fail('failed-precondition', 'That table is no longer available. Select another table.');
    }
    const productMap = new Map(productSnapshots.map((snapshot) => [snapshot.id, snapshot.exists ? snapshot.data() : null]));
    const items = [...merged.values()].map((item) => {
      const product = productMap.get(item.productId) || (useStarterCatalog ? starterCatalog[item.productId] : null);
      if (!product || product.available === false) fail('failed-precondition', 'An item in your cart is unavailable. Refresh the menu and try again.');
      const price = Number(product.price);
      if (!Number.isFinite(price) || price < 0 || price > 1000000) fail('failed-precondition', 'A menu item has an invalid price.');
      return { productId: item.productId, name: boundedText(product.name, 120), qty: item.quantity, price, selectedSize: item.selectedSize, selectedTemp: item.selectedTemp, note: item.note };
    });
    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    if (!Number.isFinite(subtotal) || subtotal > 100000000) fail('failed-precondition', 'The cart total is outside the supported range.');
    const deliveryFee = orderType === 'Home Delivery' ? 2.5 : 0;
    const discount = subtotal > 20 ? 4 : 0;
    const total = Math.max(0, Number((subtotal + deliveryFee - discount).toFixed(2)));
    const order = {
      customerUid: uid,
      customerName: boundedText(data.customerName, 100),
      mobile: orderType === 'Home Delivery' ? boundedText(data.mobile, 30) : '',
      email: orderType === 'Home Delivery' ? boundedText(data.email, 254).toLowerCase() : '',
      address: orderType === 'Home Delivery' ? boundedText(data.address, 500) : '',
      tableNumber: orderType === 'Dine-In' ? boundedText(data.tableNumber, 40) : '',
      tableId: orderType === 'Dine-In' ? tableRef.id : '',
      orderType, items, subtotal: Number(subtotal.toFixed(2)), deliveryFee, discount, total,
      paymentMethod: orderType === 'Dine-In' ? 'Pay at Café' : 'Cash on Delivery',
      notes: boundedText(data.notes, 500), status: 'New', createdAt: now, updatedAt: now
    };
    transaction.create(orderRef, order);
    transaction.create(statusRef, { orderId: orderRef.id, status: 'New', updatedAt: now });
    transaction.create(requestRef, { orderId: orderRef.id, trackingToken, createdAt: FieldValue.serverTimestamp() });
    if (tableRef) transaction.update(tableRef, { status: 'Ordering', updatedAt: now });
    return { order: { id: orderRef.id, ...order }, trackingToken };
  });
  return result;
});

exports.updateOrderStatus = onCall({ enforceAppCheck: true }, async (request) => {
  if (!request.auth || (request.auth.uid !== 'MHx9d4SOLhci8zY7T18iXlhVoi93' && request.auth.token.admin !== true)) fail('permission-denied', 'Admin access is required.');
  const orderId = boundedText(request.data?.orderId, 128);
  const nextStatus = request.data?.status;
  if (!orderId || !statuses.includes(nextStatus)) fail('invalid-argument', 'Invalid order or status.');
  const orderRef = db.collection('orders').doc(orderId);
  const now = new Date().toISOString();
  const updated = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(orderRef);
    if (!snapshot.exists) fail('not-found', 'Order not found.');
    const order = snapshot.data();
    if (order.orderType === 'Dine-In' && nextStatus === 'Out for Delivery') fail('failed-precondition', 'Dine-in orders cannot be dispatched.');
    if (nextStatus !== order.status && !transitions[order.status]?.includes(nextStatus)) fail('failed-precondition', `Cannot change an order from ${order.status} to ${nextStatus}.`);
    let tableSnapshot = null;
    if (order.orderType === 'Dine-In' && order.tableId) tableSnapshot = await transaction.get(db.collection('tables').doc(order.tableId));
    const statusTokens = await transaction.get(db.collection('orderStatusTokens').where('orderId', '==', orderId));
    transaction.update(orderRef, { status: nextStatus, updatedAt: now });
    statusTokens.docs.forEach((doc) => transaction.update(doc.ref, { status: nextStatus, updatedAt: now }));
    if (tableSnapshot?.exists && ['Completed', 'Cancelled'].includes(nextStatus)) transaction.update(tableSnapshot.ref, { status: 'Available', updatedAt: now });
    return { id: snapshot.id, ...order, status: nextStatus, updatedAt: now };
  });
  return { order: updated };
});
