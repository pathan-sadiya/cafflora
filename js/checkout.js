document.addEventListener('DOMContentLoaded', async () => {
  await appReady;
  await authInitialized;
  const escape = (value) => escapeHTML(value);
  const form = document.getElementById('checkout-form');
  if (form) form.noValidate = true;
  const itemsPanel = document.getElementById('checkout-items');
  if (!form || !itemsPanel) return;
  const dineIn = localStorage.getItem('arabica_order_mode') === 'dine-in';
  const deliveryFields = document.getElementById('delivery-fields');
  const deliveryPayment = document.getElementById('delivery-payment');
  const dineInInfo = document.getElementById('dine-in-checkout-info');
  const customerName = localStorage.getItem('arabica_dine_in_name') || '';
  const tableNumber = localStorage.getItem('arabica_table_number') || '';
  const currentUser = authService.getCurrentUser();
  const defaultAddress = currentUser?.savedAddresses?.find((address) => address.isDefault) || currentUser?.savedAddresses?.[0];
  const button = document.getElementById('place-order-btn');
  if (!sessionStorage.getItem('arabica_checkout_request')) {
    sessionStorage.setItem('arabica_checkout_request', crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`);
  }
  if (!dineIn && currentUser) {
    const values = { fullName: defaultAddress?.fullName || currentUser.fullName, mobile: defaultAddress?.mobile || currentUser.mobile, flat: defaultAddress?.flat, street: defaultAddress?.street, city: defaultAddress?.city, state: defaultAddress?.state, pin: defaultAddress?.pin, instructions: defaultAddress?.instructions };
    Object.entries(values).forEach(([name, value]) => { const input = form.elements[name]; if (input && value) input.value = value; });
  }
  const savedAddressSummary = document.getElementById('saved-address-summary');
  const changeAddressButton = document.getElementById('change-address-btn');
  const addressInputs = [...(deliveryFields?.querySelectorAll('input, textarea') || [])];
  const addressBlocks = [...new Set(addressInputs.map((input) => input.closest('.form-row') || input.closest('.form-field')).filter(Boolean))]
    .filter((block) => !block.contains(savedAddressSummary));
  const setAddressEditing = (editing) => {
    addressBlocks.forEach((block) => { block.hidden = !editing; });
    addressInputs.forEach((input) => { input.readOnly = false; });
    if (changeAddressButton) changeAddressButton.textContent = editing ? 'Use saved address' : 'Change address';
    form.dataset.editingAddress = editing ? 'true' : 'false';
  };
  if (!dineIn && defaultAddress && savedAddressSummary && changeAddressButton) {
    const addressText = [defaultAddress.flat, defaultAddress.street, defaultAddress.city, defaultAddress.state, defaultAddress.pin].filter(Boolean).join(', ');
    savedAddressSummary.textContent = `Delivering to: ${[defaultAddress.fullName, addressText].filter(Boolean).join(' — ')}`;
    savedAddressSummary.hidden = false;
    changeAddressButton.hidden = false;
    setAddressEditing(false);
    changeAddressButton.addEventListener('click', () => setAddressEditing(form.dataset.editingAddress !== 'true'));
  }
  if (deliveryFields) deliveryFields.hidden = dineIn;
  if (deliveryPayment) deliveryPayment.hidden = dineIn;
  if (dineInInfo) dineInInfo.hidden = !dineIn;
  document.getElementById('dine-in-customer-name').textContent = customerName;
  document.getElementById('dine-in-table-number').textContent = tableNumber;
  form.querySelectorAll('.delivery-required').forEach((input) => { input.required = !dineIn; });
  const feeLabel = document.getElementById('checkout-fee-label');
  if (feeLabel) feeLabel.textContent = dineIn ? 'Café Pickup' : 'Delivery Fee';
  form.querySelectorAll('input[name="payment"]').forEach((input) => { if (input.value !== 'Cash on Delivery') input.disabled = true; });

  const renderCheckout = () => {
    const items = cartService.getCart();
    if (!items.length) {
      itemsPanel.innerHTML = '<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-bag-shopping"></i></div><h3>Your bag is waiting.</h3><p>Add something from the menu before confirming your order.</p><a class="primary-btn" href="./menu.html">Explore the menu</a></div>';
      ['checkout-subtotal', 'checkout-delivery', 'checkout-discount', 'checkout-total'].forEach((id) => { const node = document.getElementById(id); if (node) node.textContent = formatCurrency(0); });
      if (button) button.disabled = true;
      return;
    }
    if (button) button.disabled = false;
    itemsPanel.innerHTML = items.map((item) => {
      const product = cartService.getProductForCart(item);
      return `<div class="order-item"><img src="${escape(product.image || 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=160&q=80')}" alt="${escape(product.name)}" loading="lazy" style="width:64px;height:64px;object-fit:cover;border-radius:6px;"><div><strong>${escape(product.name)}</strong><div style="font-size:.8rem;color:var(--muted);">${item.quantity} x ${formatCurrency(product.price)}</div></div><strong>${formatCurrency(product.price * item.quantity)}</strong></div>`;
    }).join('');
    const totals = calcTotals(cartService.getSubtotal(), !dineIn);
    document.getElementById('checkout-subtotal').textContent = formatCurrency(totals.subtotal);
    document.getElementById('checkout-delivery').textContent = formatCurrency(totals.deliveryFee);
    document.getElementById('checkout-discount').textContent = totals.discount ? `-${formatCurrency(totals.discount)}` : formatCurrency(0);
    document.getElementById('checkout-total').textContent = formatCurrency(totals.total);
  };

  const orderErrorMessage = (error) => {
    if (error?.code === 'permission-denied') return 'We could not save your order. Please refresh the page, sign in again and retry.';
    if (error?.code === 'unavailable' || error?.code === 'auth/network-request-failed') return 'You appear to be offline. Check your internet connection and try again.';
    if (error?.code === 'auth/operation-not-allowed' || error?.code === 'auth/admin-restricted-operation') return 'Guest ordering is not enabled. Please sign in or contact the café.';
    return error?.message || 'Could not place your order. Please retry.';
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const cart = cartService.getCart();
    if (!cart.length) return showToast('Your bag is empty. Explore the menu before checkout.', 'error');
    if (cart.some((item) => cartService.getProductForCart(item).available === false)) return showToast('Remove unavailable items before placing your order.', 'error');
    const data = new FormData(form);
    const address = [data.get('flat'), data.get('street'), data.get('city'), data.get('state'), data.get('pin')].map((value) => String(value || '').trim()).filter(Boolean).join(', ');
    const order = {
      orderType: dineIn ? 'Dine-In' : 'Home Delivery',
      customerName: dineIn ? customerName : String(data.get('fullName') || '').trim(),
      mobile: dineIn ? '' : String(data.get('mobile') || '').trim(),
      email: '',
      address: dineIn ? '' : address,
      tableNumber: dineIn ? tableNumber : '',
      items: cart,
      paymentMethod: dineIn ? 'Pay at Café' : (data.get('payment') || 'Cash on Delivery'),
      notes: data.get('instructions') || data.get('orderNotes') || ''
    };
    if (!dineIn && form.dataset.editingAddress === 'false' && [...form.querySelectorAll('.delivery-required')].some((input) => !String(input.value || '').trim())) setAddressEditing(true);
    if (dineIn ? (!order.customerName || !order.tableNumber) : (!order.customerName || !order.mobile || !order.address)) return showToast(dineIn ? 'Please enter your name and table number.' : 'Please complete the required delivery details.', 'error');
    if (!dineIn) {
      const missing = [...form.querySelectorAll('.delivery-required')].find((input) => !String(input.value || '').trim());
      if (missing) { setAddressEditing(true); missing.focus(); return showToast('Please fill in all delivery details.', 'error'); }
    }
    if (button) { button.disabled = true; button.textContent = 'Placing Order…'; }
    try {
      const firebaseUser = authService.getFirebaseUser();
      if (!dineIn && firebaseUser && !firebaseUser.isAnonymous) {
        await customerService.updateProfile({ fullName: order.customerName, mobile: order.mobile });
        await customerService.saveAddress({
          id: defaultAddress?.id || 'home', label: defaultAddress?.label || 'Home',
          fullName: order.customerName, mobile: order.mobile,
          flat: String(data.get('flat') || '').trim(), street: String(data.get('street') || '').trim(),
          city: String(data.get('city') || '').trim(), state: String(data.get('state') || '').trim(),
          pin: String(data.get('pin') || '').trim(), instructions: String(data.get('instructions') || '').trim(), isDefault: true
        });
      }
      const created = await orderService.createOrder(order, sessionStorage.getItem('arabica_checkout_request'));
      cartService.clearCart();
      localStorage.setItem('arabica_last_confirmation', JSON.stringify(created));
      sessionStorage.removeItem('arabica_checkout_request');
      showToast('Order placed successfully.');
      setTimeout(() => { window.location.href = './order-confirmation.html'; }, 500);
    } catch (error) {
      console.error('Order submission failed:', error);
      showToast(orderErrorMessage(error), 'error');
      if (button) { button.disabled = false; button.textContent = 'Confirm your order'; }
    }
  });
  renderCheckout();
  document.addEventListener('app:data-updated', renderCheckout);
});
