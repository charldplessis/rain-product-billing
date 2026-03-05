// ── State ──────────────────────────────────────────────────
let categories = [];
let tagTypes = [];
let activeCategoryId = null;
let activeProductId = null;

// ── API ────────────────────────────────────────────────────
const api = {
  get: (url) => fetch(url).then(r => r.json()),
  post: (url, data) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
  put: (url, data) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()),
  delete: (url) => fetch(url, { method: 'DELETE' }).then(r => r.json()),
};

// ── Init ───────────────────────────────────────────────────
async function init() {
  await loadCategories();
  await loadTagTypes();
  bindEvents();
}

// ── Categories ─────────────────────────────────────────────
async function loadCategories() {
  categories = await api.get('/api/categories');
  renderCategories();
}

function renderCategories() {
  const list = document.getElementById('categoryList');
  list.innerHTML = '';
  categories.forEach(cat => {
    const li = document.createElement('li');
    li.dataset.id = cat.id;
    if (cat.id === activeCategoryId) li.classList.add('active');
    li.innerHTML = `
      <a onclick="selectCategory(${cat.id}, '${escHtml(cat.name)}')">
        ${escHtml(cat.name)}
      </a>
      <button class="cat-edit-btn" onclick="editCategory(event, ${cat.id}, '${escHtml(cat.name)}')">✎</button>
    `;
    list.appendChild(li);
  });
}

function selectCategory(id, name) {
  activeCategoryId = id;
  activeProductId = null;
  document.getElementById('topbarTitle').textContent = name;
  document.getElementById('btnAddProduct').classList.remove('hidden');
  document.getElementById('detailPanel').classList.add('hidden');
  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('productsGrid').classList.remove('hidden');
  renderCategories();
  loadProducts(id);
}

async function loadProducts(categoryId) {
  const products = await api.get(`/api/products?category_id=${categoryId}`);
  renderProducts(products);
}

function renderProducts(products) {
  const grid = document.getElementById('productsGrid');
  grid.innerHTML = '';
  if (products.length === 0) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><p>No products in this category yet</p></div>';
    return;
  }
  products.forEach(p => {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.onclick = () => openProduct(p.id);
    card.innerHTML = `
      <div class="product-card-name">${escHtml(p.name)}</div>
      <div class="product-card-desc">${escHtml(p.description || '')}</div>
      <div class="product-card-prices">
        <div class="price-badge">
          <span class="price-label">Excl. VAT</span>
          <span class="price-value">R ${formatNum(p.excl_vat)}</span>
        </div>
        <div class="price-badge">
          <span class="price-label">Incl. VAT</span>
          <span class="price-value incl">R ${formatNum(p.incl_vat)}</span>
        </div>
      </div>
      <div class="product-card-tags" id="card-tags-${p.id}"></div>
    `;
    grid.appendChild(card);
    loadProductTagsForCard(p.id);
  });
}

async function loadProductTagsForCard(productId) {
  const product = await api.get(`/api/products/${productId}`);
  const container = document.getElementById(`card-tags-${productId}`);
  if (!container) return;
  (product.tags || []).forEach(tag => {
    const chip = document.createElement('span');
    chip.className = `tag-chip ${getTagClass(tag.name)}`;
    chip.textContent = tag.name;
    container.appendChild(chip);
  });
}

function getTagClass(tagName) {
  if (tagName === 'Past Item') return 'status-past';
  if (tagName === 'Being Sold') return 'status-active';
  return '';
}

// ── Product Detail ─────────────────────────────────────────
async function openProduct(id) {
  activeProductId = id;
  const product = await api.get(`/api/products/${id}`);
  renderProductDetail(product);
  document.getElementById('detailPanel').classList.remove('hidden');
}

function renderProductDetail(p) {
  document.getElementById('detailBody').innerHTML = `
    <div class="detail-category-badge">${escHtml(p.category_name)}</div>
    <div class="detail-name">${escHtml(p.name)}</div>
    <div class="detail-desc">${escHtml(p.description || 'No description provided.')}</div>
    <div class="detail-prices">
      <div class="detail-price-card">
        <div class="detail-price-label">Excl. VAT</div>
        <div class="detail-price-value">R ${formatNum(p.excl_vat)}</div>
      </div>
      <div class="detail-price-card incl">
        <div class="detail-price-label">Incl. VAT</div>
        <div class="detail-price-value">R ${formatNum(p.incl_vat)}</div>
      </div>
    </div>
    ${renderDetailTags(p.tags)}
  `;
}

