import morgan from "morgan";

// React Router's serve CLI uses Morgan's `tiny` format, whose default `:url`
// token logs query strings. Shopify embeds session and identity tokens there.
export function requestPathWithoutQuery(request) {
  const url = request.originalUrl || request.url || "/";
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

morgan.token("url", requestPathWithoutQuery);
