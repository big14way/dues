// API configuration from environment variables (see .env.example).
import { DEFAULT_RPC, type NetworkId } from '@dues/core';
import type { ApiOptions } from './router';

function list(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A deployment is missing configuration: answer 503, not a crash. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): ApiOptions {
  const network = (env.NEAR_NETWORK ?? 'testnet') as NetworkId;
  // Testnet falls back to the recorded deployment (deployments/testnet.json); there is no mainnet one.
  const contractId = env.DUES_CONTRACT || (network === 'testnet' ? 'dues.testnet' : undefined);
  if (!contractId) throw new ConfigError(`DUES_CONTRACT is not set (required on ${network})`);
  const relayerKeys = list(env.RELAYER_PRIVATE_KEYS);
  return {
    network,
    contractId,
    rpcUrl:
      env.NEAR_RPC_URL ??
      (network === 'sandbox' ? 'http://127.0.0.1:3030' : network === 'testnet' ? 'https://test.rpc.fastnear.com' : DEFAULT_RPC.mainnet),
    relayer: env.RELAYER_ACCOUNT_ID && relayerKeys.length ? { accountId: env.RELAYER_ACCOUNT_ID, keys: relayerKeys } : undefined,
    watcher:
      env.WATCHER_ACCOUNT_ID && env.WATCHER_PRIVATE_KEY
        ? { accountId: env.WATCHER_ACCOUNT_ID, key: env.WATCHER_PRIVATE_KEY }
        : undefined,
    oneClickJwt: env.ONECLICK_JWT || undefined,
    cronSecret: env.CRON_SECRET || undefined,
    pullKeys: list(env.PULL_KEYS).map((s) => {
      const i = s.indexOf(':');
      return { accountId: s.slice(0, i), key: s.slice(i + 1) };
    }),
    corsOrigin: env.API_CORS_ORIGIN ?? true,
    siteUrl: env.SITE_URL || undefined,
  };
}
