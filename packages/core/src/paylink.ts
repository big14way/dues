// Payment links (/pay/?to=&amount=&memo=): who can receive and how much. NEAR Intents 1Click runs
// on mainnet only, so a payment link always pays a NEAR mainnet account. Shared by the app and MCP.

const NAMED = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const IMPLICIT = /^[0-9a-f]{64}$/;
export const PAYLINK_MIN_USD = 1;
export const PAYLINK_MAX_USD = 10_000;
export const PAYLINK_MEMO_MAX = 80;

export function isImplicitAccount(id: string): boolean {
  return IMPLICIT.test(id);
}

/** Why `id` cannot receive a payment link, or null when it can. */
export function mainnetAccountProblem(id: string): string | null {
  if (!id) return 'Enter the NEAR mainnet account that receives the USDC.';
  if (id.endsWith('.testnet')) return 'That is a testnet account. Payment links pay out on NEAR mainnet.';
  if (!NAMED.test(id) && !IMPLICIT.test(id)) return 'That is not a valid NEAR account ID.';
  return null;
}

/** Why `raw` is not a payment-link amount in dollars, or null when it is. */
export function usdAmountProblem(raw: string): string | null {
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return 'Enter an amount in dollars, like 25 or 25.50.';
  const n = Number(raw);
  if (n < PAYLINK_MIN_USD) return `The smallest payment link is $${PAYLINK_MIN_USD}.`;
  if (n > PAYLINK_MAX_USD) return `Payment links go up to $${PAYLINK_MAX_USD.toLocaleString('en-US')}.`;
  return null;
}

export function paymentLinkUrl(site: string, link: { to: string; amount: string; memo?: string }): string {
  const q = new URLSearchParams({ to: link.to, amount: link.amount });
  const memo = link.memo?.trim().slice(0, PAYLINK_MEMO_MAX);
  if (memo) q.set('memo', memo);
  return `${site.replace(/\/+$/, '')}/pay/?${q.toString()}`;
}

export const MAINNET_RPC = 'https://free.rpc.fastnear.com';

/** Named accounts must exist on mainnet before they can receive; implicit (64-hex) ones need not. */
export async function mainnetAccountExists(id: string, rpcUrl = MAINNET_RPC): Promise<boolean> {
  if (isImplicitAccount(id)) return true;
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: id },
    }),
  });
  const j = (await res.json()) as { result?: unknown; error?: { cause?: { name?: string } } };
  if (j.result) return true;
  if (j.error?.cause?.name === 'UNKNOWN_ACCOUNT') return false;
  throw new Error('NEAR mainnet RPC did not answer');
}
