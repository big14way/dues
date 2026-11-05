/**
 * NEAR helpers shared by the relayer, the watcher, the scripts and the app.
 * Kept out of the main entry so the widget bundle stays free of near-api-js.
 */
import {
  Account,
  JsonRpcProvider,
  KeyPairSigner,
  MultiKeySigner,
  actions,
  base64Encode,
  encodeSignedDelegate,
  getTransactionLastResult,
  teraToGas,
  type KeyPairString,
  type Signer,
} from 'near-api-js';
import type { DuesConfig, Invoice, LineItem, Recurrence } from './invoice';

export type { KeyPairString };

export function rpc(url: string): JsonRpcProvider {
  return new JsonRpcProvider({ url });
}

/** One key -> KeyPairSigner, several -> MultiKeySigner (rotates keys to avoid nonce contention). */
export function signerFromKeys(keys: string[]): Signer {
  const clean = keys.map((k) => k.trim()).filter(Boolean) as KeyPairString[];
  if (clean.length === 0) throw new Error('no private keys configured');
  if (clean.length === 1) return KeyPairSigner.fromSecretKey(clean[0]!);
  return MultiKeySigner.fromSecretKeys(clean);
}

export function accountWith(accountId: string, provider: JsonRpcProvider, keys: string[]): Account {
  return new Account(accountId, provider, signerFromKeys(keys));
}

export interface TxResult<T = unknown> {
  hash: string;
  value: T;
}

/** Calls a contract method and returns the NEAR tx hash with the decoded return value. */
export async function callWithHash<T = unknown>(
  account: Account,
  contractId: string,
  methodName: string,
  args: Record<string, unknown>,
  opts: { gasTera?: number; deposit?: bigint } = {},
): Promise<TxResult<T>> {
  const res = await account.callFunctionRaw({
    contractId,
    methodName,
    args,
    gas: teraToGas(opts.gasTera ?? 30),
    deposit: opts.deposit ?? 0n,
  });
  return { hash: res.transaction.hash, value: getTransactionLastResult(res) as T };
}

export interface CreateInvoiceArgs {
  title: string;
  amount_usdc: string;
  due_ts: number;
  recurrence?: Recurrence;
  client?: string | null;
  items?: LineItem[];
}

/** Read-only view of the Dues contract. */
export class DuesView {
  constructor(
    readonly contractId: string,
    readonly provider: JsonRpcProvider,
  ) {}

  async view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return (await this.provider.callFunction({ contractId: this.contractId, method, args })) as T;
  }

  config(): Promise<DuesConfig> {
    return this.view('get_config');
  }
  invoice(id: number): Promise<Invoice | null> {
    return this.view('get_invoice', { id });
  }
  byFreelancer(accountId: string, limit = 100): Promise<Invoice[]> {
    return this.view('list_by_freelancer', { account_id: accountId, limit });
  }
  byClient(accountId: string, limit = 100): Promise<Invoice[]> {
    return this.view('list_by_client', { account_id: accountId, limit });
  }
  openDeposits(limit = 100): Promise<Invoice[]> {
    return this.view('list_open_deposits', { limit });
  }
  dueRetainers(limit = 100): Promise<Invoice[]> {
    return this.view('list_due_retainers', { limit });
  }
  retainers(limit = 100): Promise<Invoice[]> {
    return this.view('list_retainers', { limit });
  }
}

/**
 * Signs a NEP-366 delegate action for one Dues method and returns it base64
 * encoded, ready for `POST /relay`. The user's key signs; the relayer pays gas.
 */
export async function signForRelay(
  account: Account,
  contractId: string,
  methodName: 'create_invoice' | 'cancel' | 'storage_deposit',
  args: Record<string, unknown>,
  opts: { gasTera?: number; deposit?: bigint; blockHeightTtl?: number } = {},
): Promise<string> {
  const { signedDelegate } = await account.createSignedMetaTransaction({
    receiverId: contractId,
    actions: [actions.functionCall(methodName, args, teraToGas(opts.gasTera ?? 30), opts.deposit ?? 0n)],
    blockHeightTtl: opts.blockHeightTtl ?? 120,
  });
  return base64Encode(encodeSignedDelegate(signedDelegate));
}

/** Posts a signed delegate to a Dues relayer. */
export async function relay(
  relayerUrl: string,
  signedDelegate: string,
): Promise<{ hash: string; status: string; value?: unknown }> {
  const res = await fetch(`${relayerUrl.replace(/\/$/, '')}/relay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signedDelegate }),
  });
  const body = (await res.json()) as { hash?: string; status?: string; value?: unknown; error?: string };
  if (!res.ok || !body.hash) throw new Error(body.error ?? `relayer answered ${res.status}`);
  return { hash: body.hash, status: body.status ?? 'unknown', value: body.value };
}
