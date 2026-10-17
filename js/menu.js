const menuPage = {
  selectedCategory: 'All',
  query: '',
  sort: 'featured'
};

function getMenuProducts() {
  const publishedProducts = menuService.getAllProducts();
  return publishedProducts.length ? publishedProducts : (window.STARTER_PRODUCTS || []);
}

function getMenuCategories() {
  return ['All', ...new Set(getMenuProducts().map((product) => product.category).filter(Boolean))];
}

function renderOrderMode() {
  const mode = localStorage.getItem('arabica_order_mode') || 'delivery';
  document.querySelectorAll('[data-order-mode]').forEach((button) => {
    const selected = button.dataset.orderMode === mode;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function renderProductCards(products) {
  const grid = document.getElementById('product-grid');
  if (!grid) return;
  if (!products.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-icon"><i class="fa-solid fa-magnifying-glass"></i></div>
        <h3>${menuService.getAllProducts().length ? 'Nothing matches just yet.' : 'The menu is being prepared.'}</h3>
        <p>${menuService.getAllProducts().length ? 'Try another search or category to find your next café favourite.' : 'Our menu is getting ready. Please check back soon.'}</p>
      </div>
    `;
    return;
  }
  const isDineIn = localStorage.getItem('arabica_order_mode') === 'dine-in';
  grid.innerHTML = products.map((product) => {
    const details = `
        <div class="image-wrap">
          <img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy">
          <span class="product-badge">${escapeHTML(product.badge || product.category)}</span>
        </div>
        <div class="meta">
          <span class="kicker" style="letter-spacing: .08em; font-size: 11px;">${escapeHTML(product.category)}</span>
          <span class="price">${formatCurrency(product.price)}</span>
        </div>
        <h4>${escapeHTML(product.name)}</h4>
        <p class="description">${escapeHTML(product.description)}</p>
    `;
    return `
    <article class="product-card">
      <a class="product-card-link" href="./product.html?id=${encodeURIComponent(product.id)}">${details}</a>
      <div class="actions">
        ${product.available === false ? '<span class="subtle">Temporarily unavailable</span>' : `${isDineIn ? '' : `<button class="secondary-btn half-btn mini-btn" type="button" data-add-to-cart="${escapeHTML(product.id)}">Add to bag</button>`}<button class="primary-btn half-btn mini-btn" type="button" data-buy-now="${escapeHTML(product.id)}">Order now</button>`}
      </div>
    </article>
  `;
  }).join('');
}

function applyFilters() {
  const products = getMenuProducts();
  const filtered = products.filter((product) => {
    const categoryMatch = menuPage.query || menuPage.selectedCategory === 'All' || product.category === menuPage.selectedCategory;
    const searchableText = `${product.name} ${product.category} ${product.description || ''}`.toLowerCase();
    const searchMatch = !menuPage.query || searchableText.includes(menuPage.query);
    return categoryMatch && searchMatch;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (menuPage.sort === 'low-high') return a.price - b.price;
    if (menuPage.sort === 'high-low') return b.price - a.price;
    if (menuPage.sort === 'name') return a.name.localeCompare(b.name);
    return (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
  });

  renderProductCards(sorted);
}

function initMenuPage() {
  const route = document.body.dataset.page;
  if (route !== 'menu') return;
  const params = new URLSearchParams(window.location.search);
  const requestedMode = params.get('mode');
  if (requestedMode === 'delivery' || requestedMode === 'dine-in') {
    localStorage.setItem('arabica_order_mode', requestedMode);
  } else if (!localStorage.getItem('arabica_order_mode')) {
    localStorage.setItem('arabica_order_mode', 'delivery');
  }
  renderOrderMode();
  document.querySelector('[data-order-mode-switch]')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-order-mode]');
    if (!button) return;
    if (button.dataset.orderMode === 'dine-in') {
      window.location.href = './dine-in.html';
      return;
    }
    localStorage.setItem('arabica_order_mode', 'delivery');
    renderOrderMode();
    applyFilters();
  });
  const categories = getMenuCategories();
  const chips = document.querySelector('.filter-group');
  const select = document.getElementById('sort-select');
  const search = document.getElementById('menu-search');

  if (chips) {
    chips.innerHTML = categories.map((category) => `
      <button class="filter-chip ${category === 'All' ? 'active' : ''}" data-category="${category}">${category}</button>
    `).join('');
    chips.addEventListener('click', (event) => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      menuPage.selectedCategory = button.dataset.category;
      chips.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.toggle('active', chip === button));
      applyFilters();
    });
  }

  if (select) {
    select.addEventListener('change', (event) => {
      menuPage.sort = event.target.value;
      applyFilters();
    });
  }

  if (search) {
    search.addEventListener('input', (event) => {
      menuPage.query = event.target.value.trim().toLowerCase();
      if (menuPage.query) menuPage.selectedCategory = 'All';
      chips?.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.category === menuPage.selectedCategory));
      applyFilters();
    });
  }

  applyFilters();
  if (params.has('focusSearch')) search?.focus();
}

document.addEventListener('DOMContentLoaded', async () => {
  await appReady;
  initMenuPage();
  document.addEventListener('app:data-updated', () => {
    const chips = document.querySelector('.filter-group');
    if (chips) {
      const categories = getMenuCategories();
      if (![...chips.querySelectorAll('[data-category]')].some((chip) => chip.dataset.category === menuPage.selectedCategory)) menuPage.selectedCategory = 'All';
      chips.innerHTML = categories.map((category) => `<button class="filter-chip ${category === menuPage.selectedCategory ? 'active' : ''}" data-category="${escapeHTML(category)}">${escapeHTML(category)}</button>`).join('');
    }
    applyFilters();
  });
});
