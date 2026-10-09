(() => {
  if (window.incodeAvailabilityChecker) return;
  const instances = new WeakSet();
  const initialize = () => {
    if (!window.incodeThemeContext) return;
    document.querySelectorAll('.incode-availability').forEach((root) => {
      if (!root.isConnected || instances.has(root)) return;
      instances.add(root);
      root.dataset.ready = 'true';
      const country = root.querySelector('select');
      const postal = root.querySelector('input');
      const button = root.querySelector('button');
      const status = root.querySelector('.incode-availability__status');
      let version = 0;
      let active = null;
      const invalidate = () => {
        version += 1;
        active?.abort();
        active = null;
        button.disabled = false;
        delete status.dataset.state;
        status.textContent = '';
      };
      const eventOptions = window.incodeThemeContext.watch(root, invalidate, () => {
        invalidate();
        instances.delete(root);
        delete root.dataset.ready;
        root.querySelector('[data-incode-postal-history]')?.remove();
      });
      const rememberPostal = window.incodeThemeContext.postalHistory?.(root, postal, country, eventOptions);
      const check = async () => {
        invalidate();
        const code = postal.value.trim();
        if (!code) { status.dataset.state = 'error'; status.textContent = 'Enter your ZIP or postal code first.'; postal.focus(); return; }
        const current = version;
        const controller = new AbortController();
        active = controller;
        button.disabled = true;
        status.dataset.state = 'loading';
        status.textContent = 'Checking delivery availability...';
        try {
          const params = new URLSearchParams({ country: country.value, postal_code: code, surface: root.dataset.surface || 'product' });
          if (root.dataset.surface === 'cart') await window.incodeThemeContext.cartParams(params, controller.signal);
          else {
            const { variantId, quantity } = window.incodeThemeContext.productContext(root);
            if (root.dataset.productId) params.set('productId', root.dataset.productId);
            if (variantId) params.set('variantId', variantId);
            params.set('qty', String(quantity));
          }
          if (current !== version || !root.isConnected) return;
          const response = await window.incodeThemeContext.request(root, params, { signal: controller.signal, headers: { Accept: 'application/json' } });
          const data = await response.json();
          if (current !== version || !root.isConnected) return;
          if (!response.ok || typeof data?.available !== 'boolean') {
            status.dataset.state = 'error';
            status.textContent = data?.message || 'We could not check this code. Please try again.';
            return;
          }
          status.dataset.state = data.available ? 'available' : 'unavailable';
          if (data.available) rememberPostal?.(data.postal_code || code);
          status.textContent = data.available ? `Available for ${data.postal_code || code}.` : `Sorry, delivery is not available for ${data.postal_code || code}.`;
        } catch (error) {
          if (current !== version || !root.isConnected || error.name === 'AbortError') return;
          status.dataset.state = 'error'; status.textContent = 'We could not check this code. Please try again.';
        } finally { if (current === version) { button.disabled = false; active = null; } }
      };
      button.addEventListener('click', check, eventOptions);
      postal.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); check(); } }, eventOptions);
      postal.addEventListener('input', invalidate, eventOptions);
      postal.addEventListener('change', invalidate, eventOptions);
      country.addEventListener('change', invalidate, eventOptions);
      if (root.dataset.savedPostal && postal.value.trim() === root.dataset.savedPostal) check();
    });
  };
  window.incodeAvailabilityChecker = initialize;
  document.addEventListener('incode:theme-context-ready', initialize);
  document.addEventListener('shopify:section:load', initialize);
  new MutationObserver(initialize).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
