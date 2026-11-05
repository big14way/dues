import type { DecodedDelegate, FunctionCallAction } from './codec';
import { argsJson } from './codec';

/** What this relayer is willing to pay for. Everything else is refused. */
export interface RelayPolicy {
  /** The only receiver allowed: the Dues contract. */
  contractId: string;
  /** The only methods allowed on it. */
  allowedMethods: readonly string[];
  /** Upper bound on gas per action (yoctogas units as bigint). */
  maxGasPerAction: bigint;
  /** Upper bound on actions in one delegate. */
  maxActions: number;
  /** Deposit the relayer may attach to `storage_deposit` (USDC registration). */
  storageDepositYocto: bigint;
  /** A delegate may not stay valid for more blocks than this. */
  maxTtlBlocks: number;
  /** Max JSON args size, bytes. */
  maxArgsBytes: number;
}

export const DEFAULT_ALLOWED_METHODS = ['create_invoice', 'cancel', 'storage_deposit'] as const;

export function defaultPolicy(contractId: string): RelayPolicy {
  return {
    contractId,
    allowedMethods: DEFAULT_ALLOWED_METHODS,
    maxGasPerAction: 50_000_000_000_000n, // 50 Tgas
    maxActions: 2,
    storageDepositYocto: 1_250_000_000_000_000_000_000n, // 0.00125 NEAR
    maxTtlBlocks: 600,
    maxArgsBytes: 4096,
  };
}

export type PolicyResult =
  | { ok: true; senderId: string; methods: string[]; deposit: bigint }
  | { ok: false; code: string; reason: string };

function deny(code: string, reason: string): PolicyResult {
  return { ok: false, code, reason };
}

/**
 * Pure policy check on a decoded SignedDelegate. `currentHeight`, when given,
 * bounds the delegate's lifetime. `relayerId` stops the relayer sponsoring itself.
 */
export function checkPolicy(
  d: DecodedDelegate,
  policy: RelayPolicy,
  opts: { currentHeight?: bigint; relayerId?: string } = {},
): PolicyResult {
  const da = d.delegateAction;
  if (da.receiverId !== policy.contractId) {
    return deny('receiver_not_allowed', `this relayer only pays for calls to ${policy.contractId}`);
  }
  if (opts.relayerId && da.senderId === opts.relayerId) {
    return deny('sender_not_allowed', 'the relayer does not relay for itself');
  }
  if (!da.publicKey.ed25519Key) return deny('key_type', 'only ed25519 keys are supported');
  if (da.actions.length === 0 || da.actions.length > policy.maxActions) {
    return deny('action_count', `between 1 and ${policy.maxActions} actions per request`);
  }
  if (opts.currentHeight !== undefined) {
    if (da.maxBlockHeight <= opts.currentHeight) return deny('expired', 'delegate already expired');
    if (da.maxBlockHeight - opts.currentHeight > BigInt(policy.maxTtlBlocks)) {
      return deny('ttl_too_long', `delegate must expire within ${policy.maxTtlBlocks} blocks`);
    }
  }
  const methods: string[] = [];
  let deposit = 0n;
  for (const action of da.actions) {
    const keys = Object.keys(action).filter((k) => k !== 'enum');
    if (keys.length !== 1 || keys[0] !== 'functionCall') {
      return deny('action_not_allowed', `only function calls are relayed, got ${keys.join(',') || 'nothing'}`);
    }
    const fc = (action as { functionCall: FunctionCallAction }).functionCall;
    if (!policy.allowedMethods.includes(fc.methodName)) {
      return deny('method_not_allowed', `method ${fc.methodName} is not sponsored`);
    }
    if (fc.gas > policy.maxGasPerAction) return deny('gas_too_high', 'gas above the sponsored limit');
    const argsLen = fc.args.length;
    if (argsLen > policy.maxArgsBytes) return deny('args_too_large', 'arguments too large');
    if (argsLen > 0) {
      try {
        const parsed = argsJson(fc);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return deny('bad_args', 'arguments must be a JSON object');
        }
      } catch {
        return deny('bad_args', 'arguments must be JSON');
      }
    }
    if (fc.methodName === 'storage_deposit') {
      if (fc.deposit !== policy.storageDepositYocto) {
        return deny('deposit_not_allowed', `storage_deposit must attach exactly ${policy.storageDepositYocto} yoctoNEAR`);
      }
    } else if (fc.deposit !== 0n) {
      return deny('deposit_not_allowed', `${fc.methodName} must not attach a deposit`);
    }
    deposit += fc.deposit;
    methods.push(fc.methodName);
  }
  return { ok: true, senderId: da.senderId, methods, deposit };
}

/** Fixed-window per-sender limiter, plus a one-time rule for storage_deposit. */
export class SenderLimiter {
  private hits = new Map<string, number[]>();
  private registered = new Set<string>();

  constructor(
    private readonly maxPerWindow = 20,
    private readonly windowMs = 10 * 60_000,
  ) {}

  allow(senderId: string, methods: string[], now = Date.now()): { ok: true } | { ok: false; reason: string } {
    if (methods.includes('storage_deposit') && this.registered.has(senderId)) {
      return { ok: false, reason: 'storage_deposit is sponsored once per account' };
    }
    const recent = (this.hits.get(senderId) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.maxPerWindow) {
      return { ok: false, reason: `rate limit: ${this.maxPerWindow} requests per ${this.windowMs / 60_000} minutes` };
    }
    recent.push(now);
    this.hits.set(senderId, recent);
    if (methods.includes('storage_deposit')) this.registered.add(senderId);
    return { ok: true };
  }
}
