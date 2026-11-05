import { OneClick, type OneClickToken } from '@dues/core';
import fallback from '../../../fixtures/1click/tokens.json';

const CACHE_KEY = 'dues:1click-tokens:v1';
const CACHE_MS = 10 * 60_000;

/** Bundled copy of GET /v0/tokens, used when the API is unreachable. */
export const FALLBACK_TOKENS = fallback as OneClickToken[];

function readCache(): OneClickToken[] | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY);
    if (!raw) return undefined;
    const { at, tokens } = JSON.parse(raw) as { at: number; tokens: OneClickToken[] };
    return Date.now() - at < CACHE_MS && Array.isArray(tokens) ? tokens : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(tokens: OneClickToken[]) {
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), tokens }));
  } catch {
    /* storage unavailable: fine */
  }
}

export interface LoadedTokens {
  tokens: OneClickToken[];
  source: 'live' | 'cache' | 'bundled';
}

/** Live list from 1Click, cached for 10 minutes, falling back to the bundled copy. */
export async function loadTokens(api = new OneClick()): Promise<LoadedTokens> {
  const cached = readCache();
  if (cached) return { tokens: cached, source: 'cache' };
  try {
    const tokens = await api.tokens();
    if (Array.isArray(tokens) && tokens.length > 0) {
      writeCache(tokens);
      return { tokens, source: 'live' };
    }
  } catch {
    /* fall through */
  }
  return { tokens: FALLBACK_TOKENS, source: 'bundled' };
}

export const CHAIN_NAMES: Record<string, string> = {
  base: 'Base',
  eth: 'Ethereum',
  sol: 'Solana',
  arb: 'Arbitrum',
  op: 'Optimism',
  pol: 'Polygon',
  bsc: 'BNB Chain',
  tron: 'Tron',
  btc: 'Bitcoin',
  near: 'NEAR',
  ton: 'TON',
  sui: 'Sui',
  stellar: 'Stellar',
  avax: 'Avalanche',
  xrp: 'XRP Ledger',
  doge: 'Dogecoin',
  ltc: 'Litecoin',
  zec: 'Zcash',
  bch: 'Bitcoin Cash',
  dash: 'Dash',
  gnosis: 'Gnosis',
  aptos: 'Aptos',
  cardano: 'Cardano',
  bera: 'Berachain',
  monad: 'Monad',
  scroll: 'Scroll',
  starknet: 'Starknet',
  xlayer: 'X Layer',
  plasma: 'Plasma',
  hypercore: 'Hyperliquid',
  movement: 'Movement',
  aleo: 'Aleo',
  abs: 'Abstract',
};

const POPULAR = ['base', 'eth', 'sol', 'arb', 'tron', 'near', 'bsc', 'pol', 'op', 'btc'];
const STABLES = ['USDC', 'USDT', 'DAI', 'USDC.e'];

export interface ChainOption {
  id: string;
  name: string;
}

export function chainName(id: string): string {
  return CHAIN_NAMES[id] ?? id.toUpperCase();
}

/** Chains that have at least one token, popular ones first. */
export function chainsOf(tokens: OneClickToken[]): ChainOption[] {
  const ids = [...new Set(tokens.map((t) => t.blockchain))];
  const rank = (id: string) => {
    const i = POPULAR.indexOf(id);
    return i === -1 ? POPULAR.length : i;
  };
  return ids
    .sort((a, b) => rank(a) - rank(b) || chainName(a).localeCompare(chainName(b)))
    .map((id) => ({ id, name: chainName(id) }));
}

/** Tokens on a chain, stablecoins first, then by symbol. */
export function tokensOn(tokens: OneClickToken[], chain: string): OneClickToken[] {
  const rank = (s: string) => {
    const i = STABLES.indexOf(s);
    return i === -1 ? STABLES.length : i;
  };
  return tokens
    .filter((t) => t.blockchain === chain)
    .sort((a, b) => rank(a.symbol) - rank(b.symbol) || a.symbol.localeCompare(b.symbol));
}
