// A local NEAR sandbox with everything Dues needs: mock USDC, the Dues
// contract, a relayer with three keys, a watcher, a stand-in for 1Click's
// solver (it delivers USDC in dry runs), a freelancer and a client.
// No keys, accounts or funds from any real network are involved.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto, teraToGas, type KeyPairString } from 'near-api-js';
import { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY, Sandbox } from 'near-sandbox';
import { accountWith, callWithHash } from '@dues/core/near';
import { USDC_STORAGE_DEPOSIT_YOCTO } from '@dues/core';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const USDC = 1_000_000n;
export const DAY_MS = 86_400_000;

export interface Role {
  id: string;
  key: KeyPairString;
  account: Account;
}

export interface World {
  sandbox: Sandbox;
  rpcUrl: string;
  provider: JsonRpcProvider;
  usdc: string;
  dues: string;
  owner: Role;
  watcher: Role;
  /** Pays gas for meta-transactions. Three full-access keys, rotated to avoid nonce contention. */
  relayer: { id: string; keys: KeyPairString[]; account: Account };
  /** Stands in for 1Click's solver: delivers USDC to the freelancer when a dry swap "succeeds". */
  solver: Role;
  /** Freelancer. */
  ada: Role;
  /** Client who holds USDC on NEAR. */
  acme: Role;
  stop(): Promise<void>;
}

export function wasm(name: 'dues' | 'mock_usdc'): Uint8Array {
  const file = path.join(ROOT, 'contracts', 'target', 'near', name, `${name}.wasm`);
  if (!existsSync(file)) throw new Error(`${file} is missing: run pnpm build:contract`);
  return readFileSync(file);
}

async function rpcCall(url: string, method: string, params: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'dues', method, params }),
  });
  const body = (await res.json()) as { result?: unknown; error?: unknown };
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function head(url: string): Promise<{ height: number; ms: number }> {
  const b = await rpcCall(url, 'block', { finality: 'final' });
  return { height: b.header.height, ms: Math.floor(Number(b.header.timestamp_nanosec) / 1e6) };
}

