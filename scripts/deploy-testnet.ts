// pnpm deploy:testnet  -  deploys contracts/dues to dues.testnet and records it in deployments/testnet.json.
// Idempotent: a second run redeploys code through the owner's update_contract when the account is
// locked, initialises only once, and skips steps already done.
//   1. deploy + new(owner, watcher, usdc)   (or owner update_contract if already initialised)
//   2. register the contract with testnet USDC (it holds retainer escrow)
//   3. give the relayer two extra full-access keys (MultiKeySigner, no nonce contention)
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { KeyPair, actions, teraToGas, type KeyPairString } from 'near-api-js';
import { USDC_STORAGE_DEPOSIT_YOCTO } from '@dues/core';
import { DuesView, callWithHash } from '@dues/core/near';
import { banner, info, ok, step, tx } from './lib/print';
import { RELAYER_EXTRA_KEYS, account, defaults, provider, readDeployment, relayerKeys, writeDeployment, type Deployment } from './lib/testnet';
import { ROOT, wasm } from './lib/world';

const p = provider();
const cfg = defaults;
const code = wasm('dues');
const sha = createHash('sha256').update(code).digest('hex');
const prev = readDeployment();
const txs: Record<string, string> = { ...(prev?.txs ?? {}) };
banner(`deploying Dues to ${cfg.contract} (testnet)`);
info(`wasm ${(code.length / 1024).toFixed(0)} KB sha256 ${sha}`);

const view = new DuesView(cfg.contract, p);
const initialised = await view.config().then(
  () => true,
  () => false,
);
if (!initialised) {
  step('deploy and initialise');
  const res = await account(cfg.contract, p).signAndSendTransaction({
    receiverId: cfg.contract,
    actions: [
      actions.deployContract(code),
      actions.functionCall('new', { owner_id: cfg.owner, watcher_id: cfg.watcher, usdc_id: cfg.usdc }, teraToGas(50), 0n),
    ],
  });
  txs.deploy = res.transaction.hash;
  tx('deploy + new', txs.deploy);
} else if (prev?.code_sha256 !== sha) {
  step('code changed: owner calls update_contract');
  const res = await account(cfg.owner, p).callFunctionRaw({
    contractId: cfg.contract,
    methodName: 'update_contract',
    args: code,
    gas: teraToGas(200),
  });
  txs[`upgrade_${new Date().toISOString().slice(0, 10)}`] = res.transaction.hash;
  tx('update_contract', res.transaction.hash);
} else {
  ok('already deployed with this code');
}
const config = await view.config();
info(`config ${JSON.stringify(config)}`);

step('register the contract with USDC');
const bal = await p.callFunction({ contractId: cfg.usdc, method: 'storage_balance_of', args: { account_id: cfg.contract } });
if (bal) ok('already registered');
else {
  const r = await callWithHash(account(cfg.owner, p), cfg.usdc, 'storage_deposit', { account_id: cfg.contract, registration_only: true }, {
    deposit: USDC_STORAGE_DEPOSIT_YOCTO,
  });
  txs.usdc_register = r.hash;
  tx('storage_deposit', r.hash);
}

step('relayer keys');
const keys = relayerKeys(cfg.relayer);
if (keys.length >= 3) ok(`${keys.length} keys already`);
else {
  const relayer = account(cfg.relayer, p);
  const extra: KeyPairString[] = keys.slice(1);
  while (extra.length < 2) {
    const kp = KeyPair.fromRandom('ed25519');
    const r = await relayer.addFullAccessKey(kp.getPublicKey());
    extra.push(kp.toString() as KeyPairString);
    tx(`add relayer key ${extra.length + 1}`, r.transaction.hash);
  }
  const file = RELAYER_EXTRA_KEYS(cfg.relayer);
  writeFileSync(file, JSON.stringify(extra), { mode: 0o600 });
  info(`extra keys saved to ${file}`);
}

const d: Deployment = {
  network: 'testnet',
  contract: cfg.contract,
  owner: config.owner_id,
  watcher: config.watcher_id,
  relayer: cfg.relayer,
  usdc: config.usdc_id,
  code_sha256: sha,
  txs,
  flows: prev?.flows,
  locked: prev?.locked,
  recorded_at: new Date().toISOString(),
};
mkdirSync(path.join(ROOT, 'deployments'), { recursive: true });
writeDeployment(d);
ok(`recorded in deployments/testnet.json`);
info(`https://testnet.nearblocks.io/address/${cfg.contract}`);
