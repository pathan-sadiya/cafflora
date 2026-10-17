function adminEscape(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
}
function adminDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
function formField(
  label,
  name,
  value = "",
  type = "text",
  required = false,
  extra = "",
) {
  return `<label class="form-field"><span>${label}</span><input class="input" name="${name}" type="${type}" value="${adminEscape(value)}" ${required ? "required" : ""} ${extra}></label>`;
}
function adminModal(title, content, submitHandler) {
  document.querySelector(".admin-modal-backdrop")?.remove();
  const backdrop = document.createElement("div");
  backdrop.className = "admin-modal-backdrop";
  backdrop.innerHTML = `<div class="admin-modal" role="dialog" aria-modal="true"><button class="admin-modal-close ghost-btn" type="button" data-modal-close aria-label="Close">&times;</button><h2>${title}</h2><p class="admin-modal-error" data-modal-error role="alert" hidden></p>${content}</div>`;
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target.closest("[data-modal-close]"))
      backdrop.remove();
  });
  backdrop.querySelector("form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    const submitLabel = submit?.textContent || "";
    if (submit) submit.disabled = true;
    try {
      await submitHandler(new FormData(event.currentTarget), backdrop);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not save changes.", "error");
      const errorNode = backdrop.querySelector("[data-modal-error]");
      if (errorNode) {
        errorNode.textContent = error.message || "Could not save changes.";
        errorNode.hidden = false;
        errorNode.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      if (submit) { submit.disabled = false; submit.textContent = submitLabel; }
    }
  });
}
function nextOrderStatus(order) {
  return (ORDER_TRANSITIONS[order.status] || []).find(
    (status) => order.orderType !== "Dine-In" || !["Out for Delivery", "Delivered"].includes(status),
  );
}
function renderDashboard() {
  const metrics = adminService.getOverview();
  const values = {
    orders: metrics.totalOrders,
    revenue: formatCurrency(metrics.revenue),
    pending: metrics.pending,
    completed: metrics.completed,
    customers: metrics.customers,
  };
  document.querySelectorAll("[data-metric]").forEach((node) => {
    node.textContent = values[node.dataset.metric] ?? "0";
  });
  const body = document.getElementById("dashboard-orders");
  if (body) {
    const orders = orderService.getOrders().slice(0, 5);
    body.innerHTML = orders.map((order) => {
      const firstItem = order.items?.[0] || {};
      const product = menuService.getProductById(firstItem.productId || firstItem.id);
      const image = firstItem.image || product?.image || firstItem.productSnapshot?.image || "";
      return `<tr><td>${image ? `<img src="${adminEscape(image)}" alt="${adminEscape(firstItem.name || "Ordered item")}" loading="lazy" style="width:56px;height:48px;object-fit:cover;border-radius:6px;">` : "—"}</td><td>${adminEscape(order.id)}</td><td>${adminEscape(firstItem.name || "Order items")}${order.items?.length > 1 ? ` +${order.items.length - 1} more` : ""}</td><td>${adminEscape(order.customerName || "Guest")}</td><td>${adminEscape(order.orderType)}</td><td><span class="badge">${adminEscape(order.status)}</span></td><td>${formatCurrency(order.total)}</td></tr>`;
    }).join("") || '<tr><td colspan="7" class="admin-empty">No orders yet.</td></tr>';
  }
}
function renderOrders() {
  const body = document.getElementById("orders-body");
  if (!body) return;
  const query = (document.getElementById("orders-search")?.value || "")
    .toLowerCase()
    .trim();
  const status = document.getElementById("status-filter")?.value || "All";
  const type = document.getElementById("type-filter")?.value || "All";
  const filter =
    document.querySelector("[data-date-filter].active")?.dataset.dateFilter ||
    "all";
  const now = new Date();
  const day = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const yesterday = day - 86400000;
  const week = day - ((now.getDay() + 6) % 7) * 86400000;
  const all = orderService.getOrders();
  const matchesDate = (order, current) => {
    const time = new Date(order.createdAt).getTime();
    return (
      current === "all" ||
      (current === "today" && time >= day && time < day + 86400000) ||
      (current === "yesterday" && time >= yesterday && time < day) ||
      (current === "week" && time >= week)
    );
  };
  const orders = all.filter(
    (order) =>
      (!query ||
        `${order.id} ${order.customerName || ""} ${order.mobile || ""} ${order.email || ""}`
          .toLowerCase()
          .includes(query)) &&
      (status === "All" || order.status === status) &&
      (type === "All" || order.orderType === type) &&
      matchesDate(order, filter),
  );
  body.innerHTML = orders.length
    ? orders
        .map(
          (order) =>
            `<tr><td>${adminEscape(order.id)}</td><td>${adminEscape(order.customerName || "Guest")}</td><td>${adminEscape(order.orderType)}</td><td>${adminEscape(order.tableNumber || "—")}</td><td><span class="badge">${adminEscape(order.status)}</span></td><td>${formatCurrency(order.total)}</td><td><button class="ghost-btn" type="button" data-update-order="${adminEscape(order.id)}">Open</button>${nextOrderStatus(order) ? ` <button class="primary-btn mini-btn" type="button" data-quick-status="${adminEscape(nextOrderStatus(order))}" data-order-id="${adminEscape(order.id)}">${adminEscape(nextOrderStatus(order))}</button>` : ""}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="7" class="admin-empty">No matching orders.</td></tr>';
  document.querySelectorAll("[data-date-filter]").forEach((button) => {
    const count = all.filter((order) =>
      matchesDate(order, button.dataset.dateFilter),
    ).length;
    const node = button.querySelector("[data-filter-count]");
    if (node) node.textContent = count;
  });
}
function showOrder(orderId) {
  const order = orderService.getOrders().find((item) => item.id === orderId);
  if (!order) return;
  const statuses = [order.status, ...(ORDER_TRANSITIONS[order.status] || [])].filter(
    (status) => order.orderType !== "Dine-In" || status !== "Out for Delivery",
  );
  const items = (order.items || [])
    .map(
      (item) =>
        `<div class="order-detail-row"><span>${adminEscape(item.name)} x${adminEscape(item.qty)}</span><strong>${formatCurrency(Number(item.price) * Number(item.qty))}</strong></div>`,
    )
    .join("");
  adminModal(
    `Order ${adminEscape(order.id)}`,
    `<div class="order-detail-grid"><div><small>Placed</small><strong>${adminDate(order.createdAt)}</strong></div><div><small>Customer</small><strong>${adminEscape(order.customerName || "Guest")}</strong></div><div><small>Mobile</small><strong>${adminEscape(order.mobile || "—")}</strong></div><div><small>Email</small><strong>${adminEscape(order.email || "—")}</strong></div><div><small>Order type</small><strong>${adminEscape(order.orderType)}</strong></div><div><small>${order.orderType === "Dine-In" ? "Table" : "Address"}</small><strong>${adminEscape(order.orderType === "Dine-In" ? order.tableNumber : order.address || "—")}</strong></div></div><h3>Ordered products</h3>${items}<div class="order-detail-total"><span>Total</span><strong>${formatCurrency(order.total)}</strong></div><p class="subtle">Payment: ${adminEscape(order.paymentMethod || "—")}<br>Notes: ${adminEscape(order.notes || "—")}</p><form class="form-grid"><label class="form-field"><span>Current status</span><select class="select" name="status">${statuses.map((item) => `<option ${item === order.status ? "selected" : ""}>${item}</option>`).join("")}</select></label><button class="primary-btn" type="submit">Update Status</button></form>`,
    async (data, backdrop) => {
      const updated = await orderService.updateOrderStatus(
        order.id,
        data.get("status"),
      );
      backdrop.remove();
      renderOrders();
      showToast(`Order ${updated.id} updated to ${updated.status}.`);
    },
  );
}
function renderMenu() {
  const table = document.getElementById("admin-products");
  if (!table) return;
  const products = menuService.getAllProducts();
  const isPreview = products.length === 0;
  const displayedProducts = isPreview ? window.STARTER_PRODUCTS || [] : products;
  const importButton = document.querySelector("[data-import-starter-menu]");
  if (importButton)
    importButton.hidden = !isPreview || !window.STARTER_PRODUCTS?.length;
  const previewNote = document.getElementById("menu-preview-note");
  if (previewNote) {
    previewNote.hidden = !isPreview && authService.isAdmin();
    previewNote.textContent = !authService.isAdmin()
      ? "Sign in with an authorized Firebase admin account to publish or edit menu items."
      : "Starter items can be ordered now. Publish them to Firebase to manage availability and featured status.";
  }
  table.innerHTML = displayedProducts.length
    ? displayedProducts
        .map(
          (product) =>
            `<tr><td><img src="${adminEscape(product.image || '')}" alt="${adminEscape(product.name)}" loading="lazy" style="width:64px;height:48px;object-fit:cover;border-radius:6px;"></td><td>${adminEscape(product.name)}</td><td>${adminEscape(product.category)}</td><td>${formatCurrency(product.price)}</td><td>${isPreview ? "Available" : `<button class="ghost-btn" type="button" data-toggle-product="${adminEscape(product.id)}">${product.available === false ? "Unavailable" : "Available"}</button>`}</td><td>${product.featured ? "Yes" : "No"}</td><td><button class="ghost-btn" type="button" data-edit-product="${adminEscape(product.id)}">Edit</button>${isPreview ? "" : ` <button class="ghost-btn danger-btn" type="button" data-delete-product="${adminEscape(product.id)}">Delete</button>`}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="7" class="admin-empty">No products yet. Add your menu items to publish them on the website.</td></tr>';
}
function editProduct(product) {
  const ingredientString = (product?.ingredients || []).join(", ");
  adminModal(
    product ? "Edit product" : "Add product",
    `<form class="form-grid">${formField("Image URL or base64 image link", "image", product?.image || "", "text", true, 'placeholder="https://... or data:image/jpeg;base64,..." autocomplete="off"')}${formField("Product name", "name", product?.name, "text", true)}${formField("Description", "description", product?.description, "text", true)}${formField("Price (INR)", "price", product?.price, "number", true, 'min="0" step="0.01"')}${formField("Category", "category", product?.category, "text", true)}${formField("Badge", "badge", product?.badge || "")}${formField("Ingredients (comma separated)", "ingredients", ingredientString)}<img data-image-preview src="${adminEscape(product?.image || "")}" alt="Product image preview" ${product?.image ? "" : "hidden"} style="width:160px;height:120px;object-fit:cover;border-radius:6px;"><div class="check-row"><label><input name="available" type="checkbox" ${product?.available !== false ? "checked" : ""}> Available</label><label><input name="featured" type="checkbox" ${product?.featured ? "checked" : ""}> Featured</label><label><input name="vegetarian" type="checkbox" ${product?.vegetarian ? "checked" : ""}> Vegetarian</label></div><button class="primary-btn" type="submit">${product ? "Save Changes" : "Add Product"}</button></form>`,
    async (data, backdrop) => {
      const values = {
        name: String(data.get("name") || "").trim(),
        description: String(data.get("description") || "").trim(),
        price: Number(data.get("price")),
        category: String(data.get("category") || "").trim(),
        badge: String(data.get("badge") || "").trim(),
        ingredients: String(data.get("ingredients") || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        available: data.has("available"),
        featured: data.has("featured"),
        vegetarian: data.has("vegetarian"),
        image: String(data.get("image") || "").trim(),
        imagePath: product?.imagePath || "",
      };
      if (
        !values.name ||
        !values.description ||
        !values.category ||
        !String(data.get("price") || "").trim() ||
        !Number.isFinite(values.price) ||
        values.price < 0
      )
        throw new Error("Complete product details and enter a valid price.");
      let uploaded;
      const dataImage = values.image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([\s\S]+)$/i);
      if (dataImage && values.image.length > 700000) {
        const submit = backdrop.querySelector('[type="submit"]');
        if (submit) submit.textContent = "Preparing image...";
        let imageFile;
        try {
          const binary = atob(dataImage[2].replace(/\s/g, ""));
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
          const mimeType = dataImage[1].toLowerCase();
          const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
          imageFile = new File([bytes], `product-${Date.now()}.${extension}`, { type: mimeType });
        } catch { throw new Error("The base64 image link is invalid."); }
        uploaded = await uploadAdminImage(imageFile, "products", (progress) => {
          if (submit) submit.textContent = `Uploading image ${progress}%...`;
        });
        values.image = uploaded.url;
        values.imagePath = uploaded.path;
      } else if (!dataImage) {
        let imageUrl;
        try { imageUrl = new URL(values.image); }
        catch { throw new Error("Enter an HTTPS image URL or a valid base64 image link."); }
        if (imageUrl.protocol !== "https:") throw new Error("Image links must use HTTPS or a supported base64 image format.");
      }
      const submit = backdrop.querySelector('[type="submit"]');
      if (submit) submit.textContent = product ? "Saving changes..." : "Saving product...";
      if (!menuService.getAllProducts().length && window.STARTER_PRODUCTS?.length) {
        await menuService.saveProducts(window.STARTER_PRODUCTS);
      }
      await menuService.saveProduct(product?.id, values);
      if (uploaded && product?.imagePath && product.imagePath !== uploaded.path) await deleteAdminImage(product.imagePath);
      backdrop.remove();
      showToast(
        product
          ? "Product updated successfully."
          : "Product added successfully.",
      );
    },
  );
  const productForm = document.querySelector(".admin-modal form");
  if (productForm) productForm.noValidate = true;
  const imageInput = document.querySelector(".admin-modal [name='image']");
  const imagePreview = document.querySelector(".admin-modal [data-image-preview]");
  imageInput?.addEventListener("input", () => {
    const value = imageInput.value.trim();
    imagePreview.hidden = !value;
    if (value) imagePreview.src = value;
  });
}
function renderTables() {
  const body = document.getElementById("tables-body");
  if (!body) return;
  body.innerHTML =
      tableService
        .getTables()
        .map(
          (table) =>
            `<tr><td>Table ${adminEscape(table.number)}<small>${adminEscape(table.capacity)} seats · ${adminEscape(table.area)}</small></td><td><span class="badge">${adminEscape(table.status)}</span></td><td><button class="ghost-btn" type="button" data-edit-table="${adminEscape(table.id)}">Edit</button> <button class="ghost-btn danger-btn" type="button" data-delete-table="${adminEscape(table.id)}">Delete</button></td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="3" class="admin-empty">No tables saved in Firebase. Add your café tables here after admin access is configured.</td></tr>';
}
function editTable(table) {
  adminModal(
    table ? "Edit table" : "Add table",
    `<form class="form-grid">${formField("Table number", "number", table?.number, "text", true)}${formField("Capacity", "capacity", table?.capacity || 2, "number", true, 'min="1" step="1"')}${formField("Area", "area", table?.area || "Indoor", "text", true)}<label class="form-field"><span>Status</span><select class="select" name="status">${["Available", "Occupied", "Ordering", "Completed"].map((status) => `<option ${status === (table?.status || "Available") ? "selected" : ""}>${status}</option>`).join("")}</select></label><button class="primary-btn" type="submit">${table ? "Save Changes" : "Add Table"}</button></form>`,
    async (data, backdrop) => {
      const values = {
        number: String(data.get("number") || "").trim(),
        capacity: Number(data.get("capacity")),
        area: String(data.get("area") || "").trim(),
        status: data.get("status"),
      };
      if (
        !values.number ||
        !Number.isInteger(values.capacity) ||
        values.capacity < 1 ||
        !values.area
      )
        throw new Error("Complete table details.");
      await tableService.saveTable(table?.id, values);
      backdrop.remove();
      showToast(
        table ? "Table updated successfully." : "Table added successfully.",
      );
    },
  );
}
function renderCustomers() {
  const body = document.getElementById("customers-body");
  if (!body) return;
  const orders = orderService.getOrders();
  const people = new Map(
    adminService
      .getCustomers()
      .map((user) => [user.uid, { ...user, orders: [] }]),
  );
  orders.forEach((order) => {
    const key = order.customerUid;
    if (!people.has(key))
      people.set(key, {
        uid: key,
        fullName: order.customerName || "Guest",
        email: order.email || "",
        mobile: order.mobile || "",
        orders: [],
      });
    people.get(key).orders.push(order);
  });
  body.innerHTML =
    [...people.values()]
      .map(
        (person) =>
          `<tr><td>${adminEscape(person.fullName || "Guest")}</td><td>${adminEscape(person.email || "—")}</td><td>${adminEscape(person.mobile || "—")}</td><td>${person.orders.length}</td><td>${formatCurrency(person.orders.reduce((sum, order) => sum + Number(order.total || 0), 0))}</td><td>${person.orders[0] ? adminDate(person.orders[0].createdAt) : "—"}</td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="6" class="admin-empty">No customers yet.</td></tr>';
}
function renderAnalytics() {
  const orders = orderService.getOrders();
  const sales = {};
  orders.forEach((order) =>
    (order.items || []).forEach((item) => {
      sales[item.name] = (sales[item.name] || 0) + Number(item.qty || 0);
    }),
  );
  const list = document.getElementById("best-selling");
  if (list)
    list.innerHTML =
      Object.entries(sales)
        .sort((a, b) => b[1] - a[1])
        .map(
          ([name, count]) =>
            `<li>${adminEscape(name)} <strong>${count}</strong></li>`,
        )
        .join("") || "<li>No sales data yet.</li>";
  const daily = new Map();
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    daily.set(date.toISOString().slice(0, 10), {
      label: date.toLocaleDateString("en-IN", { weekday: "short" }),
      revenue: 0,
    });
  }
  orders.forEach((order) => {
    const day = daily.get(String(order.createdAt || "").slice(0, 10));
    if (day && order.status !== "Cancelled")
      day.revenue += Number(order.total || 0);
  });
  const maxRevenue = Math.max(
    1,
    ...[...daily.values()].map((day) => day.revenue),
  );
  const salesChart = document.getElementById("sales-chart");
  if (salesChart)
    salesChart.innerHTML = [...daily.values()]
      .map(
        (day) =>
          `<div style="display:grid;grid-template-columns:36px 1fr auto;gap:10px;align-items:center;"><small>${adminEscape(day.label)}</small><div style="height:12px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;"><div style="height:100%;width:${Math.max(day.revenue ? 4 : 0, (day.revenue / maxRevenue) * 100)}%;background:var(--accent);border-radius:999px;"></div></div><small>${formatCurrency(day.revenue)}</small></div>`,
      )
      .join("");
  const counts = Object.fromEntries(
    ORDER_STATUSES.map((status) => [
      status,
      orders.filter((order) => order.status === status).length,
    ]),
  );
  const maxCount = Math.max(1, ...Object.values(counts));
  const statusChart = document.getElementById("status-chart");
  if (statusChart)
    statusChart.innerHTML =
      ORDER_STATUSES.filter((status) => counts[status])
        .map(
          (status) =>
            `<div style="display:grid;grid-template-columns:minmax(100px,1fr) 2fr 24px;gap:10px;align-items:center;"><small>${adminEscape(status)}</small><div style="height:12px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;"><div style="height:100%;width:${(counts[status] / maxCount) * 100}%;background:var(--accent);border-radius:999px;"></div></div><strong>${counts[status]}</strong></div>`,
        )
        .join("") || '<p class="subtle">No orders yet.</p>';
}
function renderContentForm() {
  const form = document.getElementById("website-content-form");
  if (!form) return;
  const content = websiteContent || {};
  ["heroKicker", "heroTitle", "heroSubtitle", "heroImageUrl"].forEach(
    (name) => {
      const input = form.elements[name];
      if (input && document.activeElement !== input)
        input.value = content[name] || "";
    },
  );
  form.dataset.imagePath = content.heroImagePath || "";
  const preview = document.getElementById("banner-preview");
  if (preview) {
    preview.hidden = !content.heroImageUrl;
    if (content.heroImageUrl) preview.src = content.heroImageUrl;
  }
}
function bindContentForm() {
  const form = document.getElementById("website-content-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const data = new FormData(form);
      const content = {
        heroKicker: String(data.get("heroKicker") || "")
          .trim()
          .slice(0, 80),
        heroTitle: String(data.get("heroTitle") || "")
          .trim()
          .slice(0, 140),
        heroSubtitle: String(data.get("heroSubtitle") || "")
          .trim()
          .slice(0, 500),
        heroImageUrl: String(data.get("heroImageUrl") || "").trim(),
        heroImagePath: form.dataset.imagePath || "",
      };
      if (!content.heroTitle || !content.heroSubtitle)
        throw new Error("Hero title and description are required.");
      const file = data.get("heroImageFile");
      let uploaded;
      if (file?.size) uploaded = await uploadAdminImage(file, "banners");
      if (uploaded) {
        content.heroImageUrl = uploaded.url;
        const previousPath = content.heroImagePath;
        content.heroImagePath = uploaded.path;
        await saveWebsiteContent(content);
        form.dataset.imagePath = uploaded.path;
        if (previousPath) await deleteAdminImage(previousPath);
      } else await saveWebsiteContent(content);
      showToast("Homepage banner and copy updated.");
    } catch (error) {
      showToast(error.message || "Could not update website content.", "error");
    } finally {
      button.disabled = false;
    }
  });
  document
    .getElementById("remove-banner")
    ?.addEventListener("click", async () => {
      try {
        const path = form.dataset.imagePath;
        await saveWebsiteContent({ heroImageUrl: "", heroImagePath: "" });
        form.dataset.imagePath = "";
        const url = form.elements.heroImageUrl;
        if (url) url.value = "";
        if (path) await deleteAdminImage(path);
        renderContentForm();
        showToast("Homepage banner removed.");
      } catch (error) {
        showToast(error.message || "Could not remove banner.", "error");
      }
    });
}

