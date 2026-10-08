(() => {
  const initialize = () => {
    const queriedRoots = document.querySelectorAll?.('.incode-service-card');
    const roots = queriedRoots?.length ? queriedRoots : [document.getElementById?.('incode-service-card-test')].filter(Boolean);
    roots.forEach((root) => {
      if (!root || !root.isConnected || root.dataset.initialized === 'true') return;
      root.dataset.initialized = 'true';
      const country = root.querySelector('select');
      const postal = root.querySelector('input');
      const button = root.querySelector('button');
      const status = root.querySelector('.incode-service-card__status');
      const result = root.querySelector('.incode-service-card__result');
      const local = root.querySelector('[data-service-local]');
      const pickup = root.querySelector('[data-service-pickup]');
      const eta = root.querySelector('[data-service-eta]');
      const cartItems = root.querySelector('[data-service-cart-items]');
      let version = 0;
      let active = null;
      const invalidate = () => {
        version += 1;
        active?.abort();
        active = null;
        button.disabled = false;
        result.hidden = true;
        setStatus('', '');
      };
      const eventOptions = window.incodeThemeContext.watch(root, invalidate, invalidate);
      const rememberPostal = window.incodeThemeContext.postalHistory?.(root, postal, country, eventOptions);
      const variantGid = () => window.incodeThemeContext.productContext(root).variantId;
      const quantity = () => window.incodeThemeContext.productContext(root).quantity;
      const flag = () => {
        const code = String(country.value || '').toUpperCase();
        root.querySelector('[data-service-flag]').textContent = /^[A-Z]{2}$/.test(code)
          ? String.fromCodePoint(...[...code].map((character) => 127397 + character.charCodeAt(0))) : '';
      };
      const params = () => {
        const values = new URLSearchParams({ country: country.value, postal_code: postal.value.trim(), surface: root.dataset.surface || 'product' });
        if (root.dataset.productId) values.set('productId', root.dataset.productId);
        const variant = variantGid();
        if (variant) values.set('variantId', variant);
        values.set('qty', String(quantity()));
        try {
          const items = JSON.parse(cartItems?.textContent || '[]');
          if (Array.isArray(items) && items.length) values.set('cartItems', JSON.stringify(items));
        } catch { /* Ignore malformed cart JSON and use the product context. */ }
        return values;
      };
      const setStatus = (copy, state) => {
        status.textContent = copy;
        if (state) status.dataset.state = state;
        else delete status.dataset.state;
      };
      const render = (data) => {
        result.hidden = false;
        root.querySelector('[data-result-destination]').textContent = `Checked for ${data.postal_code || postal.value.trim()}`;
        root.querySelector('[data-result-availability]').textContent = data.available ? '✓ Delivery available' : 'Delivery unavailable';
        root.querySelector('[data-result-availability]').dataset.available = String(Boolean(data.available));
        if (root.dataset.showEta === 'true' && data.available && data.estimated_date) {
          eta.hidden = false;
          root.querySelector('[data-service-eta-copy]').textContent = `${data.processing_days ?? 0} processing + ${data.transit_days ?? 0} transit days`;
          root.querySelector('[data-service-eta-date]').textContent = data.delivery_date_range || data.estimated_date_max_label || data.estimated_date_label || '';
        } else eta.hidden = true;
        if (root.dataset.showLocal === 'true') {
          local.hidden = false;
          local.dataset.available = String(data.local_delivery_available === true);
          root.querySelector('[data-service-local-status]').textContent = data.local_delivery_available === true ? 'Available' : 'Not available';
        }
        if (root.dataset.showPickup === 'true') {
          pickup.hidden = false;
          pickup.dataset.available = String(data.pickup_available === true);
          root.querySelector('[data-service-pickup-status]').textContent = data.pickup_available === true ? 'Available' : 'Not available';
        }
        root.querySelector('[data-service-location]').textContent = data.fulfillment_location_name ? `Fulfilled from ${data.fulfillment_location_name}` : '';
        const pickupCopy = root.querySelector('[data-service-pickup-copy]');
        pickupCopy.hidden = !data.pickup_instructions;
        pickupCopy.textContent = data.pickup_instructions || '';
      };
      const check = async () => {
        invalidate();
        const current = version;
        const controller = new AbortController();
        active = controller;
        if (!postal.value.trim()) {
          result.hidden = true;
          setStatus('Enter a valid PIN or ZIP code.', 'error');
          postal.focus();
          return;
        }
        button.disabled = true;
        result.hidden = true;
        setStatus('Checking delivery options...', 'loading');
        try {
          const query = params();
          if (root.dataset.surface === 'cart') await window.incodeThemeContext.cartParams(query, controller.signal);
          if (current !== version) return;
          const response = await fetch(`/apps/delivery-checker?${query.toString()}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
          const data = await response.json();
          if (current !== version || !root.isConnected) return;
          if (!response.ok) {
            setStatus(data.message || 'Unable to check this PIN or ZIP code right now.', 'error');
            return;
          }
          setStatus('', '');
          if (data.available || data.local_delivery_available || data.pickup_available) rememberPostal?.(data.postal_code || postal.value);
          render(data);
        } catch (error) {
          if (current !== version && error.name !== 'AbortError') return;
          if (error.name !== 'AbortError') setStatus('Network issue while checking delivery options. Please retry.', 'error');
        } finally {
          if (current === version) { button.disabled = false; active = null; }
        }
      };
      button.addEventListener('click', check, eventOptions);
      postal.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); check(); } }, eventOptions);
      postal.addEventListener('input', invalidate, eventOptions);
      country.addEventListener('change', () => { invalidate(); flag(); }, eventOptions);
      flag();
      if (root.dataset.savedPostal && postal.value.trim() === root.dataset.savedPostal) check();
    });
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
