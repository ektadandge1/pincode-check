(() => {
  const initialize = () => {
    document.querySelectorAll('[data-product-service]').forEach((root) => {
      if (!root.isConnected || root.dataset.productServiceReady === 'true') return;
      root.dataset.productServiceReady = 'true';
      const find = (selector) => root.querySelector(selector);
      const country = find('[data-product-country]');
      const postal = find('[data-product-postal]');
      const button = find('[data-product-check]');
      const status = find('[data-product-status]');
      const result = find('[data-product-result]');
      const eta = find('[data-product-eta]');
      const availability = find('[data-product-availability]');
      const local = find('[data-product-local]');
      const pickup = find('[data-product-pickup]');
      let active;
      let version = 0;
      let disposed = false;
      const savedPostal = (root.dataset.savedPostal || '').trim();
      const showLocal = root.dataset.showLocal !== 'false';
      const showPickup = root.dataset.showPickup !== 'false';
      local.hidden = !showLocal;
      pickup.hidden = !showPickup;
      const setStatus = (message = '', state = '') => {
        status.textContent = message;
        status.dataset.state = state;
      };
      const invalidate = () => {
        version++;
        active?.abort();
        active = null;
        button.disabled = false;
        result.hidden = true;
        setStatus();
      };
      const current = (stamp) => !disposed && root.isConnected && stamp === version;
      const options = window.incodeThemeContext.watch(root, () => {
        const shouldCheck = Boolean(postal.value.trim());
        invalidate();
        if (shouldCheck) void check();
      }, () => {
        disposed = true;
        invalidate();
        delete root.dataset.productServiceReady;
      });
      const render = (data) => {
        const available = data.available === true;
        result.hidden = false;
        find('[data-product-destination]').textContent = `Checked for ${data.postal_code || postal.value.trim()}`;
        availability.textContent = available ? 'Delivery available' : 'Delivery unavailable';
        availability.dataset.available = String(available);
        const hasDate = available && Boolean(data.estimated_date);
        eta.hidden = !hasDate;
        if (hasDate) {
          find('[data-product-eta-copy]').textContent = `${data.processing_days ?? 0} processing + ${data.transit_days ?? 0} transit days`;
          find('[data-product-eta-date]').textContent = data.delivery_date_range || data.estimated_date_max_label || data.estimated_date_label || '';
        }
        if (showLocal) {
          const localAvailable = data.local_delivery_available === true;
          local.dataset.available = String(localAvailable);
          find('[data-product-local-status]').textContent = localAvailable ? 'Available' : 'Not available';
        }
        if (showPickup) {
          const pickupAvailable = data.pickup_available === true;
          pickup.dataset.available = String(pickupAvailable);
          find('[data-product-pickup-status]').textContent = pickupAvailable ? 'Available' : 'Not available';
        }
        find('[data-product-location]').textContent = data.fulfillment_location_name ? `Fulfilled from ${data.fulfillment_location_name}` : '';
        const copy = find('[data-product-pickup-copy]');
        copy.hidden = !data.pickup_instructions;
        copy.textContent = data.pickup_instructions || '';
      };
      async function check() {
        invalidate();
        const stamp = version;
        if (!postal.value.trim()) {
          setStatus('Enter a valid PIN or ZIP code.', 'error');
          postal.focus();
          return;
        }
        const controller = new AbortController();
        active = controller;
        button.disabled = true;
        setStatus('Checking delivery options...', 'loading');
        try {
          const context = window.incodeThemeContext.productContext(root);
          const query = new URLSearchParams({
            country: country.value,
            postal_code: postal.value.trim(),
            surface: 'product',
            productId: root.dataset.productId || '',
            variantId: context.variantId || root.dataset.initialVariant || '',
            qty: String(context.quantity || 1),
          });
          const response = await fetch(`/apps/delivery-checker?${query}`, { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
          const data = await response.json();
          if (!current(stamp)) return;
          if (!response.ok) throw new Error(data.message || 'Unable to check delivery options right now.');
          setStatus();
          render(data);
        } catch (error) {
          if (error.name !== 'AbortError' && current(stamp)) {
            result.hidden = true;
            setStatus(error.message || 'Unable to check delivery options right now.', 'error');
          }
        } finally {
          if (current(stamp)) { active = null; button.disabled = false; }
        }
      }
      button.addEventListener('click', check, options);
      postal.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); void check(); } }, options);
      postal.addEventListener('input', invalidate, options);
      country.addEventListener('change', invalidate, options);
      if (savedPostal && postal.value.trim() === savedPostal) void check();
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