function renderDetailTags(tags) {
  if (!tags || tags.length === 0) return '';
  const grouped = {};
  tags.forEach(t => {
    if (!grouped[t.type_name]) grouped[t.type_name] = [];
    grouped[t.type_name].push(t);
  });
  const groups = Object.entries(grouped).map(([typeName, items]) => `
    <div class="detail-tags-group">
      <div class="detail-tags-group-label">${escHtml(typeName)}</div>
      <div class="tags-row">${items.map(t => `<span class="tag-chip ${getTagClass(t.name)}">${escHtml(t.name)}</span>`).join('')}</div>
    </div>
  `).join('');
  return `<div class="detail-tags-section"><div class="detail-tags-title">Tags</div>${groups}</div>`;
}

// ── Add/Edit Category ──────────────────────────────────────
document.getElementById('btnAddCategory').onclick = () => {
  document.getElementById('editCategoryId').value = '';
  document.getElementById('categoryName').value = '';
  document.getElementById('modalCategoryTitle').textContent = 'Add Category';
  showModal('modalCategory');
};

function editCategory(e, id, name) {
  e.stopPropagation();
  document.getElementById('editCategoryId').value = id;
  document.getElementById('categoryName').value = name;
  document.getElementById('modalCategoryTitle').textContent = 'Edit Category';
  showModal('modalCategory');
}

document.getElementById('btnSaveCategory').onclick = async () => {
  const id = document.getElementById('editCategoryId').value;
  const name = document.getElementById('categoryName').value.trim();
  if (!name) return;
  if (id) {
    await api.put(`/api/categories/${id}`, { name });
  } else {
    await api.post('/api/categories', { name });
  }
  hideModal('modalCategory');
  await loadCategories();
};

// ── Add/Edit Product ───────────────────────────────────────
document.getElementById('btnAddProduct').onclick = () => openProductModal();

async function openProductModal(productId = null) {
  document.getElementById('editProductId').value = productId || '';
  document.getElementById('modalProductTitle').textContent = productId ? 'Edit Product' : 'Add Product';

  // Populate category dropdown
  const sel = document.getElementById('productCategory');
  sel.innerHTML = categories.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  if (activeCategoryId) sel.value = activeCategoryId;

  // Reset fields
  document.getElementById('productName').value = '';
  document.getElementById('productDescription').value = '';
  document.getElementById('productExclVat').value = '';
  document.getElementById('productInclVat').value = '';

  // Build tag checkboxes
  renderTagsForm([]);

  if (productId) {
    const p = await api.get(`/api/products/${productId}`);
    sel.value = p.category_id;
    document.getElementById('productName').value = p.name;
    document.getElementById('productDescription').value = p.description || '';
    document.getElementById('productExclVat').value = p.excl_vat;
    document.getElementById('productInclVat').value = p.incl_vat;
    const selectedTagIds = (p.tags || []).map(t => t.id);
    renderTagsForm(selectedTagIds);
  }

  showModal('modalProduct');
}

function renderTagsForm(selectedIds) {
  const grid = document.getElementById('tagsGrid');
  grid.innerHTML = tagTypes.map(tt => `
    <div class="tag-type-group">
      <div class="tag-type-label">${escHtml(tt.name)}</div>
      <div class="tag-options">
        ${(tt.tags || []).map(t => `
          <input type="checkbox" class="tag-option" id="tag-${t.id}" value="${t.id}" ${selectedIds.includes(t.id) ? 'checked' : ''}>
          <label class="tag-option-label" for="tag-${t.id}">${escHtml(t.name)}</label>
        `).join('')}
      </div>
    </div>
  `).join('');
}

document.getElementById('btnSaveProduct').onclick = async () => {
  const id = document.getElementById('editProductId').value;
  const data = {
    category_id: document.getElementById('productCategory').value,
    name: document.getElementById('productName').value.trim(),
    description: document.getElementById('productDescription').value.trim(),
    excl_vat: parseFloat(document.getElementById('productExclVat').value) || 0,
    incl_vat: parseFloat(document.getElementById('productInclVat').value) || 0,
  };
  if (!data.name) return;

  let productId = id;
  if (id) {
    await api.put(`/api/products/${id}`, data);
  } else {
    const result = await api.post('/api/products', data);
    productId = result.id;
  }

  // Save tags
  const checkedTags = [...document.querySelectorAll('.tag-option:checked')].map(el => parseInt(el.value));
  await api.post(`/api/products/${productId}/tags`, { tag_ids: checkedTags });

  hideModal('modalProduct');
  if (activeCategoryId) loadProducts(activeCategoryId);
  if (id && activeProductId) openProduct(activeProductId);
};

