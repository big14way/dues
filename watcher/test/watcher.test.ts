import { describe, expect, it } from 'vitest';
import type { Invoice, StatusResponse } from '@dues/core';
import type { DuesView } from '@dues/core/near';
import type { Account } from 'near-api-js';
import { FixtureSource, Watcher, checkClientTx, dryDepositAddress, type StatusSource } from '../src';
import sequences from '../../fixtures/1click/status-sequences.json';
import quote from '../../fixtures/1click/quote-dry.json';
import paidMainnet from '../../fixtures/1click/status-success-mainnet.json';

function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: 1,
    freelancer: 'ada.near',
    client: null,
    title: 'Brand refresh',
    items: [],
    amount_usdc: '25000000',
    due_ts: 0,
    recurrence: 'none',
    status: 'pending',
    deposit_addr: dryDepositAddress('success', 1),
    txs: [],
    created_ts: 0,
    anchor_day: 1,
    escrow_usdc: '0',
    retainer: false,
    periods_paid: 0,
    previous_id: null,
    ...over,
  };
}

/** An in-memory Dues contract and a watcher account that records its calls. */
function fakes(invoices: Invoice[]) {
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const dues = {
    contractId: 'dues.near',
    openDeposits: async () => invoices.filter((i) => i.status === 'pending' && i.deposit_addr),
    invoice: async (id: number) => invoices.find((i) => i.id === id) ?? null,
  } as unknown as DuesView;
  const watcher = {
    accountId: 'watcher.near',
    callFunctionRaw: async ({ methodName, args }: { methodName: string; args: Record<string, unknown> }) => {
      calls.push({ method: methodName, args });
      const inv = invoices.find((i) => i.id === args.id);
      if (inv && methodName === 'mark_paid') inv.status = 'paid';
      if (inv && methodName === 'mark_refunded') inv.status = 'refunded';
      return {
        transaction: { hash: `TX${calls.length}` },
        transaction_outcome: { id: `TX${calls.length}`, outcome: { status: {} } },
        receipts_outcome: [],
        status: { SuccessValue: Buffer.from('null').toString('base64') },
      };
    },
  } as unknown as Account;
  return { dues, watcher, calls };
}

const fixture = () => new FixtureSource(sequences as never, quote as never);

describe('watcher', () => {
  it('replays PENDING -> SUCCESS and marks the invoice paid once, with hashes and fee', async () => {
    const inv = invoice();
    const { dues, watcher, calls } = fakes([inv]);
    const w = new Watcher({ dues, watcher, source: fixture() });
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) for (const e of await w.tick()) if (e.type === 'status') seen.push(e.status);
    expect(seen).toEqual(['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'mark_paid',
      args: { id: 1, origin_chain: 'base', amount_usdc: '25000000', intent_tx: 'DRYxSuccessNearTxHashPlaceholder1111111111111' },
    });
    expect(BigInt(calls[0]!.args.fee_usdc as string)).toBeGreaterThan(0n);
  });

  it('marks a refunded swap refunded', async () => {
    const inv = invoice({ deposit_addr: dryDepositAddress('refunded', 1) });
    const { dues, watcher, calls } = fakes([inv]);
    const w = new Watcher({ dues, watcher, source: fixture() });
    for (let i = 0; i < 6; i++) await w.tick();
    expect(calls.map((c) => c.method)).toEqual(['mark_refunded']);
    expect(inv.status).toBe('refunded');
  });

  it('flags FAILED for a human and never marks it', async () => {
    const inv = invoice({ deposit_addr: dryDepositAddress('failed', 1) });
    const { dues, watcher, calls } = fakes([inv]);
    const w = new Watcher({ dues, watcher, source: fixture() });
    for (let i = 0; i < 6; i++) await w.tick();
    expect(calls).toHaveLength(0);
    expect(w.flagged.get(1)).toMatch(/Failed/);
  });

  it('refuses a SUCCESS that pays someone other than the freelancer', async () => {
    const inv = invoice({ deposit_addr: '0xabc' });
    const { dues, watcher, calls } = fakes([inv]);
    const bad: StatusSource = {
      kind: 'live',
      status: async () =>
        ({
          correlationId: 'x',
          status: 'SUCCESS',
          updatedAt: '',
          quoteResponse: { ...quote, quoteRequest: { ...quote.quoteRequest, recipient: 'eve.near' } },
          swapDetails: { intentHashes: [], nearTxHashes: ['H'], originChainTxHashes: [], destinationChainTxHashes: [], amountOut: '25000000' },
        }) as unknown as StatusResponse,
    };
    const w = new Watcher({ dues, watcher, source: bad });
    const events = await w.tick();
    expect(calls).toHaveLength(0);
    expect(events.find((e) => e.type === 'flagged')).toMatchObject({ reason: 'pays eve.near, not ada.near' });
  });

  it('checkAddress settles one invoice on demand and never twice in parallel', async () => {
    const inv = invoice();
    const { dues, watcher, calls } = fakes([inv]);
    const w = new Watcher({ dues, watcher, source: fixture() });
    for (let i = 0; i < 3; i++) await w.checkAddress(inv.deposit_addr!);
    await Promise.all([w.checkAddress(inv.deposit_addr!), w.checkAddress(inv.deposit_addr!), w.tick()]);
    expect(calls.filter((c) => c.method === 'mark_paid')).toHaveLength(1);
  });
});

