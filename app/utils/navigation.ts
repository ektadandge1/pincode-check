export function requiresDocumentNavigation(
  url: string,
  options: { external?: boolean; target?: string; download?: string | boolean } = {},
): boolean {
  return Boolean(
    options.external
    || (options.target && options.target !== "_self")
    || options.download
    || /^(?:https?:)?\/\//i.test(url)
    || /^(?:mailto|tel):/i.test(url)
    || /^\/app\/(?:delivery-export|import-errors\/)/.test(url),
  );
}
