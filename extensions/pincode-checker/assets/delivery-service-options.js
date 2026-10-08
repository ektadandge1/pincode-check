(() => {
  if (window.incodeServiceTabs?.initialize) {
    window.incodeServiceTabs.initialize();
    return;
  }
  const keys = ['_incode_service_type', '_incode_pickup_location_id', '_incode_pickup_location_name', '_incode_pickup_date', '_incode_pickup_first_name', '_incode_pickup_last_name', '_incode_pickup_email', '_incode_pickup_phone', '_incode_service_country', '_incode_service_postal_code'];
  const empty = () => Object.fromEntries(keys.map((key) => [key, '']));
  let writes = Promise.resolve();
  let intent = 0;
  // Writes are never aborted: an invalidation must clear after any in-flight write.
  const queue = (token, attributes, valid, beforeWrite = async () => {}) => {
    writes = writes.catch(() => {}).then(async () => {
      if (token !== intent || !valid()) return false;
      await beforeWrite();
      if (token !== intent || !valid()) return false;
      const response = await fetch(window.incodeThemeContext.cartUrl('cart/update.js'), {
        method: 'POST', credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ attributes })
      });
      if (!response.ok) throw new Error('Unable to save your service selection. Please retry.');
      return token === intent && valid();
    });
    return writes;
  };
  const postalFrom = (address, country) => {
    const patterns = {
      US: '\\d{5}(?:-\\d{4})?', CA: '[ABCEGHJ-NPRSTVXY]\\d[ABCEGHJ-NPRSTV-Z] ?\\d[ABCEGHJ-NPRSTV-Z]\\d',
      GB: '(?:GIR ?0AA|[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[A-Z]{2})', IN: '[1-9]\\d{5}',
      AU: '\\d{4}', NZ: '\\d{4}', DE: '\\d{5}', FR: '\\d{5}', NL: '\\d{4} ?[A-Z]{2}',
      JP: '\\d{3}-?\\d{4}', BR: '\\d{5}-?\\d{3}'
    };
    const value = address.trim().toUpperCase();
    const pattern = patterns[country];
    // For unsupported countries accept only an explicit code, never guess from an address.
    if (!pattern) return /^[A-Z0-9][A-Z0-9-]{1,11}$/.test(value) && /\d/.test(value) ? value : '';
    const matches = [...value.matchAll(new RegExp(`(?:^|[^A-Z0-9])(${pattern})(?=$|[^A-Z0-9])`, 'g'))].map((match) => match[1]);
    return matches.length === 1 ? matches[0] : '';
  };
  const placeAboveCheckout = (root) => {
    if (root.dataset.surface !== 'cart' || root.dataset.checkoutPlacement === 'true') return;
    // Only the first cart block relocates; extra blocks stay in place so two
    // blocks can never ping-pong each other above the checkout button.
    const first = document.querySelectorAll('[data-template="service-tabs"][data-surface="cart"]')[0];
    if (first && first !== root) return;
    const mount = root.closest?.('.shopify-block') || root;
    if (mount.dataset.checkoutPlacement === 'true') {
      root.dataset.checkoutPlacement = 'true';
      return;
    }
    const controls = [...document.querySelectorAll('button[name="checkout"], input[name="checkout"], [data-cart-checkout], .cart__checkout-button, [href$="/checkout"]')];
    const checkout = controls.find((control) => !root.contains?.(control) && control.offsetParent !== null)
      || controls.find((control) => !root.contains?.(control));
    if (!checkout) return;
    const anchor = checkout.closest?.('.cart__ctas, [data-cart-actions]') || checkout;
    if (!anchor.parentNode || mount === anchor || mount.contains?.(anchor)) return;
    if (mount.nextSibling === anchor) {
      root.dataset.checkoutPlacement = 'true';
      mount.dataset.checkoutPlacement = 'true';
      return;
    }
    anchor.parentNode.insertBefore(mount, anchor);
    root.dataset.checkoutPlacement = 'true';
    mount.dataset.checkoutPlacement = 'true';
  };
  const initialize = () => {
    const helper = window.incodeThemeContext;
    if (!helper) return;
    document.querySelectorAll('[data-template="service-tabs"]').forEach((root) => {
      if (!root.isConnected) return;
      placeAboveCheckout(root);
      if (root.dataset.serviceReady === 'true') return;
      root.dataset.serviceReady = 'true';
      const find = (selector) => root.querySelector(selector);
      const cart = root.dataset.surface === 'cart';
      if (!find('[data-status]')) {
        const countrySelect = find('[data-country]');
        const id = root.id;
        const tab = (value, title, svg, checked = '') => `<label><input type="radio" name="${id}-service" value="${value}" ${checked}><span><svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>${title}</span></label>`;
        const error = (name) => `<small id="${id}-${name}-error" data-error="${name}" class="ist-error" hidden></small>`;
        const collector = (name, title, autocomplete, type = 'text', max = 100) => `<label><span class="ist-sr">${title}</span><input data-field="${name}" type="${type}" placeholder="${title}" autocomplete="${autocomplete}" maxlength="${max}" aria-describedby="${id}-${name}-error">${error(name)}</label>`;
        root.innerHTML = `
          <fieldset class="ist-services"><legend class="ist-sr">Delivery service</legend>
            ${tab('shipping', 'Shipping', '<circle cx="12" cy="12" r="9.5"/><path fill="#000" stroke="none" d="m5 5 4-2 3 2-1 3-3 1-1 3-3-1-1-3zm8 5 4-2 4 3-1 4-3 1-2 4-3-2 1-4-2-2z"/>', 'checked')}
            ${root.dataset.showPickup === 'false' ? '' : tab('pickup', 'Store Pickup', '<path d="M3 10h18v11H3zM2 10l2-7h16l2 7M8 21v-7h8v7M7 3l-1 7M12 3v7M17 3l1 7"/>')}
            ${root.dataset.showLocal === 'false' ? '' : tab('delivery', 'Delivery', '<path fill="#000" d="M2 5h12v12H2zM14 9h4l4 5v3h-8"/><circle fill="#000" cx="6" cy="18" r="2"/><circle fill="#000" cx="18" cy="18" r="2"/><path stroke="#fff" d="M4 11h7m-3-3 3 3-3 3"/>')}
          </fieldset>
          <p class="ist-helper">Choose how you would like to receive your order.</p>
          <div data-panel="shipping"></div>
          <div data-panel="pickup" hidden>
            <div data-pickup-filter class="ist-pickup-postal" hidden><label><span class="ist-sr">Pickup ZIP or postcode</span><input data-pickup-postal placeholder="ZIP / postcode" autocomplete="postal-code" maxlength="30" aria-describedby="${id}-pickup_postal-error">${error('pickup_postal')}</label><button type="button" data-filter>Apply</button></div>
            <fieldset class="ist-locations"><legend class="ist-sr">Choose a pickup location</legend><div data-locations></div></fieldset>
            <button type="button" data-retry class="ist-retry" hidden>Retry pickup locations</button>
            <div data-pickup-details hidden>
              <label><span class="ist-sr">Pickup date</span><select data-field="date" aria-label="Pickup date" aria-describedby="${id}-date-error"><option value="">Choose pickup date</option></select>${error('date')}</label>
              <div class="ist-columns">${collector('first_name', 'First name', 'given-name')}${collector('last_name', 'Last name', 'family-name')}</div>
              ${collector('email', 'Collector email', 'email', 'email', 254)}
              ${collector('phone', 'Phone No', 'tel', 'tel', 50)}
            </div>
          </div>
          <div data-panel="delivery" hidden>
            <label class="ist-sr" for="${id}-place">Search for a place or address</label>
            <div class="ist-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></svg><input id="${id}-place" data-address type="text" autocomplete="street-address" placeholder="Search for a place or address" aria-describedby="${id}-address-error"><button type="button" data-clear aria-label="Clear address">&times;</button></div>${error('address')}
            <div data-suggestions class="ist-suggestions" hidden></div>
            <p data-delivery-status class="ist-result-status" role="status" aria-live="polite"></p>
            <button type="button" data-check hidden>Check local delivery</button>
          </div>
          <span data-country-slot hidden></span>
          <p data-status role="status" aria-live="polite"></p>
        `;
        countrySelect.hidden = true;
        find('[data-country-slot]').replaceWith(countrySelect);
      }
      const radios = [...root.querySelectorAll('.ist-services input')];
      const panels = [...root.querySelectorAll('[data-panel]')];
      const status = find('[data-status]');
      const deliveryStatus = find('[data-delivery-status]');
      const retry = find('[data-retry]');
      const check = find('[data-check]');
      const country = find('[data-country]');
      const pickupFilter = find('[data-pickup-filter]');
      const pickupPostal = find('[data-pickup-postal]');
      const address = find('[data-address]');
      const suggestions = find('[data-suggestions]');
      const details = find('[data-pickup-details]');
      const fields = Object.fromEntries(['date', 'first_name', 'last_name', 'email', 'phone'].map((name) => [name, find(`[data-field="${name}"]`)]));
      let service = 'shipping';
      let locations = [];
      let selected = '';
      let version = 0;
      let active;
      let addressTimer;
      let pickupTimer;
      let disposed = false;
      let requiresPostal = false;
      const savedPostal = (root.dataset.savedPostal || '').trim();
      const savedCountry = (root.dataset.savedCountry || '').trim();
      const pickupDisplay = root.dataset.pickupDisplay === 'customer-postal' ? 'customer-postal' : 'all';
      requiresPostal = pickupDisplay === 'customer-postal';
      if (savedPostal && root.dataset.savedAddress) address.value = root.dataset.savedAddress;
      if (savedCountry && [...country.options || []].some((option) => option.value === savedCountry)) country.value = savedCountry;
      if (pickupDisplay === 'customer-postal' && savedPostal) pickupPostal.value = savedPostal;
      const errorFields = { ...fields, address, pickup_postal: pickupPostal };
      const fieldError = (name, message = '') => {
        const input = errorFields[name];
        const error = find(`[data-error="${name}"]`);
        input.setAttribute('aria-invalid', String(Boolean(message)));
        error.textContent = message;
        error.hidden = !message;
      };
      const clearErrors = () => Object.keys(errorFields).forEach((name) => fieldError(name));
      const setDeliveryStatus = (text = '', state = '') => {
        deliveryStatus.textContent = text;
        deliveryStatus.dataset.state = state;
      };
      const clearSuggestion = () => {
        suggestions.replaceChildren();
        suggestions.hidden = true;
      };
      const renderSuggestion = (data) => {
        clearSuggestion();
        const postal = String(data.postal_code || '').trim();
        if (!postal) return;
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'ist-suggestion';
        const pin = document.createElement('span');
        pin.className = 'ist-suggestion__pin';
        pin.setAttribute('aria-hidden', 'true');
        pin.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 22s7-6.1 7-13a7 7 0 1 0-14 0c0 6.9 7 13 7 13Z"/><circle cx="12" cy="9" r="2.5"/></svg>';
        const copy = document.createElement('span');
        const title = document.createElement('strong');
        title.textContent = postal;
        const place = [data.city, data.state || data.province].filter(Boolean).join(', ');
        const subtitle = document.createElement('small');
        const countryName = country.selectedOptions?.[0]?.textContent || country.value;
        subtitle.textContent = [place, countryName].filter(Boolean).join(' · ');
        copy.append(title, subtitle);
        row.append(pin, copy);
        row.addEventListener('click', () => {
          address.value = postal;
          row.dataset.selected = 'true';
          fieldError('address');
        }, options);
        suggestions.append(row);
        suggestions.hidden = false;
      };
      const setStatus = (text = '', state = '') => {
        status.textContent = state === 'error' || state === 'loading' || state === 'success' ? text : '';
        status.dataset.state = state;
        retry.hidden = !(service === 'pickup' && state === 'error');
      };
      const busy = (loading) => {
        [retry, check, find('[data-filter]')].filter(Boolean).forEach((button) => { button.disabled = loading; });
        root.setAttribute('aria-busy', String(loading));
      };
      const invalidate = (reset = false) => {
        clearTimeout(addressTimer);
        clearTimeout(pickupTimer);
        version++;
        active?.abort();
        active = null;
        busy(false);
        setStatus();
        setDeliveryStatus();
        if (reset) {
          clearErrors();
          locations = [];
          selected = '';
          find('[data-locations]').replaceChildren();
          details.hidden = true;
          fields.date.value = '';
        }
        if (cart) {
          const token = ++intent;
          void queue(token, empty(), () => true).catch(() => {
          if (!disposed && token === intent) setStatus('Unable to clear the previous service selection. Please retry.', 'error');
          });
        }
      };
      const current = (stamp) => !disposed && root.isConnected && stamp === version;
      const options = helper.watch(root, () => {
        invalidate(true);
        if (service === 'pickup' && (pickupDisplay === 'all' || savedPostal || pickupPostal.value.trim())) void run();
      }, () => {
        disposed = true;
        invalidate(true);
        delete root.dataset.serviceReady;
      });
      const params = async (signal, pickupSelection = false) => {
        const query = new URLSearchParams({ surface: root.dataset.surface || 'product' });
        if (service === 'pickup') {
          query.set('service_options', '1');
          if (pickupDisplay === 'customer-postal' && !pickupPostal.value.trim()) {
            const message = 'Enter a valid postcode.';
            fieldError('pickup_postal', message);
            pickupPostal.focus();
            const error = new Error(message);
            error.validation = true;
            throw error;
          }
          if (pickupPostal.value.trim()) {
            const postal = postalFrom(pickupPostal.value, country.value);
            if (!postal) {
              const message = 'Enter a valid postcode.';
              fieldError('pickup_postal', message);
              pickupPostal.focus();
              const error = new Error(message);
              error.validation = true;
              throw error;
            }
            query.set('country', country.value);
            query.set('postal_code', postal);
          }
          if (pickupSelection) {
            query.set('pickup_location_id', selected);
            query.set('pickup_date', fields.date.value);
          }
        } else if (service === 'delivery') {
          const postal = postalFrom(address.value, country.value);
          if (!postal) {
            const message = 'Enter a valid postcode.';
            fieldError('address', message);
            address.focus();
            const error = new Error(message);
            error.validation = true;
            throw error;
          }
          query.set('country', country.value);
          query.set('postal_code', postal);
        }
        if (cart) await helper.cartParams(query, signal);
        else {
          const context = helper.productContext(root);
          if (root.dataset.productId) query.set('productId', root.dataset.productId);
          if (context.variantId) query.set('variantId', context.variantId);
          query.set('qty', String(context.quantity));
        }
        return query;
      };
      const request = async (query, signal) => {
        const response = await fetch(`/apps/delivery-checker?${query}`, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
        const data = await response.json();
        if (!response.ok || !data || typeof data !== 'object') throw new Error(data?.message || 'Unable to check service options. Please retry.');
        return data;
      };
      const renderDates = (location) => {
        const dates = (location.available_dates || []).filter((date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date));
        // Dropdown only contains server-approved dates, so blocked dates never display to the customer.
        const select = fields.date;
        select.replaceChildren();
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = dates.length ? 'Choose pickup date' : 'No pickup dates available';
        select.append(placeholder);
        for (const date of dates) {
          const option = document.createElement('option');
          option.value = date;
          try {
            option.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
          } catch {
            option.textContent = date;
          }
          select.append(option);
        }
        select.value = '';
        select.dataset.availableDates = dates.join(',');
      };
      const renderLocations = (data, requestedPostal = false) => {
        if (!Array.isArray(data.pickup_locations)) throw new Error('Unable to load pickup locations. Please retry.');
        if (data.requires_postal_code === true && savedPostal && !requestedPostal) {
          pickupPostal.value = savedPostal;
          requiresPostal = true;
          void run();
          return;
        }
        requiresPostal = data.requires_postal_code === true || pickupDisplay === 'customer-postal';
        const needsInput = requiresPostal && !savedPostal;
        pickupFilter.hidden = !needsInput;
        locations = data.pickup_locations.filter((location) => location && location.id != null && Array.isArray(location.available_dates));
        selected = '';
        details.hidden = true;
        const list = find('[data-locations]');
        list.replaceChildren();
        for (const location of locations) {
          const label = document.createElement('label');
          label.className = 'ist-location';
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = `${root.id}-location`;
          radio.value = String(location.id);
          const copy = document.createElement('span');
          const title = document.createElement('strong');
          title.textContent = location.name || 'Pickup location';
          copy.append(title);
          for (const text of [location.address1, location.address2, [location.city, location.province, location.postal_code].filter(Boolean).join(', '), location.country, location.phone, location.pickup_instructions]) {
            if (!text) continue;
            const line = document.createElement('small');
            line.textContent = text;
            copy.append(line);
          }
          radio.addEventListener('change', () => {
            invalidate();
            selected = radio.value;
            details.hidden = false;
            renderDates(location);
          }, options);
          label.append(radio, copy);
          list.append(label);
        }
        if (!locations.length && (!requiresPostal || requestedPostal)) {
          const emptyState = document.createElement('div');
          emptyState.className = 'ist-empty';
          emptyState.textContent = data.message || 'No pickup locations are available for these items.';
          list.append(emptyState);
        }
        setStatus();
      };
      const pickupValidation = (showErrors = false, only = '') => {
        const location = locations.find((entry) => String(entry.id) === selected);
        let valid = Boolean(location);
        for (const [name, input] of Object.entries(fields)) {
          const value = input.value.trim();
          const digits = value.replace(/\D/g, '').length;
          const validPhone = name !== 'phone' || /^\+?[0-9 ().-]+$/.test(value) && digits >= 7 && digits <= 15;
          const validDate = name !== 'date' || Boolean(location?.available_dates.includes(value));
          const max = name === 'email' ? 254 : name === 'phone' ? 50 : 100;
          const fieldValid = Boolean(value) && value.length <= max && input.checkValidity() && validPhone && validDate;
          valid = valid && fieldValid;
          if (showErrors && (!only || only === name)) {
            const message = fieldValid ? '' : name === 'phone' ? 'Enter a phone number with 7 to 15 digits.' : name === 'date' ? 'Please choose an available pickup date.' : `Enter a valid ${name.replace('_', ' ')}${value.length > max ? ` (maximum ${max} characters)` : ''}.`;
            fieldError(name, message);
          }
        }
        return valid;
      };
      const run = async (savePickup = false) => {
        invalidate();
        if (savePickup && service === 'pickup' && !pickupValidation()) return;
        const stamp = version;
        const token = intent;
        const controller = new AbortController();
        active = controller;
        clearErrors();
        busy(!savePickup);
        if (service === 'delivery') setDeliveryStatus('Checking local delivery...', 'loading');
        else if (!savePickup) setStatus('Checking service options...', 'loading');
        try {
          let attributes = empty();
          let snapshot = '';
          if (service !== 'shipping') {
            const query = await params(controller.signal, savePickup && service === 'pickup');
            if (!current(stamp)) return;
            snapshot = query.get('cartItems') || '';
            const data = await request(query, controller.signal);
            if (!current(stamp)) return;
            if (service === 'pickup') {
              if (!savePickup) { renderLocations(data, query.has('postal_code')); return; }
              const location = Array.isArray(data.pickup_locations) && data.pickup_locations.find((entry) => String(entry.id) === selected);
              if (data.pickup_selection_valid !== true || !location || !location.available_dates?.includes(fields.date.value)) {
                fieldError('date', 'This location or date is no longer available. Retry pickup locations.');
                throw new Error(data.message || 'This pickup location or date is no longer available. Retry pickup locations and select again.');
              }
              attributes._incode_pickup_location_id = selected;
              attributes._incode_pickup_location_name = location.name || '';
              attributes._incode_pickup_date = fields.date.value.trim();
              for (const name of ['first_name', 'last_name', 'email', 'phone']) attributes[`_incode_pickup_${name}`] = fields[name].value.trim();
            } else {
              renderSuggestion(data);
              if (data.local_delivery_available !== true) {
                setDeliveryStatus('Local delivery is not available for this postcode and these items.', 'error');
                return;
              }
              attributes._incode_service_country = query.get('country');
              attributes._incode_service_postal_code = query.get('postal_code');
            }
          }
          if (!cart) {
            if (service === 'delivery') setDeliveryStatus('Local delivery is available.', 'success');
            return;
          }
          if (service !== 'shipping') attributes._incode_service_type = service;
          const saved = await queue(token, attributes, () => current(stamp), async () => {
            if (!snapshot) return;
            const fresh = await helper.cartParams(new URLSearchParams(), controller.signal);
            if (fresh.get('cartItems') !== snapshot) throw new Error('Your cart changed. Please check service options again.');
          });
          if (saved && current(stamp)) {
            if (service === 'delivery') setDeliveryStatus('Local delivery is available.', 'success');
            if (service === 'pickup') setStatus('Pickup details saved.', 'success');
          }
        } catch (error) {
          if (current(stamp) && error.name !== 'AbortError') {
            if (service === 'delivery') {
              if (error.validation) setDeliveryStatus();
              else setDeliveryStatus(error.message || 'Unable to check delivery. Please retry.', 'error');
            } else setStatus(error.message || 'Unable to check service options. Please retry.', 'error');
          }
        } finally {
          if (current(stamp)) { active = null; busy(false); }
        }
      };
      radios.forEach((radio) => radio.addEventListener('change', () => {
        if (!radio.checked) return;
        invalidate(true);
        service = radio.value;
        panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== service; });
        pickupFilter.hidden = service !== 'pickup' || !requiresPostal || Boolean(savedPostal);
        if (service === 'pickup' && (pickupDisplay === 'all' || savedPostal)) void run();
        if (service === 'delivery' && savedPostal) void run();
      }, options));
      const schedulePickup = () => {
        clearTimeout(pickupTimer);
        if (!cart || service !== 'pickup' || !pickupValidation()) return;
        pickupTimer = setTimeout(() => { if (!disposed && service === 'pickup') void run(true); }, 300);
      };
      Object.entries(fields).forEach(([name, field]) => {
        const changed = () => { invalidate(); fieldError(name); schedulePickup(); };
        field.addEventListener('input', changed, options);
        field.addEventListener('change', changed, options);
        field.addEventListener('blur', () => { pickupValidation(true, name); schedulePickup(); }, options);
      });
      address.addEventListener('input', () => {
        invalidate();
        clearSuggestion();
        fieldError('address');
        if (service === 'delivery' && postalFrom(address.value, country.value)) {
          addressTimer = setTimeout(() => { if (!disposed && service === 'delivery') void run(); }, 350);
        }
      }, options);
      pickupPostal.addEventListener('input', () => { invalidate(true); fieldError('pickup_postal'); }, options);
      country.addEventListener('change', () => { invalidate(service === 'pickup'); fieldError('address'); fieldError('pickup_postal'); }, options);
      find('[data-clear]').addEventListener('click', () => { address.value = ''; invalidate(); clearSuggestion(); fieldError('address'); address.focus(); }, options);
      root.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target?.tagName === 'INPUT') {
          event.preventDefault();
          if (event.target === address) void run();
          if (event.target === pickupPostal) void run();
        }
      }, options);
      retry.addEventListener('click', () => run(), options);
      find('[data-filter]').addEventListener('click', () => run(), options);
      check.addEventListener('click', () => run(), options);
      retry.hidden = true;
      if (cart) invalidate(true);
    });
  };
  window.incodeServiceTabs = { initialize };
  document.addEventListener('incode:theme-context-ready', initialize);
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
  document.addEventListener('shopify:section:load', initialize);
  document.addEventListener('shopify:block:select', initialize);
  initialize();
})();
