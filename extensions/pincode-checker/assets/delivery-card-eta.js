(() => {
  const initialize = () => {
  if (window.incodeCardEta) { window.incodeCardEta(); return; }
  const states = new Map();
  const productIds = new Map();
  const cardSelector = 'product-card, .card-wrapper, .product-card, .product-item, .product-grid-item, .grid-product, .product-block, [data-product-card], .grid__item, li[class*="product"], li[class*="grid"]';
  const handleFor = (link) => {
    try { return decodeURIComponent(new URL(link.href, location.href).pathname.match(/\/products\/([^/]+)/)?.[1] || '').toLowerCase(); } catch { return ''; }
  };
  const label = (host, key, range) => {
    let element = [...host.querySelectorAll('[data-inline-eta]')].find((node) => node.dataset.inlineEta === key);
    if (!element) {
      element = document.createElement('p');
      element.dataset.inlineEta = key;
      element.className = 'incode-inline-delivery__label';
      host.append(element);
    }
    if (element.textContent !== `Delivery by ${range}`) element.textContent = `Delivery by ${range}`;
  };
  const render = (root, state) => {
    for (const [key, range] of state.ranges) {
      if (root.dataset.template === 'cart') {
        const item = state.items.find((item) => item.key === key);
        if (!item) continue;
        const lines = new Set(document.querySelectorAll(`[data-key="${CSS.escape(item.lineKey)}"], [data-cart-item-key="${CSS.escape(item.lineKey)}"]`));
        document.querySelectorAll('[name^="updates"]').forEach((input) => {
          if (input.dataset.index === String(item.index) || input.name === `updates[${item.lineKey}]`) {
            const line = input.closest('tr, .cart-item, [data-cart-item]');
            if (line) lines.add(line);
          }
        });
        lines.forEach((line) => label(line.querySelector('.cart-item__details, .cart-item__info') || line, item.lineKey, range));
      } else {
        const cards = new Set();
        document.querySelectorAll('a[href*="/products/"]').forEach((link) => {
          if (handleFor(link) === key) { const card = link.closest(cardSelector); if (card) cards.add(card); }
        });
        cards.forEach((card) => label(card.querySelector('.card__information, .card-information, .product-card__info, .product-item__info, .card-content, .product-card__details') || card, key, range));
      }
    }
  };
  const load = async (root, state) => {
    const current = ++state.version;
    clearTimeout(state.expiryTimer);
    let expiry = 15 * 60 * 1000;
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    state.ranges.clear();
    const previousKeys = new Set(state.items.map((item) => item.lineKey || item.key));
    document.querySelectorAll('[data-inline-eta]').forEach((node) => { if (previousKeys.has(node.dataset.inlineEta)) node.remove(); });
    try {
      let items;
      if (root.dataset.template === 'cart') {
        const cart = await window.incodeThemeContext.freshCart(controller.signal);
        items = cart.map((item, index) => ({ key: `line-${index + 1}`, lineKey: item.key, index: index + 1, productId: item.product_id }));
      } else {
        items = JSON.parse(root.querySelector('[data-inline-items]')?.textContent || '[]');
        if (!Array.isArray(items)) return;
        items.forEach((item) => { if (item.key && /^\d+$/.test(String(item.productId))) productIds.set(item.key, item.productId); });
        const handles = new Set();
        document.querySelectorAll('a[href*="/products/"]').forEach((link) => {
          const card = link.closest(cardSelector);
          const productId = card?.dataset.productId;
          const key = handleFor(link);
          if (!card || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(key)) return;
          handles.add(key);
          if (productId) productIds.set(key, productId);
        });
        // AJAX pagination commonly returns cards without a product-ID attribute.
        await Promise.all([...handles].map(async (key) => {
          if (!productIds.has(key)) {
            const response = await fetch(window.incodeThemeContext.cartUrl(`products/${encodeURIComponent(key)}.js`), { signal: controller.signal, headers: { Accept: 'application/json' } });
            if (!response.ok) return;
            const product = await response.json();
            if (/^\d+$/.test(String(product.id))) productIds.set(key, product.id);
          }
          if (productIds.has(key)) items.push({ key, productId: productIds.get(key) });
        }));
      }
      if (!Array.isArray(items)) return;
      items = [...new Map(items.filter((item) => /^[a-z0-9][a-z0-9-]{0,99}$/.test(item.key) && /^\d+$/.test(String(item.productId))).map((item) => [item.key, item])).values()];
      if (current !== state.version || !root.isConnected) return;
      state.items = items;
      for (let offset = 0; offset < items.length; offset += 24) {
        const response = await fetch('/apps/delivery-checker?batch=1', {
          method: 'POST', signal: controller.signal,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ country: root.dataset.country || 'US', items: items.slice(offset, offset + 24).map(({ key, productId }) => ({ key, productId })) })
        });
        if (!response.ok) throw new Error('Estimate unavailable');
        const data = await response.json();
        if (current !== state.version || !root.isConnected) return;
        for (const entry of data.results || []) {
          const estimate = entry?.estimate;
          if (estimate?.enabled) expiry = Math.min(expiry, window.incodeThemeContext.expiryDelay(estimate));
          const range = estimate?.delivery_date_range || estimate?.estimated_date_max_label || estimate?.estimated_date_label;
          if (estimate?.enabled && range && items.some((item) => item.key === entry.key)) state.ranges.set(entry.key, range);
        }
        render(root, state);
      }
    } catch { /* Leave unavailable estimates absent. */ }
    finally {
      if (current === state.version && root.isConnected && states.has(root)) {
        state.expiryTimer = setTimeout(() => { if (current === state.version && root.isConnected) load(root, state); }, expiry);
      }
    }
  };
  let timer;
  const scan = () => {
    for (const [root, state] of states) {
      if (!root.isConnected) { state.version += 1; state.controller?.abort(); clearTimeout(state.expiryTimer); states.delete(root); }
    }
    document.querySelectorAll('[data-inline-delivery-eta]').forEach((root) => {
      let state = states.get(root);
      const source = root.querySelector('[data-inline-items]')?.textContent || '';
      const signature = source + (root.dataset.template === 'cart'
        ? [...document.querySelectorAll('[name^="updates"], [data-cart-item-key], [data-key]')].map((node) => `${node.name || ''}:${node.value || ''}:${node.dataset.cartItemKey || node.dataset.key || ''}`).join('|')
        : [...document.querySelectorAll('a[href*="/products/"]')].map((link) => `${handleFor(link)}:${link.closest(cardSelector)?.dataset.productId || ''}`).join('|'));
      if (!state) { state = { version: 0, ranges: new Map(), items: [], signature }; states.set(root, state); load(root, state); }
      else if (state.signature !== signature) {
        state.signature = signature;
        if (root.dataset.template === 'cart') document.querySelectorAll('[data-inline-eta]').forEach((node) => { if (node.closest('tr, .cart-item, [data-cart-item]')) node.remove(); });
        load(root, state);
      }
      else render(root, state);
    });
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, 100); };
  const invalidateCart = () => {
    document.querySelectorAll('.incode-inline-delivery__label').forEach((node) => { if (node.closest('tr, .cart-item, [data-cart-item]')) node.remove(); });
    for (const [root, state] of states) if (root.dataset.template === 'cart') load(root, state);
  };
  ['cart:updated', 'cart:refresh', 'cart:change'].forEach((name) => document.addEventListener(name, invalidateCart));
  document.addEventListener('shopify:section:unload', (event) => {
    for (const [root, state] of states) if (event.target?.contains?.(root)) {
      state.version += 1;
      state.controller?.abort();
      clearTimeout(state.expiryTimer);
      states.delete(root);
    }
  });
  document.addEventListener('change', (event) => { if (event.target?.matches?.('[name^="updates"]')) invalidateCart(); });
  new MutationObserver((records) => {
    if (records.some((record) => !record.target.closest?.('.incode-inline-delivery__label') && [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1 && !node.matches('.incode-inline-delivery__label')))) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.incodeCardEta = schedule;
  scan();
  };
  if (window.incodeThemeContext) initialize();
  else {
    const ready = () => {
      if (!window.incodeThemeContext) return;
      document.removeEventListener('incode:theme-context-ready', ready);
      document.removeEventListener('DOMContentLoaded', ready);
      initialize();
    };
    document.addEventListener('incode:theme-context-ready', ready);
    document.addEventListener('DOMContentLoaded', ready, { once: true });
  }
})();
