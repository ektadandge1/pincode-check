export const SHIPPING_METHOD_KINDS = [
  "standard",
  "express",
  "same_day",
  "next_day",
  "local",
  "pickup",
] as const;

export type ShippingMethodKind = (typeof SHIPPING_METHOD_KINDS)[number];

export function shippingMethodEligible(kind: string, options: {
  express: boolean;
  sameDay: boolean;
  nextDay: boolean;
  local: boolean;
  pickup: boolean;
}): boolean {
  if (kind === "express") return options.express;
  if (kind === "same_day") return options.sameDay;
  if (kind === "next_day") return options.nextDay;
  if (kind === "local") return options.local;
  if (kind === "pickup") return options.pickup;
  return kind === "standard";
}

export function inferShippingMethodKind(name: string): ShippingMethodKind {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\b(same day|same-day)\b/.test(normalized)) return "same_day";
  if (/\b(next day|next-day|overnight)\b/.test(normalized)) return "next_day";
  if (/\b(pickup|pick up|collection)\b/.test(normalized)) return "pickup";
  if (/\b(local|courier)\b/.test(normalized)) return "local";
  if (/\b(express|expedited|priority)\b/.test(normalized)) return "express";
  return "standard";
}

export function shippingMethodHandle(name: string): string {
  const handle = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return handle.length >= 2 ? handle : "shopify-method";
}

export type ShippingMethodFields = {
  name: string;
  handle: string;
  kind: ShippingMethodKind;
  priority: number;
  processingDays: number | null;
  transitDays: number;
  description: string | null;
  customMessage: string | null;
};

export function validateShippingMethodFields(input: Record<string, unknown>):
  | { value: ShippingMethodFields; error?: never }
  | { value?: never; error: string } {
  const name = String(input.name ?? "").trim();
  const handle = String(input.handle ?? "").trim().toLowerCase();
  const kind = String(input.kind ?? "standard");
  const priority = Number(input.priority ?? 100);
  const transitDays = Number(input.transitDays);
  const processingRaw = String(input.processingDays ?? "").trim();
  const processingDays = processingRaw ? Number(processingRaw) : null;
  const description = String(input.description ?? "").trim() || null;
  const customMessage = String(input.customMessage ?? "").trim() || null;

  if (!name || name.length > 100 || !/^[a-z0-9][a-z0-9_-]{1,49}$/.test(handle)) {
    return { error: "Enter a name and a 2-50 character lowercase handle." };
  }
  if (!SHIPPING_METHOD_KINDS.includes(kind as ShippingMethodKind)) {
    return { error: "Invalid shipping method eligibility." };
  }
  if (description && description.length > 250) {
    return { error: "Description must be 250 characters or fewer." };
  }
  if (customMessage && customMessage.length > 500) {
    return { error: "Custom message must be 500 characters or fewer." };
  }
  if (!Number.isInteger(priority) || priority < 0 || priority > 9999
    || !Number.isInteger(transitDays) || transitDays < 0 || transitDays > 60
    || (processingDays !== null
      && (!Number.isInteger(processingDays) || processingDays < 0 || processingDays > 60))) {
    return { error: "Priority must be 0-9999 and ETA days must be 0-60." };
  }

  return {
    value: {
      name,
      handle,
      kind: kind as ShippingMethodKind,
      priority,
      transitDays,
      processingDays,
      description,
      customMessage,
    },
  };
}

export function serializeShippingMethod(
  method: {
    handle: string;
    name: string;
    kind: string;
    description: string | null;
    customMessage: string | null;
    processingDays: number | null;
    transitDays: number;
  },
  estimate: {
    dispatchDate: string;
    dispatchDateLabel: string;
    estimatedDate: string;
    estimatedDateLabel: string;
    processingDays: number;
  },
) {
  return {
    handle: method.handle,
    name: method.name,
    kind: method.kind,
    description: method.description,
    custom_message: method.customMessage,
    dispatch_date: estimate.dispatchDate,
    dispatch_date_label: estimate.dispatchDateLabel,
    estimated_date: estimate.estimatedDate,
    estimated_date_label: estimate.estimatedDateLabel,
    processing_days: estimate.processingDays,
    transit_days: method.transitDays,
  };
}
