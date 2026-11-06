import { TX_KIND_LABEL, formatUsdc, type Invoice, type TxRecord } from '@dues/core';
import { chainName } from '@dues/widget/tokens';

const DAY = 86_400_000;

/** "1,500.00" from base units. */
export function money(units: string | bigint): string {
  const [whole, frac = '00'] = formatUsdc(units).split('.');
  return `${Number(whole).toLocaleString('en-US')}.${frac.length < 2 ? frac.padEnd(2, '0') : frac}`;
}

/** "$1,500.00": display rounds to cents; the CSV keeps exact USDC units. */
export function usd(units: string | bigint): string {
  const n = Number(formatUsdc(units));
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function day(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function dayShort(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function relative(ms: number, now = Date.now()): string {
  const d = Math.round((ms - now) / DAY);
  if (d === 0) {
    const h = Math.round((ms - now) / 3_600_000);
    if (h === 0) return 'now';
    return h > 0 ? `in ${h} h` : `${-h} h ago`;
  }
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function short(hash: string, n = 6): string {
  return hash.length > n * 2 + 1 ? `${hash.slice(0, n)}…${hash.slice(-4)}` : hash;
}

export type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'info';

export interface StatusView {
  label: string;
  tone: Tone;
  /** One plain sentence about where the money is. */
  sentence: string;
}

export function paymentOf(inv: Invoice): TxRecord | undefined {
  return [...inv.txs].reverse().find((t) => t.kind === 'intent' || t.kind === 'direct' || t.kind === 'pull');
}

export function methodLine(t: TxRecord): string {
  if (t.kind === 'intent') return `NEAR Intents, paid from ${chainName(t.origin_chain ?? 'another chain')}`;
  return TX_KIND_LABEL[t.kind];
}

export function statusOf(inv: Invoice, now = Date.now()): StatusView {
  if (inv.retainer) {
    const escrow = BigInt(inv.escrow_usdc);
    const months = escrow / BigInt(inv.amount_usdc);
    if (inv.status === 'pending') {
      return {
        label: 'Retainer active',
        tone: 'info',
        sentence: `${usd(escrow)} in escrow covers ${months} more month${months === 1n ? '' : 's'}. Next release ${day(inv.due_ts)}.`,
      };
    }
    if (inv.status === 'cancelled') {
      return { label: 'Retainer ended', tone: 'neutral', sentence: `Stopped by the client after ${inv.periods_paid} paid month${inv.periods_paid === 1 ? '' : 's'}.` };
    }
  }
  switch (inv.status) {
    case 'paid': {
      const t = paymentOf(inv);
      return {
        label: 'Paid',
        tone: 'good',
        sentence: t ? `Paid ${day(t.ts)} · ${methodLine(t)}. USDC reached ${inv.freelancer}.` : 'Paid in full.',
      };
    }
    case 'refunded':
      return { label: 'Refunded', tone: 'warn', sentence: 'The payment could not complete and the payer got their money back. Nothing was received.' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'neutral', sentence: 'Stopped by the freelancer. It can no longer be paid.' };
    default: {
      if (inv.deposit_addr) return { label: 'Payment in progress', tone: 'info', sentence: 'A payment through NEAR Intents is on its way.' };
      const overdue = inv.due_ts < now;
      return {
        label: overdue ? 'Overdue' : 'Open',
        tone: overdue ? 'bad' : 'neutral',
        sentence: overdue ? `Was due ${day(inv.due_ts)} (${relative(inv.due_ts, now)}).` : `Due ${day(inv.due_ts)} (${relative(inv.due_ts, now)}).`,
      };
    }
  }
}
