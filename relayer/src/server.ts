import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Account, JsonRpcProvider } from 'near-api-js';
import { DecodeError, decodeSignedDelegate, publicKeyString, verifyDelegateSignature } from './codec';
import { SenderLimiter, checkPolicy, type RelayPolicy } from './policy';

export interface RelayerDeps {
  /** The account that pays gas. Use a MultiKeySigner with several keys for parallel relays. */
  relayer: Account;
  provider: JsonRpcProvider;
  policy: RelayPolicy;
  limiter?: SenderLimiter;
  corsOrigin?: string | string[] | boolean;
  logger?: boolean;
  /** Called after every relay attempt (for logs and demos). */
  onRelay?: (event: RelayEvent) => void;
  /**
   * USDC contract. When set, the relayer registers a freelancer with USDC
   * (NEP-145 storage deposit, 0.00125 NEAR, paid by the relayer) right after
   * their first relayed `create_invoice`, so payouts can reach them.
   * A browser session key is a function-call key and cannot attach that
   * deposit itself, so the relayer makes this call directly.
   */
  usdcId?: string;
}

export interface RelayEvent {
  senderId?: string;
  methods?: string[];
  ok: boolean;
  status: number;
  hash?: string;
  error?: string;
  /** Hash of the relayer's USDC storage_deposit for the sender, when it made one. */
  registeredHash?: string;
}

/** Registers `accountId` with the USDC contract unless it already is. Returns the tx hash, or undefined. */
export async function ensureUsdcRegistration(
  relayer: Account,
  provider: JsonRpcProvider,
  usdcId: string,
  accountId: string,
  deposit: bigint,
): Promise<string | undefined> {
  const bal = await provider.callFunction({
    contractId: usdcId,
    method: 'storage_balance_of',
    args: { account_id: accountId },
  });
  if (bal) return undefined;
  const res = await relayer.callFunctionRaw({
    contractId: usdcId,
    methodName: 'storage_deposit',
    args: { account_id: accountId, registration_only: true },
    deposit,
    gas: 30_000_000_000_000n,
  });
  return res.transaction.hash;
}

type Outcome = { outcome: { status: unknown } };

/** First failed receipt in a relayed transaction, if any (the inner call can fail even when the relay succeeds). */
export function firstFailure(res: { receipts_outcome?: Outcome[]; status?: unknown }): string | undefined {
  const fail = (s: unknown) =>
    s && typeof s === 'object' && 'Failure' in (s as Record<string, unknown>)
      ? JSON.stringify((s as Record<string, unknown>).Failure)
      : undefined;
  for (const r of res.receipts_outcome ?? []) {
    const f = fail(r.outcome.status);
    if (f) return f;
  }
  return fail(res.status);
}

/**
 * Return value of the relayed call. In a meta-transaction the transaction's
 * own status belongs to the Delegate action (empty), so the value is read from
 * the receipt the contract executed.
 */
export function relayedValue(
  res: { receipts_outcome?: { outcome: { executor_id?: string; status: unknown } }[] },
  contractId: string,
): unknown {
  for (const r of res.receipts_outcome ?? []) {
    if (r.outcome.executor_id !== contractId) continue;
    const s = r.outcome.status as { SuccessValue?: string } | undefined;
    if (s && typeof s.SuccessValue === 'string') {
      if (s.SuccessValue === '') return null;
      try {
        return JSON.parse(Buffer.from(s.SuccessValue, 'base64').toString('utf8'));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

export async function buildServer(deps: RelayerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 64 * 1024 });
  await app.register(cors, { origin: deps.corsOrigin ?? true });
  const limiter = deps.limiter ?? new SenderLimiter();

  app.get('/health', async () => ({
    ok: true,
    relayer: deps.relayer.accountId,
    contract: deps.policy.contractId,
  }));

  app.get('/policy', async () => json(deps.policy));

  app.post('/relay', async (req, reply) => {
    const send = (status: number, body: Record<string, unknown>, event: Partial<RelayEvent> = {}) => {
      deps.onRelay?.({ ok: status === 200 && body.status === 'success', status, error: body.error as string, ...event });
      return reply.code(status).send(body);
    };
    const body = req.body as { signedDelegate?: unknown } | string | undefined;
    const b64 = typeof body === 'string' ? body : body?.signedDelegate;
    let decoded;
    try {
      decoded = decodeSignedDelegate(String(b64 ?? ''));
    } catch (e) {
      const msg = e instanceof DecodeError ? e.message : 'could not decode signedDelegate';
      return send(400, { error: msg, code: 'bad_request' });
    }
    const senderId = decoded.delegateAction.senderId;
    if (!verifyDelegateSignature(decoded)) {
      return send(401, { error: 'signature does not match the delegate action', code: 'bad_signature' }, { senderId });
    }
    const block = await deps.provider.viewBlock({ finality: 'final' });
    const policy = checkPolicy(decoded, deps.policy, {
      currentHeight: BigInt(block.header.height),
      relayerId: deps.relayer.accountId,
    });
    if (!policy.ok) return send(403, { error: policy.reason, code: policy.code }, { senderId });
    const limit = limiter.allow(senderId, policy.methods);
    if (!limit.ok) return send(429, { error: limit.reason, code: 'rate_limited' }, { senderId, methods: policy.methods });

    try {
      const res = await deps.relayer.relayMetaTransaction(decoded as never);
      const failure = firstFailure(res as never);
      const value = failure ? null : relayedValue(res as never, deps.policy.contractId);
      let registeredHash: string | undefined;
      if (!failure && deps.usdcId && policy.methods.includes('create_invoice')) {
        try {
          registeredHash = await ensureUsdcRegistration(
            deps.relayer,
            deps.provider,
            deps.usdcId,
            senderId,
            deps.policy.storageDepositYocto,
          );
        } catch (e) {
          req.log.warn({ err: (e as Error).message, senderId }, 'USDC registration failed');
        }
      }
      const out = {
        hash: res.transaction.hash,
        status: failure ? 'failure' : 'success',
        sender: senderId,
        key: publicKeyString(decoded),
        methods: policy.methods,
        value: json(value ?? null),
        error: failure,
        registeredHash,
      };
      return send(200, out, { senderId, methods: policy.methods, hash: out.hash, registeredHash });
    } catch (e) {
      return send(502, { error: (e as Error).message, code: 'relay_failed' }, { senderId, methods: policy.methods });
    }
  });

  return app;
}
