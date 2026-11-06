import type { Invoice, TxKind } from '@dues/core';
import type { JsonRpcProvider } from 'near-api-js';

export type DirectCheck = { ok: true; index: number } | { ok: false; reason: string };

interface TxView {
  transaction?: { signer_id?: string; receiver_id?: string; hash?: string };
  status?: unknown;
  receipts_outcome?: { outcome: { logs: string[]; status: unknown } }[];
}

/** The `dues` events a transaction logged, decoded. */
export function duesEvents(tx: TxView): { event: string; data: Record<string, unknown>[] }[] {
  const out: { event: string; data: Record<string, unknown>[] }[] = [];
  for (const r of tx.receipts_outcome ?? []) {
    for (const log of r.outcome.logs) {
      if (!log.startsWith('EVENT_JSON:')) continue;
      try {
        const ev = JSON.parse(log.slice('EVENT_JSON:'.length)) as { standard?: string; event: string; data: Record<string, unknown>[] };
        if (ev.standard === 'dues') out.push({ event: ev.event, data: ev.data });
      } catch {
        /* not ours */
      }
    }
  }
  return out;
}

/**
 * Checks that `tx` is a transaction the invoice's client signed that moved
 * money for this invoice, and returns the ledger index whose hash is missing:
 *  - USDC `ft_transfer_call` that paid it directly (event invoice_paid, direct),
 *  - USDC `ft_transfer_call` that funded the retainer (event retainer_funded),
 *  - `withdraw_remaining` on Dues that returned the escrow (event retainer_withdrawn).
 * The events come from the Dues contract's own logs, so a transaction that
 * did not touch this invoice cannot be attached to it.
 */
export function checkClientTx(tx: TxView, inv: Invoice, ids: { usdcId: string; duesId: string }): DirectCheck {
  const t = tx.transaction;
  if (!t) return { ok: false, reason: 'transaction not found' };
  if (!inv.client || t.signer_id !== inv.client) return { ok: false, reason: `signed by ${t.signer_id}, not the invoice's client` };
  const events = duesEvents(tx).filter((e) => e.data.some((d) => d.id === inv.id));
  const missing = (kind: TxKind, amount?: unknown) =>
    inv.txs.findIndex((x) => x.kind === kind && !x.hash && (amount === undefined || x.amount_usdc === amount));
  if (t.receiver_id === ids.usdcId) {
    const paid = events.find((e) => e.event === 'invoice_paid' && e.data.some((d) => d.direct === true));
    if (paid) return found(missing('direct'));
    const funded = events.find((e) => e.event === 'retainer_funded');
    if (funded) return found(missing('fund', funded.data[0]?.amount_usdc));
  } else if (t.receiver_id === ids.duesId) {
    if (events.some((e) => e.event === 'retainer_withdrawn')) return found(missing('withdraw'));
  } else {
    return { ok: false, reason: `sent to ${t.receiver_id}, not USDC or Dues` };
  }
  return { ok: false, reason: 'this transaction did not move money for this invoice' };
}

function found(index: number): DirectCheck {
  return index >= 0 ? { ok: true, index } : { ok: false, reason: 'no ledger entry is waiting for this hash' };
}

export async function fetchTx(provider: JsonRpcProvider, hash: string, signer: string): Promise<TxView> {
  return (await provider.viewTransactionStatusWithReceipts({
    txHash: hash,
    accountId: signer,
    waitUntil: 'FINAL',
  })) as unknown as TxView;
}
