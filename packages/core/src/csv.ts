import type { Invoice, InvoiceStatus } from './invoice';
import { formatUsdc } from './money';

/** The columns a bookkeeper gets, in order. */
export const CSV_COLUMNS = ['date', 'invoice', 'client', 'amount', 'fee', 'tx', 'status'] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];
export type CsvRow = Record<CsvColumn, string>;

export interface CsvOptions {
  /** Turns a NEAR tx hash into what goes in the `tx` cell (e.g. an explorer URL). Default: the hash. */
  txCell?: (hash: string) => string;
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function label(inv: Invoice, period?: number | null): string {
  return period ? `#${inv.id} ${inv.title} (month ${period})` : `#${inv.id} ${inv.title}`;
}

/**
 * One row per money event, so every line is something that happened:
 * - an invoice paid through 1Click (status paid),
 * - each retainer month released from escrow (status paid),
 * - a 1Click refund (status refunded: nothing was received),
 * - otherwise one row with the invoice's status and its due date.
 * Retainer funding and returned escrow are the client's money moving, not
 * income, so they are left out.
 */
export function invoiceRows(invoices: Invoice[], opts: CsvOptions = {}): CsvRow[] {
  const txCell = opts.txCell ?? ((h: string) => h);
  const rows: CsvRow[] = [];
  for (const inv of invoices) {
    const client = inv.client ?? '';
    let events = 0;
    for (const tx of inv.txs) {
      if (tx.kind === 'intent' || tx.kind === 'pull') {
        events++;
        rows.push({
          date: day(tx.ts),
          invoice: label(inv, tx.period),
          client,
          amount: formatUsdc(tx.amount_usdc),
          fee: formatUsdc(tx.fee_usdc),
          tx: tx.hash ? txCell(tx.hash) : '',
          status: 'paid',
        });
      } else if (tx.kind === 'refund') {
        events++;
        rows.push({
          date: day(tx.ts),
          invoice: label(inv),
          client,
          amount: formatUsdc(inv.amount_usdc),
          fee: formatUsdc(tx.fee_usdc),
          tx: tx.hash ? txCell(tx.hash) : (tx.origin_tx ?? ''),
          status: 'refunded',
        });
      }
    }
    const openMonth = inv.retainer && inv.status === 'pending';
    if (events === 0 || openMonth) {
      const status: InvoiceStatus = inv.status;
      rows.push({
        date: day(inv.due_ts),
        invoice: openMonth ? label(inv, inv.periods_paid + 1) : label(inv),
        client,
        amount: formatUsdc(inv.amount_usdc),
        fee: '0.00',
        tx: '',
        status,
      });
    }
  }
  return rows.sort((a, b) => (a.date === b.date ? a.invoice.localeCompare(b.invoice) : a.date.localeCompare(b.date)));
}

/** RFC 4180 cell, with spreadsheet formula injection neutralised. */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function toCsv(rows: CsvRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export function invoicesToCsv(invoices: Invoice[], opts: CsvOptions = {}): string {
  return toCsv(invoiceRows(invoices, opts));
}