describe('client transaction check', () => {
  const ids = { usdcId: 'usdc.near', duesId: 'dues.near' };
  const ev = (event: string, data: object) => `EVENT_JSON:${JSON.stringify({ standard: 'dues', version: '1.0.0', event, data: [data] })}`;
  const txOf = (signer: string, receiver: string, logs: string[]) => ({
    transaction: { signer_id: signer, receiver_id: receiver },
    receipts_outcome: [{ outcome: { logs, status: {} } }],
  });
  const paid = invoice({
    client: 'acme.near',
    status: 'paid',
    txs: [{ kind: 'direct', hash: null, origin_chain: 'near', origin_tx: null, amount_usdc: '25000000', fee_usdc: '0', ts: 1, period: null }],
  });

  it('accepts the client payment that the contract logged for this invoice', () => {
    expect(checkClientTx(txOf('acme.near', 'usdc.near', [ev('invoice_paid', { id: 1, direct: true })]), paid, ids)).toEqual({ ok: true, index: 0 });
  });

  it('rejects other signers, other invoices and unrelated transactions', () => {
    expect(checkClientTx(txOf('eve.near', 'usdc.near', [ev('invoice_paid', { id: 1, direct: true })]), paid, ids).ok).toBe(false);
    expect(checkClientTx(txOf('acme.near', 'usdc.near', [ev('invoice_paid', { id: 2, direct: true })]), paid, ids).ok).toBe(false);
    expect(checkClientTx(txOf('acme.near', 'usdc.near', []), paid, ids).ok).toBe(false);
    expect(checkClientTx(txOf('acme.near', 'other.near', [ev('invoice_paid', { id: 1, direct: true })]), paid, ids).ok).toBe(false);
    const spoof = `EVENT_JSON:${JSON.stringify({ standard: 'nep141', event: 'invoice_paid', data: [{ id: 1, direct: true }] })}`;
    expect(checkClientTx(txOf('acme.near', 'usdc.near', [spoof]), paid, ids).ok).toBe(false);
  });
});

describe('the recorded $2 mainnet payment', () => {
  // fixtures/1click/status-success-mainnet.json: 2.1 USDC sent on Base, 2.00 USDC delivered to
  // godswillidolor.near, 0.092516 USDC change returned to Base afterwards.
  const real = paidMainnet as unknown as StatusResponse;
  const live = (s: StatusResponse): StatusSource => ({ kind: 'live', status: async () => s });
  const onMainnet = (over: Partial<Invoice> = {}) =>
    invoice({ freelancer: 'godswillidolor.near', amount_usdc: '2000000', deposit_addr: real.quoteResponse.quote.depositAddress!, ...over });

  it('marks a 2.00 USDC invoice paid, linking the delivery on NEAR, not the later change refund', async () => {
    const inv = onMainnet();
    const { dues, watcher, calls } = fakes([inv]);
    await new Watcher({ dues, watcher, source: live(real) }).tick();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'mark_paid',
      args: {
        id: 1,
        intent_tx: 'C7RY5goGbk4ac35kuWRzqGDUtW1tT2pLG4YsXomgzJZp',
        origin_chain: 'base',
        origin_tx: '0x6c503b35fcc772a9bbdf86009c7c01a9bd7b1f8fb29d3c6c3253b402e442a99a',
        amount_usdc: '2000000',
      },
    });
    const fee = BigInt(calls[0]!.args.fee_usdc as string);
    expect(fee > 0n && fee < 10_000n).toBe(true); // under one cent
  });

  it('refuses the same payment for a larger invoice or another freelancer', async () => {
    for (const [over, reason] of [
      [{ amount_usdc: '3000000' }, 'delivered 2000000, invoice is 3000000'],
      [{ freelancer: 'ada.near' }, 'pays godswillidolor.near, not ada.near'],
    ] as const) {
      const { dues, watcher, calls } = fakes([onMainnet(over)]);
      const events = await new Watcher({ dues, watcher, source: live(real) }).tick();
      expect(calls).toHaveLength(0);
      expect(events.find((e) => e.type === 'flagged')).toMatchObject({ reason });
    }
  });
});
