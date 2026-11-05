import {
  chainOfAsset,
  mapStatus,
  settlementFrom,
  verifyAgainstInvoice,
  type Invoice,
  type OneClickToken,
  type Settlement,
  type StatusResponse,
} from '@dues/core';
import { callWithHash, type DuesView } from '@dues/core/near';
import type { Account } from 'near-api-js';
import type { StatusSource } from './sources';

export type WatcherEvent =
  | { type: 'status'; invoiceId: number; depositAddress: string; status: string; label: string }
  | { type: 'paid'; invoiceId: number; hash: string; settlement: Settlement; nextInvoiceId: number | null }
  | { type: 'refunded'; invoiceId: number; hash: string }
  | { type: 'flagged'; invoiceId: number; reason: string }
  | { type: 'error'; invoiceId: number; error: string };

export interface WatcherDeps {
  dues: DuesView;
  /** The account configured as `watcher_id` on the contract. */
  watcher: Account;
  source: StatusSource;
  tokens?: OneClickToken[];
  onEvent?: (e: WatcherEvent) => void;
}

/**
 * Polls 1Click for every pending invoice that has a deposit address and
 * reports final outcomes on-chain:
 *   PENDING_DEPOSIT / KNOWN_DEPOSIT_TX / PROCESSING / INCOMPLETE_DEPOSIT -> stays pending
 *   SUCCESS  -> mark_paid (after checking it pays this freelancer, in USDC, in full)
 *   REFUNDED -> mark_refunded
 *   FAILED   -> flagged for a human
 */
export class Watcher {
  readonly lastSeen = new Map<number, StatusResponse>();
  readonly flagged = new Map<number, string>();
  private lastStatus = new Map<number, string>();

  constructor(private readonly deps: WatcherDeps) {}

  private emit(e: WatcherEvent) {
    this.deps.onEvent?.(e);
  }

  async tick(): Promise<WatcherEvent[]> {
    const events: WatcherEvent[] = [];
    const push = (e: WatcherEvent) => {
      events.push(e);
      this.emit(e);
    };
    const open = await this.deps.dues.openDeposits();
    for (const inv of open) {
      if (!inv.deposit_addr || this.flagged.has(inv.id)) continue;
      try {
        await this.check(inv, inv.deposit_addr, push);
      } catch (e) {
        push({ type: 'error', invoiceId: inv.id, error: (e as Error).message });
      }
    }
    return events;
  }

  private async check(inv: Invoice, addr: string, push: (e: WatcherEvent) => void) {
    const s = await this.deps.source.status(addr, inv);
    if (!s) return;
    this.lastSeen.set(inv.id, s);
    const m = mapStatus(s.status);
    if (this.lastStatus.get(inv.id) !== s.status) {
      this.lastStatus.set(inv.id, s.status);
      push({ type: 'status', invoiceId: inv.id, depositAddress: addr, status: s.status, label: m.label });
    }
    if (m.action === 'none') return;
    if (m.action === 'flag') {
      this.flagged.set(inv.id, m.label);
      push({ type: 'flagged', invoiceId: inv.id, reason: m.label });
      return;
    }
    const check = verifyAgainstInvoice(s, inv);
    if (!check.ok) {
      this.flagged.set(inv.id, check.reason);
      push({ type: 'flagged', invoiceId: inv.id, reason: check.reason });
      return;
    }
    const contractId = this.deps.dues.contractId;
    const originChain = chainOfAsset(s.quoteResponse.quoteRequest.originAsset, this.deps.tokens);
    if (m.action === 'mark_paid') {
      const st = settlementFrom(s, originChain);
      const { hash, value } = await callWithHash<number | null>(this.deps.watcher, contractId, 'mark_paid', {
        id: inv.id,
        intent_tx: st.intentTx,
        origin_chain: st.originChain ?? null,
        origin_tx: st.originTx ?? null,
        amount_usdc: st.amountUsdc,
        fee_usdc: st.feeUsdc,
      });
      push({ type: 'paid', invoiceId: inv.id, hash, settlement: st, nextInvoiceId: value ?? null });
    } else if (m.action === 'mark_refunded') {
      const origin = s.swapDetails.originChainTxHashes;
      const { hash } = await callWithHash(this.deps.watcher, contractId, 'mark_refunded', {
        id: inv.id,
        intent_tx: s.swapDetails.nearTxHashes.at(-1) ?? null,
        origin_chain: originChain ?? null,
        refund_tx: origin.length > 1 ? origin.at(-1)!.hash : null,
      });
      push({ type: 'refunded', invoiceId: inv.id, hash });
    }
  }

  /** Last status seen for a deposit address (used by the status endpoint). */
  statusForAddress(addr: string): StatusResponse | undefined {
    for (const s of this.lastSeen.values()) if (s.quoteResponse.quote.depositAddress === addr) return s;
    return undefined;
  }
}
