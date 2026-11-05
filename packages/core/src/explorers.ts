import type { NetworkId } from './constants';

/** NearBlocks link for a NEAR transaction (none on a local sandbox). */
export function nearTxUrl(network: NetworkId, hash: string): string | undefined {
  if (network === 'mainnet') return `https://nearblocks.io/txns/${hash}`;
  if (network === 'testnet') return `https://testnet.nearblocks.io/txns/${hash}`;
  return undefined;
}

export function nearAccountUrl(network: NetworkId, account: string): string | undefined {
  if (network === 'mainnet') return `https://nearblocks.io/address/${account}`;
  if (network === 'testnet') return `https://testnet.nearblocks.io/address/${account}`;
  return undefined;
}

const ORIGIN_EXPLORERS: Record<string, string> = {
  eth: 'https://etherscan.io/tx/',
  base: 'https://basescan.org/tx/',
  arb: 'https://arbiscan.io/tx/',
  op: 'https://optimistic.etherscan.io/tx/',
  pol: 'https://polygonscan.com/tx/',
  bsc: 'https://bscscan.com/tx/',
  avax: 'https://snowtrace.io/tx/',
  gnosis: 'https://gnosisscan.io/tx/',
  scroll: 'https://scrollscan.com/tx/',
  sol: 'https://solscan.io/tx/',
  tron: 'https://tronscan.org/#/transaction/',
  btc: 'https://mempool.space/tx/',
  ton: 'https://tonviewer.com/transaction/',
  sui: 'https://suiscan.xyz/mainnet/tx/',
  stellar: 'https://stellar.expert/explorer/public/tx/',
  xrp: 'https://xrpscan.com/tx/',
  near: 'https://nearblocks.io/txns/',
};

/** Explorer link for the chain the buyer paid from, when we know one. */
export function originTxUrl(chain: string | null | undefined, hash: string | null | undefined): string | undefined {
  if (!chain || !hash) return undefined;
  const base = ORIGIN_EXPLORERS[chain];
  return base ? `${base}${hash}` : undefined;
}
