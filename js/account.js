document.addEventListener('DOMContentLoaded', async () => {
  await appReady;
  await authInitialized;
  if (!authService.getCurrentUser()) { window.location.href = './login.html'; return; }
  const profileCards = document.querySelectorAll('[data-profile-card]');
  const accountInfo = document.getElementById('account-profile');
  const orderList = document.getElementById('account-orders');
  const addressCard = document.querySelector('[data-address-card]');
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  function renderAddresses() {
    if (!addressCard) return;
    const address = customerService.getSavedAddresses()[0];
    addressCard.innerHTML = `<div class="admin-toolbar"><h3 style="font-size:2rem;">Saved address</h3><button class="primary-btn" type="button" data-edit-address="${escape(address?.id || '')}">${address ? 'Edit address' : 'Add an address'}</button></div>${address ? `<div class="order-history-item"><div><strong>${escape(address.label || 'Address')}</strong><p style="margin:0;color:var(--muted);">${[address.fullName,address.mobile,address.flat,address.street,address.city,address.state,address.pin].filter(Boolean).map(escape).join(', ')}</p>${address.instructions ? `<small style="color:var(--muted);">${escape(address.instructions)}</small>` : ''}<p style="margin:8px 0 0;color:var(--success);">Saved for next time</p></div><div><button class="ghost-btn danger-btn" type="button" data-delete-address="${escape(address.id)}">Remove address</button></div></div>` : '<p>No delivery address saved yet. Add one to make your next checkout a little easier.</p>'}`;
  }
  function renderAccount() {
    const user = authService.getCurrentUser(); if (!user) return;
    if (accountInfo) accountInfo.innerHTML = `<div class="admin-toolbar"><h3 style="font-size:2rem;">${escape(user.fullName || 'Cafflora customer')}</h3><button class="ghost-btn" type="button" data-edit-profile>Edit Name</button></div><p><strong>Mobile:</strong> ${escape(user.mobile || '—')}</p><p><strong>Member since:</strong> ${new Date(user.createdAt || Date.now()).toLocaleDateString()}</p>`;
    renderAddresses();
    if (!orderList) return;
    const orders = orderService.getOrders();
    orderList.innerHTML = orders.length ? orders.map((order) => `<article class="order-history-item"><div><strong>${escape(order.id)}</strong><p style="margin:0;color:var(--muted);">${new Date(order.createdAt).toLocaleDateString()}</p></div><div><p style="margin:0;">${(order.items || []).map((item) => escape(item.name)).slice(0, 2).join(', ')}</p><small style="color:var(--muted);">${formatCurrency(order.total || 0)}</small></div><div><span class="badge ${order.status === 'Completed' ? 'completed' : order.status === 'Preparing' ? 'ready' : 'pending'}">${escape(order.status)}</span><br><a class="ghost-btn" href="./track-order.html?id=${encodeURIComponent(order.id)}">Follow order</a> <button class="ghost-btn" type="button" data-repeat-order="${escape(order.id)}">Order again</button></div></article>`).join('') : '<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-bag-shopping"></i></div><h3>Your next café favourite is waiting.</h3><p>Your orders and tracking updates will appear here.</p><a class="primary-btn" href="./menu.html">Explore the menu</a></div>';
  }
  function addressForm(existing) {
    const values = existing || {};
    const fields = [['Address label','label'],['Full name','fullName'],['Mobile number','mobile'],['House / flat / building','flat'],['Street or area','street'],['City','city'],['State','state'],['PIN code','pin'],['Delivery instructions','instructions']];
    const content = fields.map(([label,name]) => `<label class="form-field"><span>${label}</span><input class="input" name="${name}" value="${escape(values[name] || '')}" ${name !== 'instructions' ? 'required' : ''}></label>`).join('');
    const backdrop = document.createElement('div'); backdrop.className = 'admin-modal-backdrop';
    backdrop.innerHTML = `<div class="admin-modal" role="dialog" aria-modal="true"><button class="admin-modal-close ghost-btn" type="button" data-modal-close>&times;</button><h2>${existing ? 'Edit your address' : 'Add a delivery address'}</h2><form class="form-grid">${content}<button class="primary-btn" type="submit">Save address</button></form></div>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop || event.target.closest('[data-modal-close]')) backdrop.remove(); });
    backdrop.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault(); const submit = event.currentTarget.querySelector('[type="submit"]'); submit.disabled = true;
      try { await customerService.saveAddress({ ...Object.fromEntries(new FormData(event.currentTarget)), id: existing?.id || String(Date.now()), isDefault: true }); backdrop.remove(); renderAccount(); showToast('Address saved successfully.'); }
      catch (error) { submit.disabled = false; showToast(error.message || 'Could not save address.', 'error'); }
    });
  }
  function profileForm() {
    const user = authService.getCurrentUser();
    const backdrop = document.createElement('div'); backdrop.className = 'admin-modal-backdrop';
    backdrop.innerHTML = `<div class="admin-modal" role="dialog" aria-modal="true"><button class="admin-modal-close ghost-btn" type="button" data-modal-close aria-label="Close">&times;</button><h2>Edit Profile</h2><form class="form-grid"><label class="form-field"><span>Full Name</span><input class="input" name="fullName" value="${escape(user?.fullName || '')}" required maxlength="100"></label><label class="form-field"><span>Mobile Number</span><input class="input" name="mobile" type="tel" value="${escape(user?.mobile || '')}" required maxlength="30"></label><button class="primary-btn" type="submit">Save Profile</button></form></div>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop || event.target.closest('[data-modal-close]')) backdrop.remove(); });
    backdrop.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault(); const submit = event.currentTarget.querySelector('[type="submit"]'); submit.disabled = true;
      try { await customerService.updateProfile(Object.fromEntries(new FormData(event.currentTarget))); backdrop.remove(); renderAccount(); showToast('Profile updated successfully.'); }
      catch (error) { submit.disabled = false; showToast(error.message || 'Could not update your name.', 'error'); }
    });
  }
  accountInfo?.addEventListener('click', (event) => { if (event.target.closest('[data-edit-profile]')) profileForm(); });
  orderList?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-repeat-order]');
    if (button) orderService.repeatOrder(button.dataset.repeatOrder).catch((error) => showToast(error.message || 'Could not repeat this order.', 'error'));
  });
  addressCard?.addEventListener('click', async (event) => {
    const button = event.target.closest('button'); if (!button) return;
    const addresses = customerService.getSavedAddresses();
    if (button.hasAttribute('data-edit-address')) addressForm(addresses.find((address) => address.id === button.dataset.editAddress));
    if (button.hasAttribute('data-delete-address')) {
      try { await customerService.deleteAddress(); renderAccount(); showToast('Address deleted successfully.'); }
      catch (error) { showToast(error.message || 'Could not delete address.', 'error'); }
    }
  });
  profileCards.forEach((card) => { if (card.dataset.profileCard === 'logout') card.addEventListener('click', async () => { await authService.logout(); window.location.href = './index.html'; }); });
  renderAccount();
  document.addEventListener('app:data-updated', renderAccount);
});
