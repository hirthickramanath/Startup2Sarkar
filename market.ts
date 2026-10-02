import { z } from 'zod';

/**
 * Market snapshot for the assistant — fetched by the SERVER from ONE fixed, allow-listed host.
 * The AI model never fetches anything itself, and no user-supplied URL is ever requested.
 *
 * Source: Frankfurter (api.frankfurter.dev) republishing European Central Bank reference rates.
 * These are official DAILY reference rates (published ~16:00 CET on working days), not live trading quotes.
 * For genuinely real-time quotes you need a licensed provider (e.g. an NSE/BSE data vendor); add it behind this same interface.
 */
export interface MarketSnapshot {
  /** Date the rates are for (ECB publication date) */
  asOf: string;
  source: string;
  basis: string;
  fetchedAt: string;
  stale: boolean;
  usdInr: number;
  eurInr: number | null;
  gbpInr: number | null;
}

const ALLOWED_HOST = 'api.frankfurter.dev';
const FEED_URL = `https://${ALLOWED_HOST}/v1/latest?base=USD&symbols=INR,EUR,GBP`;
const TTL_MS = 30 * 60 * 1000; // rates change once a day; 30 min cache is plenty
const MAX_STALE_MS = 72 * 3600 * 1000; // serve a stale snapshot (flagged) for up to 3 days if the feed is down

const feedSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rates: z.object({
    INR: z.number().positive().finite(),
    EUR: z.number().positive().finite().optional(),
    GBP: z.number().positive().finite().optional()
  })
});

let cache: { snap: MarketSnapshot; at: number } | null = null;
export function _resetMarketCache() { cache = null; }

export function marketEnabled(): boolean {
  return (process.env.MARKET_DATA || 'on').toLowerCase() !== 'off';
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export async function getMarketSnapshot(fetchImpl?: typeof fetch): Promise<MarketSnapshot | null> {
  if (!marketEnabled()) return null;
  // Tests must never touch the network unless they inject a fake fetch
  if (!fetchImpl && process.env.NODE_TEST_CONTEXT) return null;
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.snap;

  try {
    if (new URL(FEED_URL).host !== ALLOWED_HOST) throw new Error('feed host not allow-listed');
    const res = await (fetchImpl || fetch)(FEED_URL, { signal: AbortSignal.timeout(4000), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`market feed HTTP ${res.status}`);
    const parsed = feedSchema.parse(await res.json()); // anything unexpected is rejected, never passed to the model
    const { INR, EUR, GBP } = parsed.rates;
    const snap: MarketSnapshot = {
      asOf: parsed.date,
      source: 'ECB reference rates via Frankfurter',
      basis: 'Official daily reference rates (not live trading quotes)',
      fetchedAt: new Date(now).toISOString(),
      stale: false,
      usdInr: round(INR, 2),
      eurInr: EUR ? round(INR / EUR, 2) : null,
      gbpInr: GBP ? round(INR / GBP, 2) : null
    };
    cache = { snap, at: now };
    return snap;
  } catch {
    if (cache && now - cache.at < MAX_STALE_MS) return { ...cache.snap, stale: true };
    return null;
  }
}
