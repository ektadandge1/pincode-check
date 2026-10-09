(() => {
  if (window.incodeServiceTabs?.initialize) {
    window.incodeServiceTabs.initialize();
    return;
  }
  const keys = ['_incode_service_type', '_incode_pickup_location_id', '_incode_pickup_location_name', '_incode_pickup_date', '_incode_pickup_first_name', '_incode_pickup_last_name', '_incode_pickup_email', '_incode_pickup_phone', '_incode_delivery_date', '_incode_delivery_first_name', '_incode_delivery_last_name', '_incode_delivery_email', '_incode_delivery_phone', '_incode_service_country', '_incode_service_postal_code'];
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
  const initialize = () => {
    const helper = window.incodeThemeContext;
    if (!helper) return;
    document.querySelectorAll('[data-template="service-tabs"]').forEach((root) => {
      if (!root.isConnected) return;
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
         const deliveryCollector = (...args) => collector(...args).replaceAll('data-field=', 'data-delivery-field=').replaceAll(`data-error="${args[0]}"`, `data-error="delivery_${args[0]}"`).replaceAll(`${args[0]}-error`, `delivery_${args[0]}-error`);
        root.innerHTML = `
          <fieldset class="ist-services"><legend class="ist-sr">Delivery service</legend>
            ${tab('shipping', 'Shipping', '<circle cx="12" cy="12" r="9.5"/><path fill="#000" stroke="none" d="m5 5 4-2 3 2-1 3-3 1-1 3-3-1-1-3zm8 5 4-2 4 3-1 4-3 1-2 4-3-2 1-4-2-2z"/>', 'checked')}
            ${root.dataset.showPickup === 'false' ? '' : tab('pickup', 'Store Pickup', '<path d="M3 10h18v11H3zM2 10l2-7h16l2 7M8 21v-7h8v7M7 3l-1 7M12 3v7M17 3l1 7"/>')}
            ${root.dataset.showLocal === 'false' ? '' : tab('delivery', 'Delivery', '<path fill="#000" d="M2 5h12v12H2zM14 9h4l4 5v3h-8"/><circle fill="#000" cx="6" cy="18" r="2"/><circle fill="#000" cx="18" cy="18" r="2"/><path stroke="#fff" d="M4 11h7m-3-3 3 3-3 3"/>')}
          </fieldset>
           <p class="ist-helper">Choose how you would like to receive your order.</p>
           <div data-panel="shipping">
             <div class="ist-shipping-check"><label><span class="ist-sr">Shipping postcode</span><input data-shipping-postal placeholder="PIN / ZIP code" autocomplete="postal-code" maxlength="30"></label><button type="button" data-shipping-check>Check shipping</button></div>
             <p data-shipping-status class="ist-result-status" role="status" aria-live="polite"></p>
             <div data-shipping-result class="ist-shipping-result" hidden><strong>Shipping available</strong><span data-shipping-date></span></div>
           </div>
          <div data-panel="pickup" hidden>
            <div data-pickup-filter class="ist-pickup-postal" hidden><label><span class="ist-sr">Pickup ZIP or postcode</span><input data-pickup-postal placeholder="ZIP / postcode" autocomplete="postal-code" maxlength="30" aria-describedby="${id}-pickup_postal-error">${error('pickup_postal')}</label><button type="button" data-filter>Apply</button></div>
            <fieldset class="ist-locations"><legend class="ist-sr">Choose a pickup location</legend><div data-locations></div></fieldset>
            <button type="button" data-retry class="ist-retry" hidden>Retry pickup locations</button>
             <div data-pickup-details hidden>
               <label><span class="ist-sr">Pickup date</span><div data-date-picker class="ist-date-picker"><button type="button" class="ist-date-trigger" data-date-trigger aria-haspopup="dialog" aria-expanded="false"><span data-date-label>Choose pickup date</span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg></button><div data-date-popover class="ist-date-popover" role="dialog" aria-label="Choose pickup date" hidden><div class="ist-date-nav"><button type="button" data-date-prev aria-label="Previous month">&#8249;</button><strong data-date-month></strong><button type="button" data-date-next aria-label="Next month">&#8250;</button></div><div class="ist-date-weekdays" aria-hidden="true"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div><div data-date-grid class="ist-date-grid" role="grid"></div></div><select class="ist-date-native" data-field="date" aria-label="Pickup date" aria-describedby="${id}-date-error"><option value="">Choose pickup date</option></select></div>${error('date')}</label>
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
             <div data-delivery-details hidden>
               <label><span class="ist-sr">Delivery date and time</span><input data-delivery-field="date" placeholder="Delivery date and time" readonly aria-describedby="${id}-delivery_date-error">${error('delivery_date')}</label>
               <div class="ist-columns">${deliveryCollector('first_name', 'First name', 'given-name')}${deliveryCollector('last_name', 'Last name', 'family-name')}</div>
               ${deliveryCollector('email', 'Email', 'email', 'email', 254)}
               ${deliveryCollector('phone', 'Phone Number', 'tel', 'tel', 50)}
             </div>
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
      const shippingPostal = find('[data-shipping-postal]');
      const shippingCheck = find('[data-shipping-check]');
      const shippingStatus = find('[data-shipping-status]');
      const shippingResult = find('[data-shipping-result]');
      const shippingDate = find('[data-shipping-date]');
      const retry = find('[data-retry]');
      const check = find('[data-check]');
      const country = find('[data-country]');
      const pickupFilter = find('[data-pickup-filter]');
      const pickupPostal = find('[data-pickup-postal]');
      const address = find('[data-address]');
      const suggestions = find('[data-suggestions]');
       const details = find('[data-pickup-details]');
        const fields = Object.fromEntries(['date', 'first_name', 'last_name', 'email', 'phone'].map((name) => [name, find(`[data-field="${name}"]`)]));
        const datePicker = find('[data-date-picker]');
        const dateTrigger = find('[data-date-trigger]');
        const dateLabel = find('[data-date-label]');
        const datePopover = find('[data-date-popover]');
        const dateMonth = find('[data-date-month]');
        const dateGrid = find('[data-date-grid]');
        const datePrev = find('[data-date-prev]');
        const dateNext = find('[data-date-next]');
        let availablePickupDates = [];
        let calendarMonth = null;
       const deliveryDetails = find('[data-delivery-details]');
       const deliveryFields = Object.fromEntries(['date', 'first_name', 'last_name', 'email', 'phone'].map((name) => [name, find(`[data-delivery-field="${name}"]`)]));
      let service = 'shipping';
      let locations = [];
      let selected = '';
      let version = 0;
       let active;
       let suggestionActive;
       let policyActive;
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
       const errorFields = { ...fields, ...Object.fromEntries(Object.entries(deliveryFields).map(([name, input]) => [`delivery_${name}`, input])), address, pickup_postal: pickupPostal };
       const fieldError = (name, message = '') => {
         const input = errorFields[name];
         const error = find(`[data-error="${name}"]`);
         input.setAttribute('aria-invalid', String(Boolean(message)));
         error.textContent = message;
         error.hidden = !message;
       };
       const dateParts = (value) => {
         const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
         return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
       };
       const dateText = (value) => {
         const parts = dateParts(value);
         if (!parts) return 'Choose pickup date';
         try {
           return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
         } catch {
           return value;
         }
       };
       const closeDatePicker = () => {
         if (!datePopover) return;
         datePopover.hidden = true;
         dateTrigger?.setAttribute('aria-expanded', 'false');
       };
       const renderDateCalendar = () => {
         if (!dateGrid || !calendarMonth) return;
         dateGrid.replaceChildren();
         const first = new Date(Date.UTC(calendarMonth.year, calendarMonth.month - 1, 1));
         const startDay = first.getUTCDay();
         const daysInMonth = new Date(Date.UTC(calendarMonth.year, calendarMonth.month, 0)).getUTCDate();
         if (dateMonth) {
           dateMonth.textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
         }
         for (let index = 0; index < startDay; index++) {
           const empty = document.createElement('span');
           empty.className = 'ist-date-empty';
           empty.setAttribute('aria-hidden', 'true');
           dateGrid.append(empty);
         }
         for (let day = 1; day <= daysInMonth; day++) {
           const value = `${calendarMonth.year}-${String(calendarMonth.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
           const button = document.createElement('button');
           button.type = 'button';
           button.className = 'ist-date-day';
           button.textContent = String(day);
           button.setAttribute('role', 'gridcell');
           button.setAttribute('aria-label', dateText(value));
           button.disabled = !availablePickupDates.includes(value);
           if (value === fields.date.value) button.dataset.selected = 'true';
           button.addEventListener('click', () => {
             fields.date.value = value;
             fields.date.dispatchEvent(new Event('change', { bubbles: true }));
             closeDatePicker();
           }, options);
           dateGrid.append(button);
         }
         const firstMonth = dateParts(availablePickupDates[0]);
         const lastMonth = dateParts(availablePickupDates[availablePickupDates.length - 1]);
         const currentMonth = calendarMonth.year * 12 + calendarMonth.month;
         if (datePrev) datePrev.disabled = !firstMonth || currentMonth <= firstMonth.year * 12 + firstMonth.month;
         if (dateNext) dateNext.disabled = !lastMonth || currentMonth >= lastMonth.year * 12 + lastMonth.month;
       };
       const resetDatePicker = () => {
         if (!dateLabel) return;
         dateLabel.textContent = 'Choose pickup date';
         closeDatePicker();
         renderDateCalendar();
       };
       const clearErrors = () => Object.keys(errorFields).forEach((name) => fieldError(name));
       const setDeliveryStatus = (text = '', state = '') => {
         deliveryStatus.textContent = text;
         deliveryStatus.dataset.state = state;
       };
       const hideDeliveryDetails = () => { deliveryDetails.hidden = true; };
      const setShippingStatus = (text = '', state = '') => {
        shippingStatus.textContent = text;
        shippingStatus.dataset.state = state;
      };
      const localDeliveryMessage = (data) => ({
        not_configured: 'Local delivery is not enabled for this location.',
        not_in_zone: 'This postcode is outside the configured delivery zones.',
        no_location_stock: 'These items are not in stock at the delivery location.',
        inventory_unavailable: 'Stock could not be verified right now. Please try again.',
      }[data.local_delivery_reason] || 'Local delivery is not available for this postcode and these items.');
      const clearSuggestion = () => {
        suggestions.replaceChildren();
        suggestions.hidden = true;
      };
      const renderSuggestions = (data) => {
        clearSuggestion();
        const entries = Array.isArray(data?.suggestions) ? data.suggestions : data?.postal_code ? [data] : [];
        const countryName = country.selectedOptions?.[0]?.textContent || country.value;
        for (const entry of entries) {
          const postal = String(entry?.postal_code || '').trim();
          if (!postal) continue;
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
          const place = [entry.city, entry.state || entry.province].filter(Boolean).join(', ');
          const subtitle = document.createElement('small');
          subtitle.textContent = [place, countryName].filter(Boolean).join(' · ');
          copy.append(title, subtitle);
          row.append(pin, copy);
          row.addEventListener('click', () => {
            address.value = postal;
            row.dataset.selected = 'true';
            fieldError('address');
            clearSuggestion();
            void run();
          }, options);
          suggestions.append(row);
        }
        suggestions.hidden = !suggestions.children.length;
      };
      const setStatus = (text = '', state = '') => {
        status.textContent = state === 'error' || state === 'loading' || state === 'success' ? text : '';
        status.dataset.state = state;
        retry.hidden = !(service === 'pickup' && state === 'error');
      };
      const busy = (loading) => {
        [retry, check, shippingCheck, find('[data-filter]')].filter(Boolean).forEach((button) => { button.disabled = loading; });
        root.setAttribute('aria-busy', String(loading));
      };
      const invalidate = (reset = false) => {
        clearTimeout(addressTimer);
        clearTimeout(pickupTimer);
         version++;
         active?.abort();
         suggestionActive?.abort();
         active = null;
         suggestionActive = null;
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
            resetDatePicker();
            deliveryDetails.hidden = true;
           Object.values(deliveryFields).forEach((field) => { field.value = ''; });
        }
        if (cart) {
          const token = ++intent;
          void queue(token, empty(), () => true).catch(() => {
          if (!disposed && token === intent) setStatus('Unable to clear the previous service selection. Please retry.', 'error');
          });
        }
      };
      const current = (stamp) => !disposed && root.isConnected && stamp === version;
      const suggestCities = async (value, stamp) => {
        suggestionActive?.abort();
        const controller = new AbortController();
        suggestionActive = controller;
        try {
          const query = new URLSearchParams({ city_suggestions: '1', country: country.value, city: value.trim() });
          const response = await fetch(`/apps/delivery-checker?${query}`, { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
          const data = await response.json();
          if (current(stamp) && response.ok) renderSuggestions(data);
        } catch (error) {
          if (error.name !== 'AbortError') clearSuggestion();
        } finally {
          if (suggestionActive === controller) suggestionActive = null;
        }
      };
       const options = helper.watch(root, () => {
         invalidate(true);
         void loadServiceAvailability();
         if (service === 'pickup' && (pickupDisplay === 'all' || savedPostal || pickupPostal.value.trim())) void run();
       }, () => {
         disposed = true;
         policyActive?.abort();
         invalidate(true);
         delete root.dataset.serviceReady;
       });
       dateTrigger?.addEventListener('click', () => {
         if (!availablePickupDates.length || !datePopover) return;
         datePopover.hidden = !datePopover.hidden;
         dateTrigger.setAttribute('aria-expanded', String(!datePopover.hidden));
       }, options);
       const shiftCalendar = (amount) => {
         if (!calendarMonth) return;
         const next = new Date(Date.UTC(calendarMonth.year, calendarMonth.month - 1 + amount, 1));
         calendarMonth = { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
         renderDateCalendar();
       };
       datePrev?.addEventListener('click', () => shiftCalendar(-1), options);
       dateNext?.addEventListener('click', () => shiftCalendar(1), options);
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
        } else if (service === 'shipping') {
          const postal = postalFrom(shippingPostal.value, country.value);
          if (!postal) {
            const message = 'Enter a valid postcode.';
            shippingPostal.setAttribute('aria-invalid', 'true');
            shippingPostal.focus();
            const error = new Error(message);
            error.validation = true;
            throw error;
          }
          shippingPostal.removeAttribute('aria-invalid');
          query.set('country', country.value);
          query.set('postal_code', postal);
          query.set('estimate', '1');
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
       const applyServiceAvailability = (data) => {
         const fields = { shipping: 'shipping_available', delivery: 'local_delivery_available', pickup: 'pickup_available' };
         for (const radio of radios) {
           const available = data[fields[radio.value]] !== false;
           radio.disabled = !available;
           const label = radio.closest?.('label') || radio.parentElement;
           if (label) label.hidden = !available;
         }
         const selected = radios.find((radio) => radio.value === service && !radio.disabled)
           || radios.find((radio) => !radio.disabled);
         radios.forEach((radio) => { radio.checked = radio === selected; });
         if (!selected) {
           panels.forEach((panel) => { panel.hidden = true; });
           setStatus('No delivery services are available for these items.', 'error');
           return;
         }
         if (selected.value === service) return;
         service = selected.value;
         panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== service; });
         if (service === 'pickup' && (pickupDisplay === 'all' || savedPostal)) void run();
         if (service === 'delivery' && savedPostal) void run();
       };
       const loadServiceAvailability = async () => {
         policyActive?.abort();
         const controller = new AbortController();
         policyActive = controller;
         try {
           const query = new URLSearchParams({ init: '1', surface: root.dataset.surface || 'product' });
           if (cart) await helper.cartParams(query, controller.signal);
           else {
             const context = helper.productContext(root);
             if (root.dataset.productId) query.set('productId', root.dataset.productId);
             if (context.variantId) query.set('variantId', context.variantId);
             query.set('qty', String(context.quantity));
           }
           const data = await request(query, controller.signal);
           if (!disposed && policyActive === controller) applyServiceAvailability(data);
         } catch (error) {
           if (error.name !== 'AbortError') return;
         } finally {
           if (policyActive === controller) policyActive = null;
         }
       };
       const renderDates = (location) => {
         const dates = (location.available_dates || []).filter((date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date));
         // The calendar only enables server-approved dates, so blocked dates never display as selectable.
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
         availablePickupDates = [...new Set(dates)].sort();
         calendarMonth = dateParts(availablePickupDates[0]);
         if (datePicker) datePicker.dataset.enhanced = 'true';
         if (dateTrigger) dateTrigger.disabled = !availablePickupDates.length;
         if (dateLabel) dateLabel.textContent = availablePickupDates.length ? 'Choose pickup date' : 'No pickup dates available';
         renderDateCalendar();
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
       const deliveryValidation = (showErrors = false, only = '') => {
         let valid = true;
         for (const [name, input] of Object.entries(deliveryFields)) {
           const value = input.value.trim();
           const digits = value.replace(/\D/g, '').length;
           const validPhone = name !== 'phone' || /^\+?[0-9 ().-]+$/.test(value) && digits >= 7 && digits <= 15;
           const max = name === 'email' ? 254 : name === 'phone' ? 50 : 100;
           const fieldValid = Boolean(value) && value.length <= max && input.checkValidity() && validPhone;
           valid = valid && fieldValid;
           if (showErrors && (!only || only === name)) {
             const message = fieldValid ? '' : name === 'phone' ? 'Enter a phone number with 7 to 15 digits.' : `Enter a valid ${name.replace('_', ' ')}${value.length > max ? ` (maximum ${max} characters)` : ''}.`;
             fieldError(`delivery_${name}`, message);
           }
         }
         return valid;
       };
       const run = async (saveDetails = false) => {
         invalidate();
         if (service === 'delivery' && !saveDetails) hideDeliveryDetails();
         if (saveDetails && service === 'pickup' && !pickupValidation()) return;
         if (saveDetails && service === 'delivery' && !deliveryValidation()) return;
        const stamp = version;
        const token = intent;
        const controller = new AbortController();
        active = controller;
        clearErrors();
         busy(!saveDetails);
        if (service === 'delivery') setDeliveryStatus('Checking local delivery...', 'loading');
        else if (service === 'shipping') { setShippingStatus('Checking shipping...', 'loading'); shippingResult.hidden = true; }
         else if (!saveDetails) setStatus('Checking service options...', 'loading');
        try {
          let attributes = empty();
          let snapshot = '';
           const query = await params(controller.signal, saveDetails && service === 'pickup');
          if (!current(stamp)) return;
          snapshot = query.get('cartItems') || '';
          const data = await request(query, controller.signal);
          if (!current(stamp)) return;
          if (service === 'pickup') {
             if (!saveDetails) { renderLocations(data, query.has('postal_code')); return; }
              const location = Array.isArray(data.pickup_locations) && data.pickup_locations.find((entry) => String(entry.id) === selected);
              if (data.pickup_selection_valid !== true || !location || !location.available_dates?.includes(fields.date.value)) {
                fieldError('date', 'This location or date is no longer available. Retry pickup locations.');
                throw new Error(data.message || 'This pickup location or date is no longer available. Retry pickup locations and select again.');
              }
              attributes._incode_pickup_location_id = selected;
              attributes._incode_pickup_location_name = location.name || '';
              attributes._incode_pickup_date = fields.date.value.trim();
              for (const name of ['first_name', 'last_name', 'email', 'phone']) attributes[`_incode_pickup_${name}`] = fields[name].value.trim();
            } else if (service === 'shipping') {
              const shippingAvailable = data.enabled === true;
              if (!shippingAvailable) {
                setShippingStatus(data.message || 'Shipping is not available for this postcode.', 'error');
                shippingResult.hidden = true;
                return;
              }
              shippingStatus.textContent = '';
              shippingStatus.dataset.state = 'success';
              shippingResult.hidden = false;
              shippingDate.textContent = data.delivery_date_range || data.estimated_date_max_label || data.estimated_date_label || '';
          } else {
              renderSuggestions(data);
             if (data.local_delivery_available !== true) {
               hideDeliveryDetails();
               setDeliveryStatus(localDeliveryMessage(data), 'error');
               return;
             }
             const deliveryDate = data.delivery_date_range || data.estimated_date_max_label || data.estimated_date_label || '';
             deliveryFields.date.value = deliveryDate;
             deliveryFields.date.dataset.available = String(Boolean(deliveryDate));
             deliveryDetails.hidden = false;
             if (!saveDetails) {
               setDeliveryStatus('Local delivery is available.', 'success');
               return;
             }
             attributes._incode_service_country = query.get('country');
             attributes._incode_service_postal_code = query.get('postal_code');
             attributes._incode_delivery_date = deliveryDate;
             for (const name of ['first_name', 'last_name', 'email', 'phone']) attributes[`_incode_delivery_${name}`] = deliveryFields[name].value.trim();
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
            if (service === 'shipping') setShippingStatus('', '');
            if (service === 'pickup') setStatus('Pickup details saved.', 'success');
          }
        } catch (error) {
          if (current(stamp) && error.name !== 'AbortError') {
             if (service === 'delivery') {
               hideDeliveryDetails();
               if (error.validation) setDeliveryStatus();
              else setDeliveryStatus(error.message || 'Unable to check delivery. Please retry.', 'error');
            } else if (service === 'shipping') {
              setShippingStatus(error.validation ? '' : (error.message || 'Unable to check shipping. Please retry.'), error.validation ? '' : 'error');
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
        if (service === 'shipping' && shippingPostal.value.trim()) void run();
      }, options));
      const schedulePickup = () => {
        clearTimeout(pickupTimer);
        if (!cart || service !== 'pickup' || !pickupValidation()) return;
        pickupTimer = setTimeout(() => { if (!disposed && service === 'pickup') void run(true); }, 300);
      };
       Object.entries(fields).forEach(([name, field]) => {
         const changed = () => { invalidate(); if (name === 'date') { if (dateLabel) dateLabel.textContent = dateText(field.value); renderDateCalendar(); } fieldError(name); schedulePickup(); };
        field.addEventListener('input', changed, options);
        field.addEventListener('change', changed, options);
         field.addEventListener('blur', () => { pickupValidation(true, name); schedulePickup(); }, options);
       });
       Object.entries(deliveryFields).forEach(([name, field]) => {
         if (name === 'date') return;
         const changed = () => { invalidate(); fieldError(`delivery_${name}`); if (cart && service === 'delivery' && deliveryFields.date.value) { clearTimeout(pickupTimer); if (deliveryValidation()) pickupTimer = setTimeout(() => { if (!disposed && service === 'delivery') void run(true); }, 300); } };
         field.addEventListener('input', changed, options);
         field.addEventListener('blur', () => { deliveryValidation(true, name); }, options);
       });
      address.addEventListener('input', () => {
        invalidate();
        clearSuggestion();
        fieldError('address');
        if (service === 'delivery') {
          const postal = postalFrom(address.value, country.value);
          const value = address.value.trim();
          const stamp = version;
          if (postal) addressTimer = setTimeout(() => { if (!disposed && service === 'delivery') void run(); }, 350);
          else if (value.length >= 2) addressTimer = setTimeout(() => { if (!disposed && service === 'delivery') void suggestCities(value, stamp); }, 250);
        }
      }, options);
      shippingPostal.addEventListener('input', () => {
        invalidate();
        shippingPostal.removeAttribute('aria-invalid');
        setShippingStatus();
        shippingResult.hidden = true;
      }, options);
      shippingPostal.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); void run(); } }, options);
      pickupPostal.addEventListener('input', () => { invalidate(true); fieldError('pickup_postal'); }, options);
      country.addEventListener('change', () => {
        invalidate(service === 'pickup');
        fieldError('address');
        fieldError('pickup_postal');
        if (service === 'shipping') shippingResult.hidden = true;
      }, options);
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
      shippingCheck.addEventListener('click', () => run(), options);
       retry.hidden = true;
       if (cart) invalidate(true);
       void loadServiceAvailability();
        if (savedPostal) {
        shippingPostal.value = savedPostal;
        void run();
      }
    });
  };
  window.incodeServiceTabs = { initialize };
  document.addEventListener('incode:theme-context-ready', initialize);
  document.addEventListener('DOMContentLoaded', initialize, { once: true });
  document.addEventListener('shopify:section:load', initialize);
  document.addEventListener('shopify:block:select', initialize);
  initialize();
})();
