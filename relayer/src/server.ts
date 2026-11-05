import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { getTransactionLastResult, type Account, type JsonRpcProvider } from 'near-api-js';
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
}

export interface RelayEvent {
  senderId?: string;
  methods?: string[];
  ok: boolean;
  status: number;
  hash?: string;
  error?: string;
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
      let value: unknown;
      if (!failure) {
        try {
          value = getTransactionLastResult(res);
        } catch {
          value = undefined;
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
      };
      return send(200, out, { senderId, methods: policy.methods, hash: out.hash });
    } catch (e) {
      return send(502, { error: (e as Error).message, code: 'relay_failed' }, { senderId, methods: policy.methods });
    }
  });

  return app;
}
