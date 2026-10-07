(() => {
  if (window.incodeThemeContext) return;
  const cartUrl = (path) => `${window.Shopify?.routes?.root || '/'}${path}`;
  const freshCart = async (signal) => {
    const response = await fetch(cartUrl('cart.js'), { signal, cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Cart unavailable');
    const cart = await response.json();
    if (!Array.isArray(cart.items)) throw new Error('Invalid cart');
    return cart.items;
  };
  const cartParams = async (params, signal) => {
    const items = await freshCart(signal);
    // The current API marks 20 or more lines as incomplete. Never fall back to a single product.
    if (!items.length || items.length >= 20) throw new Error('Unsupported cart context');
    const context = items.map((item) => {
      if (!/^\d+$/.test(String(item.product_id)) || !/^\d+$/.test(String(item.variant_id)) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) throw new Error('Invalid cart line');
      return { productId: String(item.product_id), variantId: `gid://shopify/ProductVariant/${item.variant_id}`, quantity: item.quantity };
    });
    ['productId', 'productVendor', 'productTags', 'collections', 'variantId', 'qty', 'cartItems'].forEach((key) => params.delete(key));
    params.set('cartItems', JSON.stringify(context));
    return params;
  };
  const verifiedForms = new WeakMap();
  const variantGid = (value) => {
    const raw = String(value || '').trim();
    return /^\d+$/.test(raw) ? `gid://shopify/ProductVariant/${raw}` : /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(raw) ? raw : '';
  };
  const productForm = (root) => {
    if (!root.dataset.productId || root.dataset.surface === 'cart') return null;
    const scope = root.closest('.shopify-section, [data-section]');
    const productId = String(root.dataset.productId).replace(/^gid:\/\/shopify\/Product\//, '');
    const matches = (form) => {
      if (form.closest('product-recommendations, [data-product-recommendations], .product-recommendations, quick-add-modal, .quick-add, product-card, .product-card, .card-wrapper, [data-product-card]')) return false;
      const metadata = form.querySelector('[name="product-id"], [name="product_id"]')?.value
        || form.dataset.productId || form.closest('[data-product-id]')?.dataset.productId;
      if (metadata) return String(metadata).replace(/^gid:\/\/shopify\/Product\//, '') === productId;
      if (verifiedForms.get(form) === productId) return true;
      const section = form.closest('.shopify-section, [data-section], [data-product]');
      const variant = form.querySelector('[name="id"], [name="variant"]')?.value;
      for (const node of [section, ...(section?.querySelectorAll('[data-product], script[type="application/json"]') || [])]) {
        if (!node) continue;
        try {
          const data = JSON.parse(node.dataset.product || node.textContent || '{}');
          const product = data.product || data;
          if (String(product.id || '') === productId && (!Array.isArray(product.variants) || product.variants.some((entry) => variantGid(entry.id) === variantGid(variant)))) {
            verifiedForms.set(form, productId);
            return true;
          }
        } catch { /* Theme JSON may contain unrelated section data. */ }
      }
      const selected = variantGid(form.querySelector('[name="id"], [name="variant"]')?.value);
      if (selected && selected === variantGid(root.dataset.initialVariant)) { verifiedForms.set(form, productId); return true; }
      return false;
    };
    const selector = 'form[action*="/cart/add"], form[data-type="add-to-cart-form"]';
    return [...(scope?.querySelectorAll(selector) || [])].find(matches)
      || [...document.querySelectorAll(selector)].find(matches) || null;
  };
  const productContext = (root) => {
    const form = productForm(root);
    const variant = form?.elements?.namedItem('id') || form?.querySelector('[name="id"], [name="variant"]');
    const quantity = form?.elements?.namedItem('quantity') || form?.querySelector('[name="quantity"]');
    const value = Number(quantity?.value || 1);
    return { form, variantId: variantGid(variant?.value) || variantGid(root.dataset.initialVariant), quantity: Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1 };
  };
  const locks = new WeakMap();
  const ownedButtons = new WeakMap();
  const lockButtons = (owner, buttons, disabled) => {
    const next = new Set(disabled ? buttons : []);
    for (const button of ownedButtons.get(owner) || []) {
      if (next.has(button)) continue;
      const lock = locks.get(button);
      lock?.owners.delete(owner);
      if (lock && !lock.owners.size) {
        delete button.dataset.pincodeAtcDisabled;
        button.disabled = lock.disabled;
        if (lock.aria === null && button.getAttribute('aria-disabled') === 'true') button.removeAttribute('aria-disabled');
        locks.delete(button);
      }
    }
    for (const button of next) {
      let lock = locks.get(button);
      if (!lock) {
        lock = { owners: new Set(), aria: button.getAttribute('aria-disabled') ?? null, disabled: button.disabled };
        locks.set(button, lock);
        if (lock.aria === null) button.setAttribute('aria-disabled', 'true');
      }
      lock.owners.add(owner);
      // Do not mutate native disabled: the theme owns inventory and availability state.
      button.dataset.pincodeAtcDisabled = 'true';
    }
    ownedButtons.set(owner, next);
  };
  const cutoffTime = (data) => {
    const seconds = Number(data.seconds_until_cutoff ?? data.cutoff_seconds_remaining);
    if (Number.isFinite(seconds) && seconds >= 0) return Date.now() + seconds * 1000;
    const raw = data.cutoff_at || data.delivery_cutoff_at || data.cutoff_timestamp;
    return raw ? new Date(typeof raw === 'number' && raw < 1000000000000 ? raw * 1000 : raw).getTime() : NaN;
  };
  const expiryDelay = (data) => {
    const remaining = cutoffTime(data) - Date.now();
    // After cutoff (including zero seconds), poll at a bounded business-boundary cadence.
    return remaining > 0 ? Math.max(1000, Math.min(remaining, 15 * 60 * 1000)) : 15 * 60 * 1000;
  };
  const estimateKeys = ['_incode_country', '_incode_postal_code', '_incode_estimated_date', '_incode_estimated_date_max', '_incode_estimated_date_label', '_incode_estimated_date_max_label', '_incode_delivery_date_range', '_incode_dispatch_date', '_incode_eta_message', '_incode_eta_validation'];
  const emptyEstimate = () => Object.fromEntries(estimateKeys.map((key) => [key, '']));
  let attributeQueue = Promise.resolve();
  let intentVersion = 0;
  let intentOwner;
  const queueAttributes = (token, attributes, valid = () => true, snapshot = '') => {
    const current = () => token === intentVersion && valid();
    const write = async () => {
      if (!current()) return;
      if (snapshot) {
        const params = await cartParams(new URLSearchParams());
        if (!current()) return;
        if (params.get('cartItems') !== snapshot) attributes = emptyEstimate();
      }
      const response = await fetch(cartUrl('cart/update.js'), {
        method: 'POST', credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ attributes })
      });
      if (!response.ok) throw new Error('Unable to update delivery attributes');
    };
    attributeQueue = attributeQueue.catch(() => {}).then(write);
    return attributeQueue;
  };
  const invalidateEstimate = (owner) => {
    intentOwner = owner;
    const token = ++intentVersion;
    return { token, write: queueAttributes(token, emptyEstimate()) };
  };
  const releaseEstimate = (owner) => {
    if (intentOwner === owner) return invalidateEstimate(owner).write;
    return attributeQueue;
  };
  const watch = (root, invalidate, cleanup) => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const changed = (event) => {
      if (!event.target?.matches?.('[name="id"], [name="variant"], [name="quantity"], [name^="updates"]')) return;
      const form = productForm(root);
      if (root.dataset.surface === 'cart' || (form && (form.contains(event.target) || event.target.form === form))) {
        previous = context();
        invalidate();
      }
    };
    document.addEventListener('change', changed, options);
    document.addEventListener('input', changed, options);
    ['variant:change', 'variant:changed', 'product:variant-change', 'cart:updated', 'cart:refresh', 'cart:change'].forEach((name) => document.addEventListener(name, () => {
      previous = context();
      invalidate();
    }, options));
    const context = () => {
      if (root.dataset.surface === 'cart') return [...document.querySelectorAll('[name^="updates"]')].map((input) => `${input.name}:${input.value}`).join('|');
      const { form, variantId, quantity } = productContext(root);
      return `${form?.id || ''}:${variantId}:${quantity}`;
    };
    let previous = context();
    const dispose = () => { controller.abort(); observer.disconnect(); cleanup(); };
    const observer = new MutationObserver(() => {
      if (!root.isConnected) { dispose(); return; }
      const next = context();
      if (previous !== next) { previous = next; invalidate(); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });
    document.addEventListener('shopify:section:unload', (event) => { if (event.target?.contains?.(root)) dispose(); }, options);
    return options;
  };
  const postalHistory = (root, input, country, eventOptions) => {
    const list = document.createElement('datalist');
    list.id = `${root.id}-postal-history`;
    input.setAttribute('list', list.id);
    root.append(list);
    const key = () => `incode:postal-history:${String(country.value || '').toUpperCase()}`;
    const read = () => {
      try {
        const records = JSON.parse(window.localStorage.getItem(key()) || '[]');
        if (!Array.isArray(records)) return [];
        return records.filter((record) => record && typeof record.code === 'string'
          && /^[A-Z0-9][A-Z0-9 -]{1,28}[A-Z0-9]$/.test(record.code)
          && Number.isFinite(record.at) && record.at > Date.now() - 30 * 86400000).slice(0, 8);
      } catch { return []; }
    };
    const refresh = () => {
      const prefix = input.value.trim().toUpperCase().replace(/[ -]/g, '');
      const fragment = document.createDocumentFragment();
      read().filter((record) => record.code.replace(/[ -]/g, '').startsWith(prefix)).forEach((record) => {
        const option = document.createElement('option');
        option.value = record.code;
        fragment.append(option);
      });
      list.replaceChildren(fragment);
    };
    input.addEventListener('input', refresh, eventOptions);
    input.addEventListener('focus', refresh, eventOptions);
    country.addEventListener('change', refresh, eventOptions);
    refresh();
    return (code) => {
      const normalized = String(code || '').trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9 -]{1,28}[A-Z0-9]$/.test(normalized)) return;
      try {
        const records = [{ code: normalized, at: Date.now() }, ...read().filter((record) => record.code !== normalized)].slice(0, 8);
        window.localStorage.setItem(key(), JSON.stringify(records));
      } catch { /* Browsing still works when storage is unavailable. */ }
      refresh();
    };
  };
  window.incodeThemeContext = { cartUrl, freshCart, cartParams, productForm, productContext, watch, lockButtons, cutoffTime, expiryDelay, emptyEstimate, queueAttributes, invalidateEstimate, releaseEstimate, postalHistory };
  document.dispatchEvent(new Event('incode:theme-context-ready'));
})();
