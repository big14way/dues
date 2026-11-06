import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { mapStatus, verifyAgainstInvoice } from '@dues/core';
import { callWithHash, type DuesView } from '@dues/core/near';
import type { Account } from 'near-api-js';
import { checkClientTx, fetchTx } from './direct';
import { isDryAddress, type StatusSource } from './sources';
import type { Watcher } from './watcher';

export interface WatcherHttpDeps {
  dues: DuesView;
  watcher: Account;
  loop: Watcher;
  source: StatusSource;
  corsOrigin?: string | boolean;
  logger?: boolean;
  /**
   * Serverless hosting has no background loop: when true, every GET /status
   * also checks that address and reports a final outcome on-chain.
   */
  settleOnRead?: boolean;
}

/**
 * Small HTTP surface for the checkout:
 *  GET  /status?depositAddress=  last status the watcher saw (or 1Click live), same shape as 1Click
 *  POST /track {invoiceId, depositAddress}  ties a 1Click deposit address to an invoice
 *  POST /annotate {invoiceId, hash}  records the NEAR tx of a client payment, funding or withdrawal, after checking it on-chain
 *  GET  /flagged  invoices that need a human
 */
export async function buildWatcherServer(deps: WatcherHttpDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 16 * 1024 });
  await app.register(cors, { origin: deps.corsOrigin ?? true });

  app.get('/health', async () => ({ ok: true, watcher: deps.watcher.accountId, source: deps.source.kind }));

  app.get('/flagged', async () => Object.fromEntries(deps.loop.flagged));

  app.get('/status', async (req, reply) => {
    const addr = (req.query as { depositAddress?: string }).depositAddress;
    if (!addr) return reply.code(400).send({ message: 'depositAddress is required' });
    if (deps.settleOnRead) await deps.loop.checkAddress(addr);
    const seen = deps.loop.statusForAddress(addr);
    if (seen) return seen;
    if (deps.source.kind === 'live') {
      const open = await deps.dues.openDeposits();
      const inv = open.find((i) => i.deposit_addr === addr);
      const live = inv ? await deps.source.status(addr, inv) : null;
      if (live) return live;
    }
    return reply.code(404).send({ message: `Deposit address ${addr} not found` });
  });

  app.post('/track', async (req, reply) => {
    const { invoiceId, depositAddress } = (req.body ?? {}) as { invoiceId?: number; depositAddress?: string };
    if (typeof invoiceId !== 'number' || typeof depositAddress !== 'string' || depositAddress.length > 128) {
      return reply.code(400).send({ error: 'invoiceId (number) and depositAddress (string) are required' });
    }
    const inv = await deps.dues.invoice(invoiceId);
    if (!inv) return reply.code(404).send({ error: 'no such invoice' });
    if (inv.status !== 'pending' || inv.retainer) return reply.code(409).send({ error: 'invoice is not open for payment' });
    if (inv.deposit_addr === depositAddress) return { ok: true, already: true };

    // Never swap out an address a payer is already paying into.
    if (inv.deposit_addr) {
      const current = deps.loop.lastSeen.get(inv.id);
      if (current && current.status !== 'PENDING_DEPOSIT') {
        return reply.code(409).send({ error: 'a payment is already in progress for this invoice' });
      }
    }
    if (deps.source.kind === 'fixture') {
      if (!isDryAddress(depositAddress)) return reply.code(400).send({ error: 'dry mode only tracks dry-* addresses' });
    } else {
      const s = await deps.source.status(depositAddress, inv);
      if (!s) return reply.code(404).send({ error: '1Click does not know this deposit address' });
      const check = verifyAgainstInvoice(s, inv);
      if (!check.ok) return reply.code(400).send({ error: check.reason });
      if (BigInt(s.quoteResponse.quote.amountOut) < BigInt(inv.amount_usdc)) {
        return reply.code(400).send({ error: 'quote pays less than the invoice amount' });
      }
      if (mapStatus(s.status).final) return reply.code(409).send({ error: `deposit already ${s.status}` });
    }
    const { hash } = await callWithHash(deps.watcher, deps.dues.contractId, 'attach_deposit', {
      id: invoiceId,
      deposit_addr: depositAddress,
    });
    return { ok: true, hash };
  });

  app.post('/annotate', async (req, reply) => {
    const { invoiceId, hash } = (req.body ?? {}) as { invoiceId?: number; hash?: string };
    if (typeof invoiceId !== 'number' || typeof hash !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash)) {
      return reply.code(400).send({ error: 'invoiceId (number) and hash (base58 NEAR tx hash) are required' });
    }
    const inv = await deps.dues.invoice(invoiceId);
    if (!inv) return reply.code(404).send({ error: 'no such invoice' });
    if (!inv.client) return reply.code(409).send({ error: 'invoice has no payer yet' });
    if (inv.txs.some((t) => t.hash === hash)) return { ok: true, already: true };
    const { usdc_id: usdcId } = await deps.dues.config();
    let tx;
    try {
      tx = await fetchTx(deps.dues.provider, hash, inv.client);
    } catch (e) {
      return reply.code(404).send({ error: `transaction not found: ${(e as Error).message}` });
    }
    const check = checkClientTx(tx, inv, { usdcId, duesId: deps.dues.contractId });
    if (!check.ok) return reply.code(400).send({ error: check.reason });
    const res = await callWithHash(deps.watcher, deps.dues.contractId, 'annotate_tx', {
      id: invoiceId,
      index: check.index,
      hash,
    });
    return { ok: true, hash: res.hash };
  });

  return app;
}
