export function billingReturnUrl(request: Request): string {
  return new URL("/app/plans", request.url).toString();
}
