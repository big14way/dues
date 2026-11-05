import { isEvm } from './quote';

const EVM_CHAIN_IDS: Record<string, number> = {
  eth: 1,
  base: 8453,
  arb: 42161,
  op: 10,
  pol: 137,
  bsc: 56,
  avax: 43114,
  gnosis: 100,
  scroll: 534352,
};

export interface PayToken {
  blockchain: string;
  decimals: number;
  contractAddress?: string;
  symbol: string;
}

function decimal(units: string, decimals: number): string {
  const v = BigInt(units);
  const base = 10n ** BigInt(decimals);
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${v / base}.${frac}` : `${v / base}`;
}

/**
 * Payment URI a wallet can open or scan: EIP-681 on EVM chains, Solana Pay on
 * Solana, BIP-21 on Bitcoin. Returns undefined where no common standard exists
 * (the buyer copies the address instead).
 */
export function paymentUri(token: PayToken, depositAddress: string, amountInUnits: string): string | undefined {
  const chain = token.blockchain;
  if (isEvm(chain)) {
    const id = EVM_CHAIN_IDS[chain];
    if (!id) return undefined;
    const native = !token.contractAddress || !token.contractAddress.startsWith('0x');
    return native
      ? `ethereum:${depositAddress}@${id}?value=${BigInt(amountInUnits).toString()}`
      : `ethereum:${token.contractAddress}@${id}/transfer?address=${depositAddress}&uint256=${BigInt(amountInUnits).toString()}`;
  }
  if (chain === 'sol') {
    const amount = decimal(amountInUnits, token.decimals);
    const spl = token.contractAddress ? `&spl-token=${token.contractAddress}` : '';
    return `solana:${depositAddress}?amount=${amount}${spl}`;
  }
  if (chain === 'btc') return `bitcoin:${depositAddress}?amount=${decimal(amountInUnits, token.decimals)}`;
  return undefined;
}

export interface WalletLink {
  name: string;
  href: string;
}

/** Opens this checkout inside a mobile wallet's browser. */
export function walletLinks(pageUrl: string, chain: string): WalletLink[] {
  const u = new URL(pageUrl);
  const links: WalletLink[] = [];
  if (isEvm(chain)) {
    links.push({ name: 'MetaMask', href: `https://metamask.app.link/dapp/${u.host}${u.pathname}${u.search}` });
    links.push({ name: 'Coinbase Wallet', href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(pageUrl)}` });
  }
  if (chain === 'sol' || isEvm(chain)) {
    links.push({
      name: 'Phantom',
      href: `https://phantom.app/ul/browse/${encodeURIComponent(pageUrl)}?ref=${encodeURIComponent(u.origin)}`,
    });
  }
  return links;
}
