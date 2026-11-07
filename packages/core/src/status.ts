import type { OneClickStatus, StatusResponse, SwapDetails } from './oneclick';
import { usdToUnits } from './money';
import { USDC_NEAR_ASSET_ID } from './constants';
import type { Invoice } from './invoice';

/** What Dues shows for a 1Click status, and what the watcher should do on-chain. */
export type PaymentView = 'pending' | 'paid' | 'refunded' | 'flagged';
export type WatcherAction = 'none' | 'mark_paid' | 'mark_refunded' | 'flag';

export interface StatusMapping {
  view: PaymentView;
  action: WatcherAction;
  /** Short, plain-language line for the payer or the freelancer. */
  label: string;
  /** True once 1Click will not change this status again. */
  final: boolean;
}

const MAPPING: Record<OneClickStatus, StatusMapping> = {
  PENDING_DEPOSIT: { view: 'pending', action: 'none', label: 'Waiting for the payment to arrive', final: false },
  KNOWN_DEPOSIT_TX: { view: 'pending', action: 'none', label: 'Payment seen, waiting for confirmations', final: false },
  PROCESSING: { view: 'pending', action: 'none', label: 'Converting to USDC on NEAR', final: false },
  INCOMPLETE_DEPOSIT: {
    view: 'pending',
    action: 'none',
    label: 'Less than the quoted amount arrived; top up or it will be refunded',
    final: false,
  },
  SUCCESS: { view: 'paid', action: 'mark_paid', label: 'Paid: USDC delivered on NEAR', final: true },
  REFUNDED: { view: 'refunded', action: 'mark_refunded', label: 'Refunded to the payer', final: true },
  FAILED: { view: 'flagged', action: 'flag', label: 'Failed: needs a human to look at it', final: true },
};

export function mapStatus(status: string): StatusMapping {
  const m = MAPPING[status as OneClickStatus];
  if (m) return m;
  return { view: 'flagged', action: 'flag', label: `Unknown status ${status}`, final: false };
}

export interface Settlement {
  intentTx: string;
  originChain?: string;
  originTx?: string;
  amountUsdc: string;
  feeUsdc: string;
}

/**
 * Checks a 1Click status response really pays this invoice: right asset,
 * right recipient, at least the invoice amount. A watcher must never mark an
 * invoice paid from a swap that pays someone else.
 */
export function verifyAgainstInvoice(
  s: StatusResponse,
  inv: Pick<Invoice, 'freelancer' | 'amount_usdc'>,
  opts: { destinationAsset?: string } = {},
): { ok: true } | { ok: false; reason: string } {
  const req = s.quoteResponse?.quoteRequest;
  if (!req) return { ok: false, reason: 'status has no quote request' };
  const asset = opts.destinationAsset ?? USDC_NEAR_ASSET_ID;
  if (req.destinationAsset !== asset) return { ok: false, reason: `pays ${req.destinationAsset}, not USDC on NEAR` };
  if (req.recipient !== inv.freelancer) return { ok: false, reason: `pays ${req.recipient}, not ${inv.freelancer}` };
  if (s.status === 'SUCCESS') {
    const out = s.swapDetails?.amountOut ?? s.quoteResponse.quote.amountOut;
    if (!out || BigInt(out) < BigInt(inv.amount_usdc)) {
      return { ok: false, reason: `delivered ${out ?? 'nothing'}, invoice is ${inv.amount_usdc}` };
    }
  }
  return { ok: true };
}

/** NEAR transaction hashes are base58 of 32 bytes: 43 or 44 characters. */
const NEAR_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

/**
 * The NEAR transaction that delivered USDC to the recipient. 1Click lists it in
 * destinationChainTxHashes, next to any change sent back on the origin chain, while
 * nearTxHashes also holds later Intents steps (on the first mainnet payment its last
 * entry was the change going back to Base, not the delivery).
 */
export function deliveryTxOf(d: Pick<SwapDetails, 'destinationChainTxHashes' | 'nearTxHashes'>): string | undefined {
  return d.destinationChainTxHashes?.find((t) => NEAR_HASH.test(t.hash))?.hash ?? d.nearTxHashes?.at(-1);
}

/** Pulls hashes, amount and fee out of a SUCCESS status for `mark_paid`. */
export function settlementFrom(s: StatusResponse, originChain?: string): Settlement {
  const d = s.swapDetails;
  const intentTx = deliveryTxOf(d) ?? d.intentHashes.at(-1) ?? 'unknown';
  const amountOut = d.amountOut ?? s.quoteResponse.quote.amountOut;
  const inUsd = d.amountInUsd ?? s.quoteResponse.quote.amountInUsd;
  const outUsd = d.amountOutUsd ?? s.quoteResponse.quote.amountOutUsd;
  const fee = usdToUnits(inUsd) - usdToUnits(outUsd);
  return {
    intentTx,
    originChain,
    originTx: d.originChainTxHashes[0]?.hash,
    amountUsdc: amountOut,
    feeUsdc: (fee > 0n ? fee : 0n).toString(),
  };
}

/** 1Click asset ids look like `nep141:base-0x8335...omft.near`; returns `base`. */
export function chainOfAsset(assetId: string, tokens?: { assetId: string; blockchain: string }[]): string | undefined {
  const t = tokens?.find((x) => x.assetId === assetId);
  if (t) return t.blockchain;
  const omft = /^nep141:([a-z0-9]+)[-.].*\.omft\.near$/.exec(assetId);
  if (omft?.[1]) return omft[1];
  return assetId.startsWith('nep141:') ? 'near' : undefined;
}
