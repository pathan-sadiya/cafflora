document.addEventListener('DOMContentLoaded', async () => {
  await appReady;
  const escape = (value) => escapeHTML(value);
  const cartList = document.getElementById('cart-items');
  if (!cartList) return;

  const renderCart = () => {
    const items = cartService.getCart();
    if (!items.length) {
      cartList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><i class="fa-solid fa-bag-shopping"></i></div>
          <h3>Your bag is waiting.</h3>
          <p>Explore the menu and add something you’d love to enjoy.</p>
          <a class="primary-btn" href="./menu.html">Explore the menu</a>
        </div>
      `;
      document.getElementById('summary-subtotal').textContent = formatCurrency(0);
      document.getElementById('summary-delivery').textContent = formatCurrency(0);
      document.getElementById('summary-fee-label').textContent = 'Delivery Fee';
      document.getElementById('summary-discount').textContent = formatCurrency(0);
      document.getElementById('summary-total').textContent = formatCurrency(0);
      return;
    }

    cartList.innerHTML = items.map((item) => {
      const product = cartService.getProductForCart(item);
      const subtotal = Number(product.price || 0) * item.quantity;
      return `
        <article class="cart-item">
          <div class="cart-item-image"><img src="${escape(product.image || 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=400&q=80')}" alt="${escape(product.name)}" loading="lazy" /></div>
          <div>
            <h4>${escape(product.name)}</h4>
            <p style="margin: 0; color: var(--muted);">${escape(item.selectedTemp)} • ${escape(item.selectedSize)}</p>
            <p style="margin: 8px 0 0; font-weight: 700; color: var(--warning);">${formatCurrency(subtotal)}</p>
          </div>
          <div class="cart-controls">
            <div class="cart-qty">
              <button type="button" data-qty-update="decrease" data-product-id="${item.id}" data-size="${item.selectedSize}" data-temp="${item.selectedTemp}">−</button>
              <span>${item.quantity}</span>
              <button type="button" data-qty-update="increase" data-product-id="${item.id}" data-size="${item.selectedSize}" data-temp="${item.selectedTemp}">+</button>
            </div>
            <button type="button" class="ghost-btn" data-remove-item="${item.id}" data-size="${item.selectedSize}" data-temp="${item.selectedTemp}">Remove</button>
          </div>
        </article>
      `;
    }).join('');

    cartList.querySelectorAll('img').forEach((image) => image.addEventListener('error', () => {
      image.src = 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=400&q=80';
    }, { once: true }));

    const totals = calcTotals(cartService.getSubtotal(), localStorage.getItem('arabica_order_mode') !== 'dine-in');

    document.getElementById('summary-subtotal').textContent = formatCurrency(totals.subtotal);
    document.getElementById('summary-fee-label').textContent = localStorage.getItem('arabica_order_mode') === 'dine-in' ? 'Café Pickup' : 'Delivery Fee';
    document.getElementById('summary-delivery').textContent = formatCurrency(totals.deliveryFee);
    document.getElementById('summary-discount').textContent = totals.discount ? `-${formatCurrency(totals.discount)}` : formatCurrency(0);
    document.getElementById('summary-total').textContent = formatCurrency(totals.total);
  };

  document.addEventListener('click', (event) => {
    const update = event.target.closest('[data-qty-update]');
    if (update) {
      const { productId, size, temp, qtyUpdate } = update.dataset;
      cartService.updateQuantity(productId, size, temp, qtyUpdate === 'increase' ? 1 : -1);
      renderCart();
      return;
    }

    const remove = event.target.closest('[data-remove-item]');
    if (remove) {
      cartService.removeItem(remove.dataset.removeItem, remove.dataset.size, remove.dataset.temp);
      renderCart();
      return;
    }
  });

  renderCart();
  document.addEventListener('app:data-updated', renderCart);
});
