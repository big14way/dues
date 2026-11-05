import { DEFAULT_RPC, type NetworkId } from '@dues/core';

export interface RelayerConfig {
  network: NetworkId;
  rpcUrl: string;
  contractId: string;
  relayerAccountId: string;
  relayerKeys: string[];
  port: number;
  host: string;
  corsOrigin: string | boolean;
}

function need(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} is not set (see .env.example)`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayerConfig {
  const network = (env.NEAR_NETWORK ?? 'sandbox') as NetworkId;
  const rpcUrl = env.NEAR_RPC_URL ?? (network === 'sandbox' ? 'http://127.0.0.1:3030' : DEFAULT_RPC[network]);
  return {
    network,
    rpcUrl,
    contractId: need(env, 'DUES_CONTRACT'),
    relayerAccountId: need(env, 'RELAYER_ACCOUNT_ID'),
    relayerKeys: need(env, 'RELAYER_PRIVATE_KEYS').split(','),
    port: Number(env.RELAYER_PORT ?? 3031),
    host: env.RELAYER_HOST ?? '127.0.0.1',
    corsOrigin: env.RELAYER_CORS_ORIGIN ?? true,
  };
}
