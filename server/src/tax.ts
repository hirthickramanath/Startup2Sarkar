import { DatabaseAdapter, getSetting } from './db';

/**
 * Statutory deduction engine — deterministic, integer-paise only (no floats anywhere).
 *
 *  • Income-tax TDS on contract payments (s.194C: 1% individuals/HUF, 2% others; 194J: 2%/10%).
 *    The platform default is 2% and is configurable by the Super Admin (basis points).
 *  • GST-TDS (s.51 CGST Act): 2% (1% CGST + 1% SGST/ or 2% IGST) — applies only when the total
 *    contract value exceeds ₹2,50,000. Below the threshold no GST-TDS is withheld.
 *
 * All amounts are bigint paise (₹1 = 100 paise). Rounding is half-up to the nearest paisa.
 */

export interface TaxSettings {
  tdsRateBps: number;
  gstTdsRateBps: number;
  gstTdsThresholdPaise: bigint;
}

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  tdsRateBps: 200,
  gstTdsRateBps: 200,
  gstTdsThresholdPaise: 25_000_000n // ₹2,50,000
};

export interface Deductions {
  grossPaise: bigint;
  tdsPaise: bigint;
  gstTdsPaise: bigint;
  penaltyPaise: bigint;
  netPayablePaise: bigint;
  gstTdsApplied: boolean;
  rates: { tdsRateBps: number; gstTdsRateBps: number };
}

/** amount × bps / 10_000, rounded half-up */
export function bpsOf(amountPaise: bigint, bps: number): bigint {
  if (bps < 0 || !Number.isInteger(bps)) throw new RangeError('bps must be a non-negative integer');
  return (amountPaise * BigInt(bps) + 5000n) / 10_000n;
}

export function computeDeductions(input: {
  grossPaise: bigint;
  contractValuePaise: bigint;
  penaltyPaise?: bigint;
  settings?: TaxSettings;
}): Deductions {
  const s = input.settings ?? DEFAULT_TAX_SETTINGS;
  const penaltyPaise = input.penaltyPaise ?? 0n;
  if (input.grossPaise <= 0n) throw new RangeError('Gross amount must be positive');

  const tdsPaise = bpsOf(input.grossPaise, s.tdsRateBps);
  const gstTdsApplied = input.contractValuePaise > s.gstTdsThresholdPaise;
  const gstTdsPaise = gstTdsApplied ? bpsOf(input.grossPaise, s.gstTdsRateBps) : 0n;
  const netPayablePaise = input.grossPaise - tdsPaise - gstTdsPaise - penaltyPaise;
  if (netPayablePaise < 0n) throw new RangeError('Deductions exceed the gross amount');

  return {
    grossPaise: input.grossPaise,
    tdsPaise,
    gstTdsPaise,
    penaltyPaise,
    netPayablePaise,
    gstTdsApplied,
    rates: { tdsRateBps: s.tdsRateBps, gstTdsRateBps: s.gstTdsRateBps }
  };
}

export async function loadTaxSettings(db: DatabaseAdapter): Promise<TaxSettings> {
  const tds = await getSetting<number>(db, 'tax.tds_rate_bps', DEFAULT_TAX_SETTINGS.tdsRateBps);
  const gst = await getSetting<number>(db, 'tax.gst_tds_rate_bps', DEFAULT_TAX_SETTINGS.gstTdsRateBps);
  const thr = await getSetting<string | number>(
    db,
    'tax.gst_tds_threshold_paise',
    DEFAULT_TAX_SETTINGS.gstTdsThresholdPaise.toString()
  );
  return { tdsRateBps: Number(tds), gstTdsRateBps: Number(gst), gstTdsThresholdPaise: BigInt(thr) };
}
