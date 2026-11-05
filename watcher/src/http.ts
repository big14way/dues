import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { mapStatus, verifyAgainstInvoice } from '@dues/core';
import { callWithHash, type DuesView } from '@dues/core/near';
import type { Account } from 'near-api-js';
import { isDryAddress, type StatusSource } from './sources';
import type { Watcher } from './watcher';

export interface WatcherHttpDeps {
  dues: DuesView;
  watcher: Account;
  loop: Watcher;
  source: StatusSource;
  corsOrigin?: string | boolean;
  logger?: boolean;
}

/**
 * Small HTTP surface for the checkout:
 *  GET  /status?depositAddress=  last status the watcher saw (or 1Click live), same shape as 1Click
 *  POST /track {invoiceId, depositAddress}  ties a 1Click deposit address to an invoice
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

  return app;
}
