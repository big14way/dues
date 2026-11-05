import { USDC_DECIMALS } from './constants';

/** "25" or "25.5" -> base units string ("25000000"). Rejects more than 6 decimals. */
export function parseUsdc(input: string | number): string {
  const s = String(input).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`not an amount: ${s}`);
  const [whole = '0', frac = ''] = s.split('.');
  if (frac.length > USDC_DECIMALS) throw new Error(`USDC has ${USDC_DECIMALS} decimals at most: ${s}`);
  const units = BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt(frac.padEnd(USDC_DECIMALS, '0') || '0');
  return units.toString();
}

/** Base units -> "25.00" (at least 2 decimals, trailing zeros trimmed beyond that). */
export function formatUsdc(units: string | bigint, decimals = USDC_DECIMALS): string {
  const v = BigInt(units);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** Decimal USD string ("25.2527") -> USDC base units, rounded to nearest unit. */
export function usdToUnits(usd: string | number): bigint {
  const n = Number(usd);
  if (!Number.isFinite(n)) return 0n;
  return BigInt(Math.round(n * 10 ** USDC_DECIMALS));
}
