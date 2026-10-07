export type DeliveryCacheEntry<T> = { createdAt: number; expiresAt: number; result: T };

export function deliveryCacheEntry<T extends { seconds_until_cutoff?: number }>(result: T, now: number, ttlMs: number): DeliveryCacheEntry<T> | null {
  const seconds = result.seconds_until_cutoff;
  // Zero means today's cutoff has passed. Do not cache dates across local midnight.
  const ttl = seconds === undefined ? ttlMs
    : Number.isFinite(seconds) && seconds > 0 ? Math.min(ttlMs, Math.max(0, seconds * 1000 - 1000)) : 0;
  return ttl > 0 ? { createdAt: now, expiresAt: now + ttl, result } : null;
}

export function readDeliveryCache<T extends { seconds_until_cutoff?: number }>(entry: DeliveryCacheEntry<T>, now: number): T | null {
  if (now >= entry.expiresAt) return null;
  return {
    ...entry.result,
    ...(entry.result.seconds_until_cutoff === undefined ? {} : {
      seconds_until_cutoff: Math.max(0, entry.result.seconds_until_cutoff - Math.ceil(Math.max(0, now - entry.createdAt) / 1000)),
    }),
  };
}