async function waitForHeight(url: string, height: number, timeoutMs = 180_000) {
  const t0 = Date.now();
  while ((await head(url)).height < height) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`sandbox did not reach height ${height}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Waits `n` final blocks, so refund receipts from earlier transactions have landed. */
export async function waitBlocks(url: string, n: number) {
  await waitForHeight(url, (await head(url)).height + n);
}

/** Chain time on the latest final block, in Unix ms. */
export async function chainNowMs(url: string): Promise<number> {
  return (await head(url)).ms;
}

/**
 * Moves sandbox block time forward by at least `ms`. Needs the long epoch set
 * in startWorld. Waits on the final head so the next transaction references a
 * block from after the jump.
 */
export async function fastForward(url: string, ms: number) {
  const start = await head(url);
  await rpcCall(url, 'sandbox_fast_forward', { delta_height: 100 });
  await waitForHeight(url, start.height + 100);
  let now = await head(url);
  const perBlock = Math.max(1, (now.ms - start.ms) / (now.height - start.height));
  for (let i = 0; i < 8 && now.ms < start.ms + ms; i++) {
    const blocks = Math.ceil((start.ms + ms - now.ms) / perBlock);
    const delta = blocks + Math.ceil(blocks / 10) + 10;
    await rpcCall(url, 'sandbox_fast_forward', { delta_height: delta });
    await waitForHeight(url, now.height + delta);
    now = await head(url);
  }
  await waitForHeight(url, now.height + 2);
}

export async function usdcBalance(w: Pick<World, 'provider' | 'usdc'>, accountId: string): Promise<bigint> {
  const v = await w.provider.callFunction({ contractId: w.usdc, method: 'ft_balance_of', args: { account_id: accountId } });
  return BigInt(String(v ?? '0'));
}

export async function nearBalance(provider: JsonRpcProvider, accountId: string): Promise<bigint> {
  const a = await provider.viewAccount({ accountId });
  return BigInt(a.amount);
}

export async function startWorld(log: (s: string) => void = () => {}): Promise<World> {
  log('starting a local NEAR sandbox (the first run downloads the node binary)');
  const sandbox = await Sandbox.start({ config: { additionalGenesis: { epoch_length: 500_000 } } });
  try {
    const rpcUrl = sandbox.rpcUrl;
    const provider = new JsonRpcProvider({ url: rpcUrl });
    const root = new Account(DEFAULT_ACCOUNT_ID, provider, DEFAULT_PRIVATE_KEY as KeyPairString);

    const create = async (name: string, near: `${number}`): Promise<Role> => {
      const kp = KeyPair.fromRandom('ed25519');
      const id = `${name}.${DEFAULT_ACCOUNT_ID}`;
      await root.createAccount({ newAccountId: id, publicKey: kp.getPublicKey(), nearToTransfer: nearToYocto(near) });
      const key = kp.toString() as KeyPairString;
      return { id, key, account: new Account(id, provider, key) };
    };

    log('creating accounts: owner, dues, usdc, relayer, watcher, solver, ada (freelancer), acme (client)');
    const owner = await create('owner', '20');
    const duesAcc = await create('dues', '30');
    const usdcAcc = await create('usdc', '20');
    const relayerMain = await create('relayer', '50');
    const watcher = await create('watcher', '10');
    const solver = await create('solver', '10');
    const ada = await create('ada', '5');
    const acme = await create('acme', '10');

    // Two more full-access keys on the relayer so parallel relays never share a nonce.
    const relayerKeys: KeyPairString[] = [relayerMain.key];
    for (let i = 0; i < 2; i++) {
      const kp = KeyPair.fromRandom('ed25519');
      await relayerMain.account.addFullAccessKey(kp.getPublicKey());
      relayerKeys.push(kp.toString() as KeyPairString);
    }
    const relayer = { id: relayerMain.id, keys: relayerKeys, account: accountWith(relayerMain.id, provider, relayerKeys) };

    log('deploying mock USDC (NEP-141, 6 decimals) and the Dues contract');
    await usdcAcc.account.signAndSendTransaction({
      receiverId: usdcAcc.id,
      actions: [
        actions.deployContract(wasm('mock_usdc')),
        actions.functionCall('new', { owner_id: usdcAcc.id, total_supply: '0' }, teraToGas(50), 0n),
      ],
    });
    await duesAcc.account.signAndSendTransaction({
      receiverId: duesAcc.id,
      actions: [
        actions.deployContract(wasm('dues')),
        actions.functionCall('new', { owner_id: owner.id, watcher_id: watcher.id, usdc_id: usdcAcc.id }, teraToGas(50), 0n),
      ],
    });

    log('registering the Dues contract with USDC; minting test USDC to the client and the solver stand-in');
    await callWithHash(owner.account, usdcAcc.id, 'storage_deposit', { account_id: duesAcc.id, registration_only: true }, {
      deposit: USDC_STORAGE_DEPOSIT_YOCTO,
    });
    await callWithHash(usdcAcc.account, usdcAcc.id, 'mint', { account_id: acme.id, amount: (10_000n * USDC).toString() });
    await callWithHash(usdcAcc.account, usdcAcc.id, 'mint', { account_id: solver.id, amount: (1_000_000n * USDC).toString() });

    return {
      sandbox,
      rpcUrl,
      provider,
      usdc: usdcAcc.id,
      dues: duesAcc.id,
      owner,
      watcher,
      relayer,
      solver,
      ada,
      acme,
      stop: () => sandbox.tearDown(),
    };
  } catch (e) {
    await sandbox.tearDown().catch(() => {});
    throw e;
  }
}

/** What 1Click does on SUCCESS, simulated: the solver sends the invoice amount to the freelancer. */
export function solverSettle(w: Pick<World, 'solver' | 'usdc'>) {
  return async (inv: { freelancer: string; amount_usdc: string; id: number }, depositAddress: string) => {
    const { hash } = await callWithHash(
      w.solver.account,
      w.usdc,
      'ft_transfer',
      { receiver_id: inv.freelancer, amount: inv.amount_usdc, memo: `1Click deposit ${depositAddress}` },
      { deposit: 1n },
    );
    return hash;
  };
}

/**
 * The freelancer's one wallet approval: a browser session key that can only
 * call `create_invoice` and `cancel` on Dues. It cannot attach deposits, so it
 * cannot move money. Everything signed with it afterwards is relayed.
 */
export async function addSessionKey(owner: Role, duesId: string, provider: JsonRpcProvider) {
  const kp = KeyPair.fromRandom('ed25519');
  const res = await owner.account.addFunctionCallAccessKey({
    publicKey: kp.getPublicKey(),
    contractId: duesId,
    methodNames: ['create_invoice', 'cancel'],
    allowance: nearToYocto('0.01'),
  });
  const key = kp.toString() as KeyPairString;
  return { hash: res.transaction.hash, publicKey: kp.getPublicKey().toString(), account: new Account(owner.id, provider, key) };
}
