import {
  USDC_NEAR_ASSET_ID,
  formatUsdc,
  parseUsdc,
  type OneClickToken,
  type QuoteRequest,
  type QuoteResponse,
} from '@dues/core';

export interface QuoteInput {
  /** Amount the recipient must receive, in USD (= USDC). */
  amountUsd: string | number;
  /** NEAR account that receives USDC. */
  recipient: string;
  /** Token the buyer pays with. */
  origin: Pick<OneClickToken, 'assetId'>;
  /** Buyer's address on the origin chain, for refunds. */
  refundTo: string;
  dry: boolean;
  slippageBps?: number;
  /** Minutes until 1Click refunds an unfinished swap. */
  deadlineMinutes?: number;
  now?: Date;
}

/**
 * EXACT_OUTPUT: the freelancer receives exactly the invoice amount in USDC on
 * NEAR; slippage and fees land on the buyer's side.
 */
export function buildQuoteRequest(input: QuoteInput): QuoteRequest {
  const now = input.now ?? new Date();
  return {
    dry: input.dry,
    swapType: 'EXACT_OUTPUT',
    slippageTolerance: input.slippageBps ?? 100,
    originAsset: input.origin.assetId,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: USDC_NEAR_ASSET_ID,
    amount: parseUsdc(input.amountUsd),
    refundTo: input.refundTo.trim(),
    refundType: 'ORIGIN_CHAIN',
    recipient: input.recipient,
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(now.getTime() + (input.deadlineMinutes ?? 60) * 60_000).toISOString(),
    referral: 'dues',
  };
}

export interface QuoteView {
  dry: boolean;
  /** What the buyer sends, e.g. "25.260566". Send at least `minPay`. */
  pay: string;
  minPay: string;
  paySymbol: string;
  payChain: string;
  payUsd: string;
  /** What the recipient gets, in USDC. */
  receive: string;
  /** Buyer-side cost of the conversion, in USD (pay value minus received value). */
  feeUsd: string;
  etaSeconds: number;
  depositAddress?: string;
  depositMemo?: string;
  /** ISO time after which the deposit address must not be used. */
  deadline?: string;
  /** Raw base units of `pay`, for payment URIs. */
  amountInUnits: string;
}

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export function mapQuote(res: QuoteResponse, token: Pick<OneClickToken, 'symbol' | 'blockchain'>): QuoteView {
  const q = res.quote;
  const fee = Math.max(0, Number(q.amountInUsd) - Number(q.amountOutUsd));
  return {
    dry: res.quoteRequest.dry,
    pay: q.amountInFormatted,
    minPay: q.minAmountIn,
    paySymbol: token.symbol,
    payChain: token.blockchain,
    payUsd: money(Number(q.amountInUsd)),
    receive: formatUsdc(q.amountOut),
    feeUsd: money(fee),
    etaSeconds: q.timeEstimate,
    depositAddress: q.depositAddress,
    depositMemo: q.depositMemo,
    deadline: q.deadline,
    amountInUnits: q.amountIn,
  };
}

/**
 * 1Click only quotes for NEAR recipients that exist on mainnet (or implicit
 * 64-hex accounts). Dry runs on a local sandbox price the same swap for an
 * implicit stand-in derived from the real recipient; the price does not
 * depend on who receives it.
 */
export async function dryRecipient(account: string): Promise<string> {
  if (/^[0-9a-f]{64}$/.test(account) || account.endsWith('.near')) return account;
  const bytes = new TextEncoder().encode(`dues-dry:${account}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const EVM = new Set(['eth', 'base', 'arb', 'op', 'pol', 'bsc', 'avax', 'gnosis', 'scroll', 'bera', 'monad', 'xlayer', 'plasma', 'abs', 'adi']);

export function isEvm(chain: string): boolean {
  return EVM.has(chain);
}

/** Example refund addresses (format-valid) so dry runs work without typing one. */
export const SAMPLE_REFUND: Record<string, string> = {
  evm: '0x2527D02599Ba641c19FEa793cD0F167589a0f10D',
  sol: '13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK',
  btc: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  tron: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  near: 'refund.near',
};

export function sampleRefundFor(chain: string): string | undefined {
  return isEvm(chain) ? SAMPLE_REFUND.evm : SAMPLE_REFUND[chain];
}

export function refundPlaceholder(chain: string): string {
  if (isEvm(chain)) return '0x… your address on this chain';
  switch (chain) {
    case 'sol':
      return 'Your Solana address';
    case 'btc':
      return 'bc1… your Bitcoin address';
    case 'tron':
      return 'T… your Tron address';
    case 'near':
      return 'you.near';
    default:
      return 'Your address on this chain';
  }
}

/**
 * "10:09 (45 min)" today, or "Mon 10 Nov, 10:09 (3 days)" further out. 1Click
 * may keep a deposit address open for days, so a bare time of day misleads.
 */
export function formatDeadline(deadline: Date, now: Date = new Date()): string {
  const left = deadline.getTime() - now.getTime();
  if (left <= 0) return 'expired: get new details';
  const mins = Math.ceil(left / 60_000);
  const rel = mins < 120 ? `${mins} min` : mins < 48 * 60 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`;
  const time = deadline.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = deadline.toDateString() === now.toDateString();
  const when = sameDay ? time : `${deadline.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
  return `${when} (${rel})`;
}
