import { describe, expect, it } from 'vitest';
import { USDC_NEAR_ASSET_ID } from '@dues/core';
import { buildQuoteRequest, dryRecipient, formatDeadline, mapQuote } from '../src/quote';
import { paymentUri, receiptOf } from '../src/links';
import paidMainnet from '../../../fixtures/1click/status-success-mainnet.json';
import { FALLBACK_TOKENS, chainsOf, tokensOn } from '../src/tokens';
import quote from '../../../fixtures/1click/quote-dry.json';

describe('quote request', () => {
  it('asks for exactly the invoice amount in USDC on NEAR', () => {
    const r = buildQuoteRequest({
      amountUsd: '1500',
      recipient: 'ada.near',
      origin: { assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near' },
      refundTo: ' 0xabc ',
      dry: true,
      now: new Date('2026-11-06T00:00:00Z'),
    });
    expect(r).toMatchObject({
      swapType: 'EXACT_OUTPUT',
      destinationAsset: USDC_NEAR_ASSET_ID,
      amount: '1500000000',
      recipient: 'ada.near',
      recipientType: 'DESTINATION_CHAIN',
      depositType: 'ORIGIN_CHAIN',
      refundTo: '0xabc',
      dry: true,
      deadline: '2026-11-06T01:00:00.000Z',
    });
  });

  it('shows what the buyer pays and what the conversion costs', () => {
    const v = mapQuote(quote as never, { symbol: 'USDC', blockchain: 'base' });
    expect(v).toMatchObject({ pay: '25.260566', receive: '25.00', feeUsd: '0.26', etaSeconds: 35, dry: true });
  });

  it('uses a stand-in implicit account for dry quotes to non-mainnet recipients', async () => {
    expect(await dryRecipient('ada.near')).toBe('ada.near');
    expect(await dryRecipient('ada.testnet')).toMatch(/^[0-9a-f]{64}$/);
    expect(await dryRecipient('ada.testnet')).toBe(await dryRecipient('ada.testnet'));
  });
});

describe('payment links', () => {
  it('builds EIP-681, Solana Pay and BIP-21 URIs', () => {
    expect(paymentUri({ blockchain: 'base', decimals: 6, symbol: 'USDC', contractAddress: '0x8335' }, '0xdep', '25260566')).toBe(
      'ethereum:0x8335@8453/transfer?address=0xdep&uint256=25260566',
    );
    expect(paymentUri({ blockchain: 'eth', decimals: 18, symbol: 'ETH' }, '0xdep', '1000')).toBe('ethereum:0xdep@1?value=1000');
    expect(paymentUri({ blockchain: 'sol', decimals: 6, symbol: 'USDC', contractAddress: 'EPj' }, 'Dep', '25260566')).toBe(
      'solana:Dep?amount=25.260566&spl-token=EPj',
    );
    expect(paymentUri({ blockchain: 'btc', decimals: 8, symbol: 'BTC' }, 'bc1q', '12345')).toBe('bitcoin:bc1q?amount=0.00012345');
    expect(paymentUri({ blockchain: 'tron', decimals: 6, symbol: 'USDT' }, 'T', '1')).toBeUndefined();
  });
});

describe('token list', () => {
  it('puts popular chains and stablecoins first', () => {
    const chains = chainsOf(FALLBACK_TOKENS).map((c) => c.id);
    expect(chains.slice(0, 3)).toEqual(['base', 'eth', 'sol']);
    expect(tokensOn(FALLBACK_TOKENS, 'base')[0]?.symbol).toBe('USDC');
    expect(FALLBACK_TOKENS.length).toBeGreaterThan(100);
  });
});

describe('receipt after a real payment', () => {
  // Recorded from a $2 mainnet payment: 2.1 USDC sent on Base, 2.00 USDC delivered on NEAR, the rest returned.
  const r = receiptOf(paidMainnet.swapDetails, 'base');

  it('links the deposit on Base and the delivery on NEAR', () => {
    expect(r.origin?.url).toBe(`https://basescan.org/tx/${paidMainnet.swapDetails.originChainTxHashes[0]!.hash}`);
    expect(r.delivery?.hash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(r.delivery?.url).toBe(`https://nearblocks.io/txns/${r.delivery?.hash}`);
  });

  it('shows the change sent back to the payer as a Base transaction, not as the delivery', () => {
    expect(r.returned?.amount).toBe(paidMainnet.swapDetails.refundedAmountFormatted);
    expect(r.returned?.hash.startsWith('0x')).toBe(true);
    expect(r.returned?.url).toBe(`https://basescan.org/tx/${r.returned?.hash}`);
  });
});

describe('deadline', () => {
  const now = new Date('2026-11-07T08:09:33Z');
  it('counts minutes when close, days when far, and says when it expired', () => {
    expect(formatDeadline(new Date(now.getTime() + 45 * 60_000), now)).toMatch(/\(45 min\)$/);
    expect(formatDeadline(new Date(now.getTime() + 5 * 3600_000), now)).toMatch(/\(5 h\)$/);
    expect(formatDeadline(new Date('2026-11-10T09:09:32Z'), now)).toMatch(/, .*\(3 days\)$/);
    expect(formatDeadline(new Date(now.getTime() - 1000), now)).toBe('expired: get new details');
  });
});
