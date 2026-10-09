(() => {
  if (window.incodeServiceCardInit) { window.incodeServiceCardInit(); return; }
  const instances = new Map();
  const unloaded = new WeakSet();
  const initialize = (event) => {
    if (!window.incodeThemeContext) return;
    for (const [root, cleanup] of instances) if (!root.isConnected) cleanup();
    const queriedRoots = document.querySelectorAll?.('.incode-service-card');
    const roots = queriedRoots?.length ? queriedRoots : [document.getElementById?.('incode-service-card-test')].filter(Boolean);
    roots.forEach((root) => {
      if (event?.type === 'shopify:section:load' && event.target?.contains?.(root)) unloaded.delete(root);
      if (!root || !root.isConnected || instances.has(root) || unloaded.has(root)) return;
      const country = root.querySelector('select');
      const postal = root.querySelector('input');
      const button = root.querySelector('button');
      const status = root.querySelector('.incode-service-card__status');
      const result = root.querySelector('.incode-service-card__result');
      const local = root.querySelector('[data-service-local]');
      const pickup = root.querySelector('[data-service-pickup]');
      const options = root.querySelector('.incode-service-card__options');
      if (!country || !postal || !button || !status || !result) return;
      root.dataset.initialized = 'true';
      if (!root.querySelector('[data-service-forms]')) root.insertAdjacentHTML?.('beforeend', `<div class="incode-service-card__forms" data-service-forms hidden><button type="button" class="incode-service-card__form-back" data-service-form-back>Back to delivery options</button><div data-service-form="local" hidden><p class="incode-service-card__form-status" data-service-local-form-status></p><label><span>Delivery date</span><input data-service-local-date readonly></label><div class="incode-service-card__form-columns"><label><span>First name</span><input data-service-local-field="first_name" autocomplete="given-name"></label><label><span>Last name</span><input data-service-local-field="last_name" autocomplete="family-name"></label></div><label><span>Email</span><input data-service-local-field="email" type="email" autocomplete="email"></label><label><span>Phone Number</span><input data-service-local-field="phone" type="tel" autocomplete="tel"></label></div><div data-service-form="pickup" hidden><p class="incode-service-card__form-status" data-service-pickup-form-status></p><div data-service-pickup-locations></div><label><span>Choose pickup date</span><input data-service-pickup-date type="date"></label><div class="incode-service-card__form-columns"><label><span>First name</span><input data-service-pickup-field="first_name" autocomplete="given-name"></label><label><span>Last name</span><input data-service-pickup-field="last_name" autocomplete="family-name"></label></div><label><span>Collector email</span><input data-service-pickup-field="email" type="email" autocomplete="email"></label><label><span>Phone No</span><input data-service-pickup-field="phone" type="tel" autocomplete="tel"></label></div></div>`);
      const forms = root.querySelector('[data-service-forms]');
      const localForm = root.querySelector('[data-service-form="local"]');
      const pickupForm = root.querySelector('[data-service-form="pickup"]');
      const localFormStatus = root.querySelector('[data-service-local-form-status]');
      const pickupFormStatus = root.querySelector('[data-service-pickup-form-status]');
      const localDate = root.querySelector('[data-service-local-date]');
      const pickupLocations = root.querySelector('[data-service-pickup-locations]');
      const pickupDate = root.querySelector('[data-service-pickup-date]');
      const back = root.querySelector('[data-service-form-back]');
      const eta = root.querySelector('[data-service-eta]');
      const cartItems = root.querySelector('[data-service-cart-items]');
      let version = 0;
      let active = null;
      let formActive = null;
      let latestData = null;
      let disposed = false;
      const events = new AbortController();
      const eventOptions = { signal: events.signal };
      const invalidate = () => {
        version += 1;
        active?.abort();
        formActive?.abort();
        active = null;
        formActive = null;
        button.disabled = false;
        result.hidden = true;
        if (forms) forms.hidden = true;
        if (options) options.hidden = false;
        setStatus('', '');
      };
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        invalidate();
        events.abort();
        instances.delete(root);
        delete root.dataset.initialized;
        root.querySelector('[id$="-postal-history"]')?.remove?.();
      };
      instances.set(root, cleanup);
      window.incodeThemeContext.watch(root, () => { if (!disposed) invalidate(); }, cleanup);
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
        latestData = data;
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
      const showForm = (kind) => {
        if (!forms || !options || (kind === 'local' && local?.dataset.available !== 'true') || (kind === 'pickup' && pickup?.dataset.available !== 'true')) return;
        forms.hidden = false;
        options.hidden = true;
        localForm.hidden = kind !== 'local';
        pickupForm.hidden = kind !== 'pickup';
        if (kind === 'local') {
          localFormStatus.textContent = 'Local delivery is available.';
          localDate.value = latestData?.delivery_date_range || latestData?.estimated_date_max_label || latestData?.estimated_date_label || '';
          return;
        }
        pickupFormStatus.textContent = 'Loading pickup locations...';
        void loadPickupLocations();
      };
      const renderPickupLocations = (data) => {
        pickupLocations.replaceChildren();
        const locations = Array.isArray(data.pickup_locations) ? data.pickup_locations : [];
        for (const location of locations) {
          const label = document.createElement('label');
          label.className = 'incode-service-card__pickup-location';
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = `${root.id}-pickup-location`;
          radio.value = String(location.id);
          const copy = document.createElement('span');
          const title = document.createElement('strong');
          title.textContent = location.name || 'Pickup location';
          const address = document.createElement('small');
          address.textContent = [location.address1, location.address2, location.city, location.province, location.postal_code].filter(Boolean).join(', ');
          copy.append(title, address);
          radio.addEventListener('change', () => {
            const dates = Array.isArray(location.available_dates) ? location.available_dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)) : [];
            pickupDate.value = '';
            pickupDate.disabled = !dates.length;
            pickupDate.min = dates[0] || '';
            pickupDate.max = dates[dates.length - 1] || '';
            pickupDate.dataset.availableDates = dates.join(',');
          }, eventOptions);
          label.append(radio, copy);
          pickupLocations.append(label);
        }
        pickupFormStatus.textContent = locations.length ? 'Choose a pickup location and date.' : (data.message || 'No pickup locations are available.');
      };
      const loadPickupLocations = async () => {
        if (disposed || !root.isConnected) return;
        formActive?.abort();
        const controller = new AbortController();
        formActive = controller;
        try {
          const query = params();
          query.set('service_options', '1');
          if (root.dataset.surface === 'cart') await window.incodeThemeContext.cartParams(query, controller.signal);
          if (disposed || controller.signal.aborted || formActive !== controller || !root.isConnected) return;
          const response = await window.incodeThemeContext.request(root, query, { signal: controller.signal, headers: { Accept: 'application/json' } });
          const data = await response.json();
          if (!response.ok) throw new Error(data.message || 'Unable to load pickup locations.');
          if (disposed || controller.signal.aborted || formActive !== controller || !root.isConnected) return;
          renderPickupLocations(data);
        } catch (error) {
          if (!disposed && root.isConnected && !controller.signal.aborted && formActive === controller && error.name !== 'AbortError') pickupFormStatus.textContent = error.message || 'Unable to load pickup locations.';
        } finally {
          if (formActive === controller) formActive = null;
        }
      };
      const check = async () => {
        if (disposed || !root.isConnected) return;
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
          if (current !== version || disposed || !root.isConnected) return;
          const response = await window.incodeThemeContext.request(root, query, { signal: controller.signal, headers: { Accept: 'application/json' } });
          const data = await response.json();
          if (current !== version || disposed || !root.isConnected) return;
          if (!response.ok) {
            setStatus(data.message || 'Unable to check this PIN or ZIP code right now.', 'error');
            return;
          }
          setStatus('', '');
          if (data.available || data.local_delivery_available || data.pickup_available) rememberPostal?.(data.postal_code || postal.value);
          render(data);
        } catch (error) {
          if (current !== version || disposed || !root.isConnected) return;
          if (error.name !== 'AbortError') setStatus('Network issue while checking delivery options. Please retry.', 'error');
        } finally {
          if (current === version && !disposed && root.isConnected) { button.disabled = false; active = null; }
        }
      };
      for (const [node, label] of [[local, 'Choose local delivery'], [pickup, 'Choose store pickup']]) {
        node?.setAttribute?.('role', 'button');
        node?.setAttribute?.('aria-label', label);
        if (node) node.tabIndex = 0;
      }
      button.addEventListener('click', check, eventOptions);
      local?.addEventListener('click', () => showForm('local'), eventOptions);
      pickup?.addEventListener('click', () => showForm('pickup'), eventOptions);
      local?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showForm('local'); } }, eventOptions);
      pickup?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showForm('pickup'); } }, eventOptions);
      back?.addEventListener('click', () => { forms.hidden = true; options.hidden = false; localForm.hidden = true; pickupForm.hidden = true; }, eventOptions);
      postal.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); check(); } }, eventOptions);
      postal.addEventListener('input', invalidate, eventOptions);
      country.addEventListener('change', () => { invalidate(); flag(); }, eventOptions);
      flag();
      if (root.dataset.savedPostal && postal.value.trim() === root.dataset.savedPostal) check();
    });
  };
  window.incodeServiceCardInit = initialize;
  ['incode:theme-context-ready', 'DOMContentLoaded', 'shopify:section:load'].forEach((name) => document.addEventListener?.(name, initialize));
  document.addEventListener?.('shopify:section:unload', (event) => {
    for (const [root, cleanup] of instances) if (event.target?.contains?.(root)) { unloaded.add(root); cleanup(); }
  });
  if (typeof MutationObserver !== 'undefined' && document.documentElement) new MutationObserver(initialize).observe(document.documentElement, { childList: true, subtree: true });
  initialize();
})();
