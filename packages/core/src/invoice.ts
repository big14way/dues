/** Mirrors the contract's JSON shapes (contracts/dues/src/lib.rs). */

export type Recurrence = 'none' | 'monthly';
export type InvoiceStatus = 'pending' | 'paid' | 'refunded' | 'cancelled';
export type TxKind = 'intent' | 'refund' | 'fund' | 'pull' | 'withdraw' | 'direct';

/** How each ledger entry reads to a bookkeeper. */
export const TX_KIND_LABEL: Record<TxKind, string> = {
  intent: 'Paid through NEAR Intents',
  direct: 'Paid with USDC on NEAR',
  refund: 'Refunded to the payer',
  fund: 'Retainer funded by the client',
  pull: 'Retainer month released',
  withdraw: 'Escrow returned to the client',
};

export interface LineItem {
  description: string;
  amount_usdc: string;
}

export interface TxRecord {
  kind: TxKind;
  hash: string | null;
  origin_chain: string | null;
  origin_tx: string | null;
  amount_usdc: string;
  fee_usdc: string;
  ts: number;
  period: number | null;
}

export interface Invoice {
  id: number;
  freelancer: string;
  client: string | null;
  title: string;
  items: LineItem[];
  amount_usdc: string;
  due_ts: number;
  recurrence: Recurrence;
  status: InvoiceStatus;
  deposit_addr: string | null;
  txs: TxRecord[];
  created_ts: number;
  anchor_day: number;
  escrow_usdc: string;
  retainer: boolean;
  periods_paid: number;
  previous_id: number | null;
}

export interface DuesConfig {
  owner_id: string;
  watcher_id: string;
  usdc_id: string;
  invoice_count: number;
}

/** Plain-language meaning of each status, for screens and the README. */
export const STATUS_MEANING: Record<InvoiceStatus, string> = {
  pending: 'Waiting for payment. For a retainer: active, next month not yet released.',
  paid: 'Paid in full. USDC reached the freelancer on NEAR; the transaction is linked.',
  refunded: 'The payment could not complete and the payer got their money back. Nothing was received.',
  cancelled: 'Stopped by the freelancer, or a retainer stopped by the client. No further payments.',
};