document.addEventListener("DOMContentLoaded", async () => {
  await appReady;
  await authInitialized;
  const page = document.body.dataset.page;
  if (!page?.startsWith("admin-")) return;
  if (page !== "admin-login" && !authService.isAdmin()) {
    const returnPage = { "admin-dashboard": "index", "admin-menu": "menu", "admin-tables": "tables", "admin-orders": "orders", "admin-customers": "customers", "admin-analytics": "analytics" }[page] || "index";
    window.location.replace(`./login.html?return=${returnPage}`);
    return;
  }
  const startedAt = Date.now();
  let knownOrderIds = new Set();
  const notifyNewOrders = () => {
    const ids = new Set(orderService.getOrders().map((order) => order.id));
    if (Date.now() - startedAt > 4000) {
      const fresh = [...ids].filter((id) => !knownOrderIds.has(id));
      if (fresh.length) showToast(fresh.length === 1 ? "New order received." : `${fresh.length} new orders received.`);
    }
    knownOrderIds = ids;
  };
  const refresh = () => {
    if (page === "admin-dashboard") renderDashboard();
    if (page === "admin-orders") renderOrders();
    if (page === "admin-menu") renderMenu();
    if (page === "admin-tables") renderTables();
    if (page === "admin-customers") renderCustomers();
    if (page === "admin-analytics") renderAnalytics();
    if (page === "admin-content") renderContentForm();
  };
  if (page === "admin-orders") {
    ["orders-search", "status-filter", "type-filter"].forEach((id) =>
      document.getElementById(id)?.addEventListener("input", renderOrders),
    );
    document.querySelectorAll("[data-date-filter]").forEach((button) =>
      button.addEventListener("click", () => {
        document
          .querySelectorAll("[data-date-filter]")
          .forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        renderOrders();
      }),
    );
  }
  bindContentForm();
  document.addEventListener("app:data-updated", () => { notifyNewOrders(); refresh(); });
  document.addEventListener("click", async (event) => {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (!authService.isAdmin() && target.matches("[data-add-product], [data-import-starter-menu], [data-toggle-product], [data-edit-product], [data-delete-product], [data-add-table], [data-edit-table], [data-delete-table], [data-update-order]")) {
      const returnPage = { "admin-menu": "menu", "admin-tables": "tables", "admin-orders": "orders" }[page] || "index";
      window.location.href = `./login.html?return=${returnPage}`;
      return;
    }
    if (target.dataset.updateOrder) showOrder(target.dataset.updateOrder);
    if (target.dataset.quickStatus) {
      target.disabled = true;
      try {
        const updated = await orderService.updateOrderStatus(target.dataset.orderId, target.dataset.quickStatus);
        showToast(`Order ${updated.id} ${updated.status.toLowerCase()}.`);
      } catch (error) {
        target.disabled = false;
        showToast(error.message || "Could not update the order.", "error");
      }
    }
    if (target.dataset.editProduct)
      editProduct(menuService.getProductById(target.dataset.editProduct));
    if (target.matches("[data-add-product]")) editProduct();
    if (target.matches("[data-import-starter-menu]")) {
      if (
        menuService.getAllProducts().length ||
        !window.STARTER_PRODUCTS?.length
      )
        return showToast(
          "The menu already has products or the starter catalogue is unavailable.",
          "error",
        );
      adminModal(
        "Import starter menu",
        `<p>Publish the existing 17-item site catalogue to Firestore? You can edit or remove every product afterward. Existing orders will not be imported.</p><form><button class="primary-btn" type="submit">Import Menu</button></form>`,
        async (_, backdrop) => {
          await menuService.saveProducts(window.STARTER_PRODUCTS);
          backdrop.remove();
          showToast("Starter menu published to Firestore.");
        },
      );
    }
    if (target.dataset.toggleProduct) {
      try {
        const product = menuService.getProductById(
          target.dataset.toggleProduct,
        );
        await menuService.saveProduct(product.id, {
          available: product.available === false,
        });
        showToast(
          `Product is now ${product.available === false ? "available" : "unavailable"}.`,
        );
      } catch (error) {
        showToast(error.message || "Could not update product.", "error");
      }
    }
    if (target.dataset.deleteProduct) {
      const product = menuService.getProductById(target.dataset.deleteProduct);
      if (!product) return;
      adminModal(
        "Remove product",
        `<p>Are you sure you want to remove <strong>${adminEscape(product.name)}</strong>?</p><form><button class="primary-btn danger-btn" type="submit">Delete Item</button></form>`,
        async (_, backdrop) => {
          await menuService.deleteProduct(product.id);
          if (product.imagePath) await deleteAdminImage(product.imagePath);
          backdrop.remove();
          showToast("Product removed successfully.");
        },
      );
    }
    if (target.matches("[data-add-table]")) editTable();
    if (target.dataset.editTable)
      editTable(
        tableService
          .getTables()
          .find((table) => table.id === target.dataset.editTable),
      );
    if (target.dataset.deleteTable) {
      const table = tableService
        .getTables()
        .find((item) => item.id === target.dataset.deleteTable);
      if (!table) return;
      adminModal(
        "Remove table",
        `<p>Are you sure you want to remove Table ${adminEscape(table.number)}?</p><form><button class="primary-btn danger-btn" type="submit">Delete Table</button></form>`,
        async (_, backdrop) => {
          await tableService.deleteTable(table.id);
          backdrop.remove();
          showToast("Table removed successfully.");
        },
      );
    }
  });
  refresh();
});
