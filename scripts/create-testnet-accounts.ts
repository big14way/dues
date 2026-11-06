// pnpm accounts:testnet  -  creates the Dues testnet accounts through the public faucet helper
// (free, no wallet needed). Keys go to ~/.near-credentials/testnet/, which the deploy and
// testnet scripts read. Existing accounts are left alone.
//
//   pnpm accounts:testnet                    # dues, dues-owner, dues-relayer, dues-watcher, dues-freelancer, dues-client
//   ACCOUNT_PREFIX=mydues pnpm accounts:testnet
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { KeyPair } from 'near-api-js';
import { banner, info, step } from './lib/print';

const HELPER = process.env.NEAR_HELPER_URL || 'https://helper.nearprotocol.com/account';
const RPC = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const prefix = process.env.ACCOUNT_PREFIX || 'dues';
export const TESTNET_ROLES: [string, string][] = [
  ['DUES_CONTRACT', `${prefix}.testnet`],
  ['OWNER_ACCOUNT_ID', `${prefix}-owner.testnet`],
  ['RELAYER_ACCOUNT_ID', `${prefix}-relayer.testnet`],
  ['WATCHER_ACCOUNT_ID', `${prefix}-watcher.testnet`],
  ['FREELANCER_ACCOUNT_ID', `${prefix}-freelancer.testnet`],
  ['CLIENT_ACCOUNT_ID', `${prefix}-client.testnet`],
];
const keyDir = join(homedir(), '.near-credentials', 'testnet');

async function exists(accountId: string): Promise<boolean> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: accountId },
    }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { cause?: { name?: string } } };
  if (body.result) return true;
  if (body.error?.cause?.name === 'UNKNOWN_ACCOUNT') return false;
  throw new Error(`view_account ${accountId}: ${JSON.stringify(body.error)}`);
}

banner('creating Dues testnet accounts via the faucet helper');
mkdirSync(keyDir, { recursive: true });
for (const [, accountId] of TESTNET_ROLES) {
  const keyFile = join(keyDir, `${accountId}.json`);
  if (await exists(accountId)) {
    info(`${accountId}: exists${existsSync(keyFile) ? ' (key in keychain)' : ' (NO local key: pick another ACCOUNT_PREFIX)'}`);
    continue;
  }
  step(`create ${accountId}`);
  const kp = KeyPair.fromRandom('ed25519');
  const publicKey = kp.getPublicKey().toString();
  const res = await fetch(HELPER, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
  });
  if (!res.ok) throw new Error(`faucet helper ${res.status}: ${(await res.text()).slice(0, 300)}`);
  writeFileSync(keyFile, JSON.stringify({ account_id: accountId, public_key: publicKey, private_key: kp.toString() }));
  chmodSync(keyFile, 0o600);
  info(`${accountId}: created, key saved to ${keyFile}`);
}

step('add these to .env');
for (const [name, accountId] of TESTNET_ROLES) console.log(`${name}=${accountId}`);
