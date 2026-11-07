// Payment links (/pay/): who can receive and how much. NEAR Intents 1Click runs on mainnet only,
// so a payment link always pays a NEAR mainnet account.
const MAINNET_RPC = 'https://free.rpc.fastnear.com';
const NAMED = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const IMPLICIT = /^[0-9a-f]{64}$/;
export const MIN_USD = 1;
export const MAX_USD = 10_000;

export function accountProblem(id: string): string | null {
  if (!id) return 'Enter the NEAR mainnet account that receives the USDC.';
  if (id.endsWith('.testnet')) return 'That is a testnet account. Payment links pay out on NEAR mainnet.';
  if (!NAMED.test(id) && !IMPLICIT.test(id)) return 'That is not a valid NEAR account ID.';
  return null;
}

export function amountProblem(raw: string): string | null {
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return 'Enter an amount in dollars, like 25 or 25.50.';
  const n = Number(raw);
  if (n < MIN_USD) return `The smallest payment link is $${MIN_USD}.`;
  if (n > MAX_USD) return `Payment links go up to $${MAX_USD.toLocaleString('en-US')}.`;
  return null;
}

/** Named accounts must exist on mainnet before they can receive; implicit (64-hex) ones need not. */
export async function accountExists(id: string): Promise<boolean> {
  if (IMPLICIT.test(id)) return true;
  const res = await fetch(MAINNET_RPC, {
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
