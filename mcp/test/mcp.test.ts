import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { KeyPair } from 'near-api-js';
import type { Invoice, StatusResponse } from '@dues/core';
import { createDuesMcp, type DuesMcpOptions } from '../src/server';
import paidMainnet from '../../fixtures/1click/status-success-mainnet.json';
import quoteDry from '../../fixtures/1click/quote-dry.json';
import tokens from '../../fixtures/1click/tokens.json';

const paid: Invoice = {
  id: 2,
  freelancer: 'dues-freelancer.testnet',
  client: 'dues-client.testnet',
  title: 'Brand guidelines',
  items: [{ description: 'Guidelines PDF', amount_usdc: '2000000' }],
  amount_usdc: '2000000',
  due_ts: Date.parse('2026-11-14'),
  recurrence: 'none',
  status: 'paid',
  deposit_addr: null,
  txs: [
    { kind: 'direct', hash: 'B5sgJWei9YvnaHfxUjwPAsgU91poA8DruZVD5uVAadJt', origin_chain: 'near', origin_tx: null, amount_usdc: '2000000', fee_usdc: '0', ts: Date.parse('2026-11-07'), period: null },
  ],
  created_ts: 0,
  anchor_day: 14,
  escrow_usdc: '0',
  retainer: false,
  periods_paid: 0,
  previous_id: null,
};
const open: Invoice = { ...paid, id: 5, title: 'Landing page copy', status: 'pending', txs: [], amount_usdc: '300000000', items: [] };

async function connect(over: Partial<DuesMcpOptions> = {}) {
  const server = createDuesMcp({
    network: 'testnet',
    contractId: 'dues.testnet',
    rpcUrl: 'http://127.0.0.1:1',
    siteUrl: 'https://sendues.vercel.app',
    view: {
      invoice: async (id: number) => [paid, open].find((i) => i.id === id) ?? null,
      byFreelancer: async () => [paid, open],
      byClient: async () => [paid],
    },
    oneClick: {
      tokens: async () => tokens as never,
      quote: async () => quoteDry as never,
      status: async () => paidMainnet as unknown as StatusResponse,
    },
    accountExists: async (id) => id !== 'nobody-here.near',
    ...over,
  });
  const client = new Client({ name: 'test', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const text = r.content[0]!.text;
    return { error: Boolean(r.isError), text, json: r.isError ? null : (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  return { client, call };
}

describe('Dues MCP server', () => {
  it('offers read tools to anyone, and invoice writing only with a session key', async () => {
    const ro = await connect();
    expect((await ro.client.listTools()).tools.map((t) => t.name).sort()).toEqual(
      ['checkout_quote', 'get_invoice', 'invoices_csv', 'list_invoices', 'payment_link', 'payment_status'],
    );
    const rw = await connect({ agent: { accountId: 'agent.testnet', key: KeyPair.fromRandom('ed25519').toString() } });
    const names = (await rw.client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('create_invoice');
    expect(names).toContain('cancel_invoice');
    expect(ro.client.getInstructions()).toMatch(/real money on NEAR mainnet/);
  });

  it('reads an invoice with its ledger and links', async () => {
    const { call } = await connect();
    const r = await call('get_invoice', { id: 2 });
    expect(r.json).toMatchObject({ id: 2, status: 'paid', amount_usd: '2.00', link: 'https://sendues.vercel.app/i/?id=2' });
    expect(r.json.ledger[0]).toMatchObject({ what: 'Paid with USDC on NEAR', near_tx: 'https://testnet.nearblocks.io/txns/B5sgJWei9YvnaHfxUjwPAsgU91poA8DruZVD5uVAadJt' });
    expect((await call('get_invoice', { id: 99 })).error).toBe(true);
  });

  it('lists invoices with totals and exports the CSV', async () => {
    const { call } = await connect();
    const r = await call('list_invoices', { account: 'dues-freelancer.testnet' });
    expect(r.json).toMatchObject({ received_usd: '2.00', outstanding_usd: '300.00' });
    expect(r.json.invoices.map((i: { id: number }) => i.id)).toEqual([5, 2]);
    expect((await call('invoices_csv', { account: 'dues-freelancer.testnet' })).text.split(/\r?\n/)[0]).toBe('date,invoice,client,amount,fee,tx,status');
  });

  it('tracks the recorded $2 mainnet payment to its NEAR delivery', async () => {
    const { call } = await connect();
    const r = await call('payment_status', { deposit_address: '0x2f25C083AB2f358eFC836A2D6B11733DB1d5f29D' });
    expect(r.json).toMatchObject({
      status: 'SUCCESS',
      final: true,
      recipient: 'godswillidolor.near',
      delivered_usdc: '2.0',
      returned_to_payer: '0.092516',
      deposit_tx: 'https://basescan.org/tx/0x6c503b35fcc772a9bbdf86009c7c01a9bd7b1f8fb29d3c6c3253b402e442a99a',
      near_delivery_tx: 'https://nearblocks.io/txns/C7RY5goGbk4ac35kuWRzqGDUtW1tT2pLG4YsXomgzJZp',
    });
  });

  it('makes payment links only for mainnet accounts that exist', async () => {
    const { call } = await connect();
    const r = await call('payment_link', { to: 'godswillidolor.near', amount_usd: '2', memo: 'Order 1042' });
    expect(r.json.url).toBe('https://sendues.vercel.app/pay/?to=godswillidolor.near&amount=2&memo=Order+1042');
    expect((await call('payment_link', { to: 'dues-freelancer.testnet', amount_usd: '2' })).text).toMatch(/testnet account/);
    expect((await call('payment_link', { to: 'nobody-here.near', amount_usd: '2' })).text).toMatch(/does not exist/);
  });

  it('quotes dry by default and wants a refund address before a live deposit address', async () => {
    const { call } = await connect();
    const dry = await call('checkout_quote', { to: 'dues-freelancer.testnet', amount_usd: '25' });
    expect(dry.json).toMatchObject({ live: false });
    expect(dry.json.buyer_sends).toMatch(/USDC on Base$/);
    expect(dry.json.deposit_address).toBeUndefined();
    expect((await call('checkout_quote', { to: 'godswillidolor.near', amount_usd: '25', live: true })).text).toMatch(/refund_to/);
    expect((await call('checkout_quote', { to: 'dues-freelancer.testnet', amount_usd: '25', live: true })).text).toMatch(/mainnet/);
  });
});
