// Runtime configuration. Defaults are the recorded testnet deployment (deployments/testnet.json);
// NEXT_PUBLIC_* overrides them at build time, and /dues-config.json (written by `pnpm sandbox`)
// overrides both at runtime so the same build can point at a local sandbox.
import { USDC_NEAR_MAINNET, USDC_NEAR_TESTNET, nearAccountUrl, nearTxUrl, originTxUrl, type NetworkId } from '@dues/core';

export interface DevAccount {
  id: string;
  key: string;
  role: 'freelancer' | 'client';
}

export interface DuesConfig {
  network: NetworkId;
  rpcUrl: string;
  contract: string;
  usdc: string;
  /** Base of the API: `${apiBase}/relayer/relay`, `${apiBase}/watcher/status`, ... */
  apiBase: string;
  checkout: {
    /** Quote with `dry: true`: live prices, no deposit address, nothing can be paid. */
    dry: boolean;
    /** Link deposit addresses to invoices and poll the watcher (needs a configured watcher). */
    track: boolean;
  };
  /** Sandbox only: accounts the app can sign with directly, instead of a wallet. */
  devAccounts?: DevAccount[];
}

const network = (process.env.NEXT_PUBLIC_NETWORK as NetworkId | undefined) ?? 'testnet';

export const DEFAULT_CONFIG: DuesConfig = {
  network,
  rpcUrl:
    process.env.NEXT_PUBLIC_RPC_URL ??
    (network === 'mainnet' ? 'https://free.rpc.fastnear.com' : 'https://test.rpc.fastnear.com'),
  // dues.testnet is the recorded deployment. There is no mainnet one: set NEXT_PUBLIC_DUES_CONTRACT there.
  contract: process.env.NEXT_PUBLIC_DUES_CONTRACT ?? (network === 'mainnet' ? '' : 'dues.testnet'),
  usdc: network === 'mainnet' ? USDC_NEAR_MAINNET : USDC_NEAR_TESTNET,
  apiBase: process.env.NEXT_PUBLIC_API_BASE ?? '/api',
  checkout: {
    // 1Click has no testnet: on testnet the any-chain checkout is a dry run.
    dry: process.env.NEXT_PUBLIC_CHECKOUT_DRY ? process.env.NEXT_PUBLIC_CHECKOUT_DRY === 'true' : network !== 'mainnet',
    track: network === 'mainnet',
  },
};

export async function loadConfig(): Promise<DuesConfig> {
  try {
    const res = await fetch('/dues-config.json', { cache: 'no-store' });
    if (res.ok) return { ...DEFAULT_CONFIG, ...((await res.json()) as Partial<DuesConfig>) };
  } catch {
    /* no runtime config: use defaults */
  }
  return DEFAULT_CONFIG;
}

export function txUrl(cfg: DuesConfig, hash: string): string | undefined {
  return nearTxUrl(cfg.network, hash);
}

/** Origin-chain explorer link. None on the sandbox, whose 1Click hashes are recorded placeholders. */
export function originUrl(cfg: DuesConfig, chain: string | null, hash: string | null): string | undefined {
  return cfg.network === 'sandbox' ? undefined : originTxUrl(chain, hash);
}

export function accountUrl(cfg: DuesConfig, account: string): string | undefined {
  return nearAccountUrl(cfg.network, account);
}

export function networkLabel(n: NetworkId): string {
  return n === 'mainnet' ? 'NEAR mainnet' : n === 'testnet' ? 'NEAR testnet' : 'local sandbox';
}
