import { DEFAULT_RPC, type NetworkId } from '@dues/core';

export interface WatcherConfig {
  network: NetworkId;
  rpcUrl: string;
  contractId: string;
  watcherAccountId: string;
  watcherKey: string;
  dry: boolean;
  pollMs: number;
  port: number;
  host: string;
  oneClickJwt?: string;
  /** "client.near:ed25519:...,other.near:ed25519:..." pull-only keys clients granted. */
  pullKeys: { accountId: string; key: string }[];
  fixturesDir: string;
}

function need(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} is not set (see .env.example)`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WatcherConfig {
  const network = (env.NEAR_NETWORK ?? 'sandbox') as NetworkId;
  return {
    network,
    rpcUrl: env.NEAR_RPC_URL ?? (network === 'sandbox' ? 'http://127.0.0.1:3030' : DEFAULT_RPC[network]),
    contractId: need(env, 'DUES_CONTRACT'),
    watcherAccountId: need(env, 'WATCHER_ACCOUNT_ID'),
    watcherKey: need(env, 'WATCHER_PRIVATE_KEY'),
    dry: (env.DRY_RUN ?? (network === 'sandbox' ? 'true' : 'false')) === 'true',
    pollMs: Number(env.WATCHER_POLL_MS ?? 5000),
    port: Number(env.WATCHER_PORT ?? 3032),
    host: env.WATCHER_HOST ?? '127.0.0.1',
    oneClickJwt: env.ONECLICK_JWT || undefined,
    pullKeys: (env.PULL_KEYS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const i = s.indexOf(':');
        return { accountId: s.slice(0, i), key: s.slice(i + 1) };
      }),
    fixturesDir: env.FIXTURES_DIR ?? new URL('../../fixtures/1click/', import.meta.url).pathname,
  };
}
