// API configuration from environment variables (see .env.example).
import { DEFAULT_RPC, type NetworkId } from '@dues/core';
import type { ApiOptions } from './router';

function list(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): ApiOptions {
  const network = (env.NEAR_NETWORK ?? 'testnet') as NetworkId;
  const contractId = env.DUES_CONTRACT;
  if (!contractId) throw new Error('DUES_CONTRACT is not set');
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
  };
}
