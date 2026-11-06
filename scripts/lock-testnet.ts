// CONFIRM_LOCK=yes pnpm lock:testnet  -  deletes the Dues contract account's own full-access key(s),
// after checking the deployed code has the owner-only update_contract. Afterwards no key can act as
// the contract account; code changes go through `pnpm deploy:testnet` (owner calls update_contract).
// Run once, on purpose.
import { DuesView } from '@dues/core/near';
import { banner, info, ok, tx } from './lib/print';
import { account, defaults, provider, readDeployment, writeDeployment } from './lib/testnet';

if (process.env.CONFIRM_LOCK !== 'yes') throw new Error('this deletes the contract account key: set CONFIRM_LOCK=yes');
const p = provider();
const id = defaults.contract;
banner(`locking ${id}`);
const code = await p.viewContractCode({ contractId: id });
if (!Buffer.from(code.code_base64, 'base64').includes(Buffer.from('update_contract'))) {
  throw new Error('deployed code has no update_contract; deploy it first or the contract would be frozen');
}
const cfg = await new DuesView(id, p).config();
info(`owner ${cfg.owner_id} can still upgrade the code`);
const keys = await p.viewAccessKeyList({ accountId: id });
const full = keys.keys.filter((k) => k.access_key.permission === 'FullAccess');
const acc = account(id, p);
const hashes: string[] = [];
for (const k of full) {
  const res = await acc.deleteKey(k.public_key);
  hashes.push(res.transaction.hash);
  tx(`deleted ${k.public_key}`, res.transaction.hash);
}
const d = readDeployment();
if (d && hashes[0]) {
  d.locked = { tx: hashes[0], recorded_at: new Date().toISOString() };
  writeDeployment(d);
}
ok(`${id} has no full-access key left`);