// Edit/Delete from detail panel
document.getElementById('btnEditProduct').onclick = () => {
  if (activeProductId) openProductModal(activeProductId);
};

document.getElementById('btnDeleteProduct').onclick = async () => {
  if (!activeProductId) return;
  if (!confirm('Delete this product?')) return;
  await api.delete(`/api/products/${activeProductId}`);
  document.getElementById('detailPanel').classList.add('hidden');
  activeProductId = null;
  if (activeCategoryId) loadProducts(activeCategoryId);
};

document.getElementById('btnBack').onclick = () => {
  document.getElementById('detailPanel').classList.add('hidden');
  activeProductId = null;
};

// ── Tag Types & Tags Manager ───────────────────────────────
async function loadTagTypes() {
  tagTypes = await api.get('/api/tag-types');
}

document.getElementById('btnManageTags').onclick = async () => {
  await loadTagTypes();
  renderTagsManager();
  showModal('modalTags');
};

function renderTagsManager() {
  const body = document.getElementById('tagsManagerBody');
  body.innerHTML = tagTypes.map(tt => `
    <div class="tags-manager-group">
      <div class="tags-manager-group-title">
        ${escHtml(tt.name)}
      </div>
      <div class="tags-manager-list">
        ${(tt.tags || []).map(t => `
          <span class="tag-manager-chip">
            ${escHtml(t.name)}
            <button class="tag-delete-btn" onclick="deleteTag(${t.id})">×</button>
          </span>
        `).join('')}
      </div>
      <div class="add-tag-inline">
        <input type="text" class="form-input" id="newTagInput-${tt.id}" placeholder="New tag name..." />
        <button class="btn-primary" onclick="addTag(${tt.id})">Add</button>
      </div>
    </div>
  `).join('');
}

async function addTag(typeId) {
  const input = document.getElementById(`newTagInput-${typeId}`);
  const name = input.value.trim();
  if (!name) return;
  await api.post('/api/tags', { tag_type_id: typeId, name });
  await loadTagTypes();
  renderTagsManager();
}

async function deleteTag(tagId) {
  if (!confirm('Delete this tag? It will be removed from all products.')) return;
  await api.delete(`/api/tags/${tagId}`);
  await loadTagTypes();
  renderTagsManager();
}

document.getElementById('btnAddTagType').onclick = async () => {
  const name = prompt('New tag group name:');
  if (!name) return;
  await api.post('/api/tag-types', { name });
  await loadTagTypes();
  renderTagsManager();
};

// ── Import ─────────────────────────────────────────────────
document.getElementById('btnImport').onclick = () => {
  document.getElementById('importFile').value = '';
  document.getElementById('importResult').classList.add('hidden');
  showModal('modalImport');
};

document.getElementById('btnDoImport').onclick = async () => {
  const file = document.getElementById('importFile').files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/import', { method: 'POST', body: formData });
    const data = await res.json();
    const resultEl = document.getElementById('importResult');
    resultEl.classList.remove('hidden', 'success', 'error');
    if (data.success) {
      resultEl.classList.add('success');
      resultEl.textContent = `Successfully imported ${data.imported} products.`;
      await loadCategories();
      if (activeCategoryId) loadProducts(activeCategoryId);
    } else {
      resultEl.classList.add('error');
      resultEl.textContent = `Error: ${data.error}`;
    }
  } catch (err) {
    const resultEl = document.getElementById('importResult');
    resultEl.classList.remove('hidden');
    resultEl.classList.add('error');
    resultEl.textContent = `Error: ${err.message}`;
  }
};

// ── Modal helpers ──────────────────────────────────────────
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

function bindEvents() {
  // Close modals via cancel/close buttons
  document.querySelectorAll('[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => hideModal(btn.dataset.modal));
  });
  // Click outside modal
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) hideModal(overlay.id);
    });
  });
}

// ── Utils ──────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function formatNum(n) {
  const num = parseFloat(n) || 0;
  return num.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Start ──────────────────────────────────────────────────
init();
