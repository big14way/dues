// Testnet helpers: keys from the legacy NEAR CLI keychain (~/.near-credentials/testnet),
// the deployment record in deployments/testnet.json, and RPC.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { Account, JsonRpcProvider, type KeyPairString } from 'near-api-js';
import { USDC_NEAR_TESTNET } from '@dues/core';
import { accountWith } from '@dues/core/near';
import { ROOT } from './world';

export const TESTNET_RPC = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const KEY_DIR = path.join(homedir(), '.near-credentials', 'testnet');
export const DEPLOYMENT_FILE = path.join(ROOT, 'deployments', 'testnet.json');

export interface Deployment {
  network: 'testnet';
  contract: string;
  owner: string;
  watcher: string;
  relayer: string;
  usdc: string;
  code_sha256?: string;
  txs: Record<string, string>;
  /** Paid invoices recorded by `pnpm testnet:flow`, as proof. */
  flows?: { invoice: number; title: string; txs: Record<string, string>; recorded_at: string }[];
  locked?: { tx: string; recorded_at: string };
  recorded_at: string;
}

export const defaults = {
  contract: process.env.DUES_CONTRACT || 'dues.testnet',
  owner: process.env.OWNER_ACCOUNT_ID || 'dues-owner.testnet',
  relayer: process.env.RELAYER_ACCOUNT_ID || 'dues-relayer.testnet',
  watcher: process.env.WATCHER_ACCOUNT_ID || 'dues-watcher.testnet',
  freelancer: process.env.FREELANCER_ACCOUNT_ID || 'dues-freelancer.testnet',
  client: process.env.CLIENT_ACCOUNT_ID || 'dues-client.testnet',
  usdc: process.env.USDC_CONTRACT || USDC_NEAR_TESTNET,
};

export function provider(): JsonRpcProvider {
  return new JsonRpcProvider({ url: TESTNET_RPC });
}

export function keyOf(accountId: string): KeyPairString {
  const file = path.join(KEY_DIR, `${accountId}.json`);
  if (!existsSync(file)) throw new Error(`no key for ${accountId} at ${file} (run pnpm accounts:testnet)`);
  return (JSON.parse(readFileSync(file, 'utf8')) as { private_key: KeyPairString }).private_key;
}

/** Extra full-access keys the relayer rotates through (MultiKeySigner). */
export const RELAYER_EXTRA_KEYS = (id: string) => path.join(KEY_DIR, `${id}.extra-keys.json`);

export function relayerKeys(id: string): KeyPairString[] {
  const extra = RELAYER_EXTRA_KEYS(id);
  const more = existsSync(extra) ? (JSON.parse(readFileSync(extra, 'utf8')) as KeyPairString[]) : [];
  return [keyOf(id), ...more];
}

export function account(accountId: string, p = provider()): Account {
  return new Account(accountId, p, keyOf(accountId));
}

export function relayerAccount(id: string, p = provider()): Account {
  return accountWith(id, p, relayerKeys(id));
}

export function readDeployment(): Deployment | undefined {
  return existsSync(DEPLOYMENT_FILE) ? (JSON.parse(readFileSync(DEPLOYMENT_FILE, 'utf8')) as Deployment) : undefined;
}

export function writeDeployment(d: Deployment) {
  writeFileSync(DEPLOYMENT_FILE, `${JSON.stringify(d, null, 2)}\n`);
}

export async function exists(p: JsonRpcProvider, accountId: string): Promise<boolean> {
  try {
    await p.viewAccount({ accountId });
    return true;
  } catch {
    return false;
  }
}
