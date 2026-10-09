// Keep isolated widget fixtures on the shared request contract without loading the DOM helper.
export const proxyRequest = (fetch) => (root, params, options = {}) => {
  const query = new URLSearchParams(params);
  const init = { method: 'GET', ...options };
  if (query.get('surface') === 'cart' && query.has('cartItems')) {
    init.method = 'POST';
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify({ cartItems: JSON.parse(query.get('cartItems')) });
    query.delete('cartItems');
  }
  const path = root.dataset.proxyPath || '/apps/delivery-checker';
  return fetch(`${path}${query.size ? `?${query}` : ''}`, init);
};
