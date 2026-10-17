document.addEventListener('DOMContentLoaded', async () => {
  await appReady;
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const history = document.querySelector('.order-history-list');
  if (history && !document.getElementById('tracking-status')) {
    const renderHistory = () => {
      const orders = orderService.getOrders();
      history.innerHTML = orders.length ? orders.map((order) => `<article class="order-history-item"><div><strong>${escape(order.id)}</strong><p style="margin:0;color:var(--muted);">${new Date(order.createdAt).toLocaleString()}</p></div><div><p style="margin:0;">${(order.items || []).map((item) => `${escape(item.name)} x${item.qty}`).join(' · ')}</p><small style="color:var(--muted);">${formatCurrency(order.total)}</small></div><div><span class="badge">${escape(order.status)}</span><br><a class="ghost-btn" href="./track-order.html?id=${encodeURIComponent(order.id)}">Follow order</a> <button class="ghost-btn" type="button" data-repeat-order="${escape(order.id)}">Order again</button></div></article>`).join('') : '<div class="empty-state"><h3>Your next favourite is still out there.</h3><p>Once you place an order, its details will appear here.</p><a class="primary-btn" href="./menu.html">Explore the menu</a></div>';
    };
    history.addEventListener('click', (event) => {
      const button = event.target.closest('[data-repeat-order]');
      if (button) orderService.repeatOrder(button.dataset.repeatOrder).catch((error) => showToast(error.message || 'Could not repeat this order.', 'error'));
    });
    renderHistory(); document.addEventListener('app:data-updated', renderHistory); return;
  }
  const tracking = document.getElementById('tracking-status');
  if (!tracking) return;
  const requestedId = new URLSearchParams(window.location.search).get('id');
  const renderTracking = (active) => {
    const currentStatus = active?.status || 'New';
    const stages = active?.orderType === 'Dine-In' ? ['New', 'Confirmed', 'Preparing', 'Ready', 'Completed'] : ['New', 'Confirmed', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered', 'Completed'];
    const currentIndex = stages.indexOf(currentStatus) >= 0 ? stages.indexOf(currentStatus) : 0;
    tracking.innerHTML = stages.map((stage, index) => `<div class="timeline-step ${index === currentIndex ? 'active' : ''} ${index < currentIndex ? 'done' : ''}"><span class="timeline-dot">${index + 1}</span><span>${stage}</span></div>`).join('');
    const summary = document.getElementById('tracking-summary');
    if (summary) summary.innerHTML = active ? `<div class="order-history-item"><div><strong>Order ${escape(active.id)}</strong><p style="margin:0;color:var(--muted);">${escape(active.orderType || 'Home Delivery')}</p></div><div><strong>${formatCurrency(active.total || 0)}</strong><p style="margin:0;color:var(--muted);">${escape(active.status || 'New')}</p></div></div>` : '<p>We couldn’t find this order. Sign in to view your orders or open the tracking link from your confirmation.</p>';
  };
  const findActive = () => orderService.getOrders().find((order) => order.id === requestedId) || orderService.getOrders().find((order) => order.id === orderService.getActiveOrder()?.id) || (orderService.getActiveOrder()?.id === requestedId ? orderService.getActiveOrder() : null);
  let active = findActive();
  renderTracking(active);
  document.addEventListener('app:data-updated', () => { active = findActive() || active; renderTracking(active); });
  const token = localStorage.getItem('arabica_tracking_token');
  if (token && (!requestedId || token)) {
    firebase.firestore().collection('orderStatusTokens').doc(token).onSnapshot((snapshot) => {
      if (!snapshot.exists) return;
      const tokenData = snapshot.data();
      if (requestedId && tokenData.orderId !== requestedId) return;
      active = { ...(active || {}), id: tokenData.orderId, status: tokenData.status };
      if (active.orderType) renderTracking(active);
      else {
        const info = document.getElementById('tracking-summary');
        if (info) info.innerHTML = `<div class="order-history-item"><div><strong>Order ${escape(tokenData.orderId)}</strong><p style="margin:0;color:var(--muted);">Your order progress</p></div><div><strong>${escape(tokenData.status)}</strong><p style="margin:0;color:var(--muted);">Latest update</p></div></div>`;
      }
    }, (error) => console.error('Order status listener failed:', error));
  }
});
