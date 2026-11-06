// The freelancer's browser session key: a function-call key on their account that can only call
// create_invoice and cancel on the Dues contract, with no deposit. It signs NEP-366 delegate
// actions; the relayer submits them and pays the gas. Added once with a wallet approval
// (wallets cannot sign delegate actions themselves), revocable from the wallet at any time.
import { Account, KeyPair, type JsonRpcProvider, type KeyPairString } from 'near-api-js';
import { relay, signForRelay, type RelayResult } from '@dues/core/near';
import type { DuesConfig } from './config';

export const SESSION_METHODS = ['create_invoice', 'cancel'] as const;
/** Gas the key could burn if someone used it outside the relayer. Relayed calls never touch it. */
export const SESSION_ALLOWANCE = 10_000_000_000_000_000_000_000n; // 0.01 NEAR

export interface Session {
  publicKey: string;
  secret: KeyPairString;
}

const slot = (cfg: DuesConfig, account: string) => `dues:session:${cfg.network}:${cfg.contract}:${account}`;

export function storedSession(cfg: DuesConfig, account: string): Session | null {
  try {
    const raw = localStorage.getItem(slot(cfg, account));
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function newSession(cfg: DuesConfig, account: string): Session {
  const kp = KeyPair.fromRandom('ed25519');
  const s: Session = { publicKey: kp.getPublicKey().toString(), secret: kp.toString() as KeyPairString };
  try {
    localStorage.setItem(slot(cfg, account), JSON.stringify(s));
  } catch {
    /* storage blocked: key lives for this page only */
  }
  return s;
}

export function forgetSession(cfg: DuesConfig, account: string) {
  try {
    localStorage.removeItem(slot(cfg, account));
  } catch {
    /* ignore */
  }
}

/** True when the key is on the account and scoped to the Dues contract. */
export async function sessionOnChain(provider: JsonRpcProvider, cfg: DuesConfig, account: string, publicKey: string) {
  try {
    const key = await provider.viewAccessKey({ accountId: account, publicKey });
    const fc = (key.permission as { FunctionCall?: { receiver_id: string } }).FunctionCall;
    return fc?.receiver_id === cfg.contract;
  } catch {
    return false;
  }
}

export async function relayed(
  cfg: DuesConfig,
  provider: JsonRpcProvider,
  account: string,
  session: Session,
  method: (typeof SESSION_METHODS)[number],
  args: Record<string, unknown>,
): Promise<RelayResult> {
  const signer = new Account(account, provider, session.secret);
  const signed = await signForRelay(signer, cfg.contract, method, args);
  const res = await relay(`${cfg.apiBase}/relayer`, signed);
  if (res.status !== 'success') throw new Error(res.error ?? 'the call failed on-chain');
  return res;
}
