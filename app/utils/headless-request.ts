const COUNTRY_CODES = new Set("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "));

export class HeadlessRequestError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function parseHeadlessDeliveryInput(body: unknown, estimate = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HeadlessRequestError("invalid_request", "A JSON object is required.");
  }
  const value = body as Record<string, unknown>;
  const allowed = new Set(["country", "postal_code", "product_id", "variant_id", "quantity", "cod_requested"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new HeadlessRequestError("invalid_request", "Unsupported request field.");
  }
  if (typeof value.country !== "string" || !/^[A-Za-z]{2}$/.test(value.country) || !COUNTRY_CODES.has(value.country.toUpperCase())) {
    throw new HeadlessRequestError("invalid_country", "country must be a two-letter country code.");
  }
  if (!estimate && (typeof value.postal_code !== "string" || !value.postal_code.trim() || value.postal_code.length > 30)) {
    throw new HeadlessRequestError("invalid_postal_code", "postal_code is required and must be a string.");
  }
  if (estimate && value.postal_code !== undefined && (typeof value.postal_code !== "string" || value.postal_code.length > 30)) {
    throw new HeadlessRequestError("invalid_postal_code", "postal_code must be a string of at most 30 characters.");
  }
  for (const [field, kind] of [["product_id", "Product"], ["variant_id", "ProductVariant"]]) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || !new RegExp(`^(?:[0-9]+|gid://shopify/${kind}/[0-9]+)$`).test(value[field] as string))) {
      throw new HeadlessRequestError("invalid_product_context", `${field} must be a numeric ID or matching Shopify GID.`);
    }
  }
  const quantity = value.quantity === undefined ? 1 : value.quantity;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    throw new HeadlessRequestError("invalid_quantity", "quantity must be an integer between 1 and 999.");
  }
  if (value.cod_requested !== undefined && typeof value.cod_requested !== "boolean") {
    throw new HeadlessRequestError("invalid_request", "cod_requested must be boolean.");
  }
  return {
    country: value.country.toUpperCase(),
    postalCode: typeof value.postal_code === "string" ? value.postal_code.trim() : undefined,
    productId: value.product_id as string | undefined,
    variantId: value.variant_id as string | undefined,
    quantity,
    codRequested: value.cod_requested === true,
  };
}
