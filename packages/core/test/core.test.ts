import { describe, expect, it } from 'vitest';
import {
  csvCell,
  formatUsdc,
  invoiceRows,
  invoicesToCsv,
  mapStatus,
  parseUsdc,
  settlementFrom,
  verifyAgainstInvoice,
  chainOfAsset,
  originTxUrl,
  nearTxUrl,
  type Invoice,
  type StatusResponse,
} from '../src';
import quote from '../../../fixtures/1click/quote-dry.json';

const base: Invoice = {
  id: 1,
  freelancer: 'ada.near',
  client: 'acme.near',
  title: 'Brand refresh',
  items: [],
  amount_usdc: '25000000',
  due_ts: Date.UTC(2026, 11, 1),
  recurrence: 'none',
  status: 'pending',
  deposit_addr: null,
  txs: [],
  created_ts: Date.UTC(2026, 10, 5),
  anchor_day: 1,
  escrow_usdc: '0',
  retainer: false,
  periods_paid: 0,
  previous_id: null,
};

describe('money', () => {
  it('parses and formats USDC base units', () => {
    expect(parseUsdc('25')).toBe('25000000');
    expect(parseUsdc('0.000001')).toBe('1');
    expect(parseUsdc(1500.5)).toBe('1500500000');
    expect(formatUsdc('25000000')).toBe('25.00');
    expect(formatUsdc('260486')).toBe('0.260486');
    expect(() => parseUsdc('1.0000001')).toThrow(/6 decimals/);
    expect(() => parseUsdc('-1')).toThrow();
    expect(() => parseUsdc('1e6')).toThrow();
  });
});

describe('1Click status mapping', () => {
  it('only SUCCESS pays and only REFUNDED refunds', () => {
    expect(mapStatus('SUCCESS')).toMatchObject({ view: 'paid', action: 'mark_paid', final: true });
    expect(mapStatus('REFUNDED')).toMatchObject({ view: 'refunded', action: 'mark_refunded', final: true });
    for (const s of ['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING', 'INCOMPLETE_DEPOSIT']) {
      expect(mapStatus(s)).toMatchObject({ view: 'pending', action: 'none', final: false });
    }
    expect(mapStatus('FAILED').action).toBe('flag');
    expect(mapStatus('SOMETHING_NEW').action).toBe('flag');
  });

  const status = (over: Partial<StatusResponse['quoteResponse']['quoteRequest']> = {}, amountOut = '25000000'): StatusResponse => ({
    correlationId: 'c',
    quoteResponse: { ...(quote as unknown as StatusResponse['quoteResponse']), quoteRequest: { ...(quote.quoteRequest as unknown as StatusResponse['quoteResponse']['quoteRequest']), ...over } },
    status: 'SUCCESS',
    updatedAt: '',
    swapDetails: {
      intentHashes: ['ih'],
      nearTxHashes: ['NEARHASH'],
      originChainTxHashes: [{ hash: '0xabc', explorerUrl: '' }],
      destinationChainTxHashes: [],
      amountOut,
      amountInUsd: '25.252785',
      amountOutUsd: '24.9923',
    },
  });

  it('refuses a swap that pays someone else, another asset, or less', () => {
    expect(verifyAgainstInvoice(status(), base)).toEqual({ ok: true });
    expect(verifyAgainstInvoice(status({ recipient: 'eve.near' }), base)).toMatchObject({ ok: false });
    expect(verifyAgainstInvoice(status({ destinationAsset: 'nep141:wrap.near' }), base)).toMatchObject({ ok: false });
    expect(verifyAgainstInvoice(status({}, '24999999'), base)).toMatchObject({ ok: false });
  });

  it('extracts hashes and the buyer-side fee', () => {
    const s = settlementFrom(status(), 'base');
    expect(s).toMatchObject({ intentTx: 'NEARHASH', originTx: '0xabc', originChain: 'base', amountUsdc: '25000000' });
    expect(s.feeUsdc).toBe('260485');
  });

  it('reads the origin chain from a 1Click asset id', () => {
    expect(chainOfAsset('nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near')).toBe('base');
    expect(chainOfAsset('nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near')).toBe('sol');
    expect(chainOfAsset('nep141:wrap.near')).toBe('near');
  });
});

describe('explorer links', () => {
  it('links NEAR and origin-chain transactions', () => {
    expect(nearTxUrl('testnet', 'H')).toBe('https://testnet.nearblocks.io/txns/H');
    expect(nearTxUrl('sandbox', 'H')).toBeUndefined();
    expect(originTxUrl('base', '0x1')).toBe('https://basescan.org/tx/0x1');
    expect(originTxUrl('unknownchain', '0x1')).toBeUndefined();
  });
});

describe('CSV', () => {
  const paid: Invoice = {
    ...base,
    status: 'paid',
    txs: [
      { kind: 'intent', hash: 'H1', origin_chain: 'base', origin_tx: '0x1', amount_usdc: '25000000', fee_usdc: '260486', ts: Date.UTC(2026, 10, 6), period: null },
    ],
  };
  const refunded: Invoice = {
    ...base,
    id: 2,
    title: 'Icon set',
    status: 'refunded',
    txs: [{ kind: 'refund', hash: null, origin_chain: 'sol', origin_tx: 'SOLTX', amount_usdc: '0', fee_usdc: '0', ts: Date.UTC(2026, 10, 7), period: null }],
  };
  const retainer: Invoice = {
    ...base,
    id: 3,
    title: 'Retainer',
    recurrence: 'monthly',
    retainer: true,
    amount_usdc: '1500000000',
    periods_paid: 1,
    due_ts: Date.UTC(2027, 0, 1),
    txs: [
      { kind: 'fund', hash: 'F', origin_chain: 'near', origin_tx: null, amount_usdc: '4500000000', fee_usdc: '0', ts: Date.UTC(2026, 10, 8), period: null },
      { kind: 'pull', hash: 'P1', origin_chain: 'near', origin_tx: null, amount_usdc: '1500000000', fee_usdc: '0', ts: Date.UTC(2026, 11, 1), period: 1 },
    ],
  };

  it('one row per money event, funding left out, open month shown', () => {
    const rows = invoiceRows([retainer, refunded, paid]);
    expect(rows.map((r) => [r.date, r.invoice, r.status])).toEqual([
      ['2026-11-06', '#1 Brand refresh', 'paid'],
      ['2026-11-07', '#2 Icon set', 'refunded'],
      ['2026-12-01', '#3 Retainer (month 1)', 'paid'],
      ['2027-01-01', '#3 Retainer (month 2)', 'pending'],
    ]);
    expect(rows[0]).toMatchObject({ amount: '25.00', fee: '0.260486', tx: 'H1', client: 'acme.near' });
    expect(rows[1]?.tx).toBe('SOLTX');
  });

  it('writes RFC 4180 with formula injection neutralised', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    const csv = invoicesToCsv([{ ...paid, title: '+cmd' }], { txCell: (h) => `https://nearblocks.io/txns/${h}` });
    expect(csv.split('\r\n')[0]).toBe('date,invoice,client,amount,fee,tx,status');
    expect(csv).toContain('https://nearblocks.io/txns/H1');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});
