/** 1Click (NEAR Intents) public API. Quotes with `dry: true` need no key. */
export const ONECLICK_BASE_URL = 'https://1click.chaindefuser.com';

export const USDC_DECIMALS = 6;

/** USDC on NEAR (native, issued by Circle). */
export const USDC_NEAR_MAINNET = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const USDC_NEAR_TESTNET = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af';

/** 1Click asset id of USDC on NEAR: the only asset Dues settles in. */
export const USDC_NEAR_ASSET_ID = `nep141:${USDC_NEAR_MAINNET}`;

/** USDC on NEAR asks 0.00125 NEAR to register an account (NEP-145). */
export const USDC_STORAGE_DEPOSIT_YOCTO = 1_250_000_000_000_000_000_000n;

export type NetworkId = 'mainnet' | 'testnet' | 'sandbox';

export const DEFAULT_RPC: Record<Exclude<NetworkId, 'sandbox'>, string> = {
  mainnet: 'https://rpc.mainnet.near.org',
  testnet: 'https://rpc.testnet.near.org',
};

export function usdcContractFor(network: NetworkId): string | undefined {
  if (network === 'mainnet') return USDC_NEAR_MAINNET;
  if (network === 'testnet') return USDC_NEAR_TESTNET;
  return undefined;
}
