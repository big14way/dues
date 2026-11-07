/**
 * Minimal typed client for the 1Click API (NEAR Intents).
 * Shapes follow https://1click.chaindefuser.com/docs/v0/openapi.yaml.
 */
import { ONECLICK_BASE_URL } from './constants';

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  priceUpdatedAt?: string;
  contractAddress?: string;
}

export type SwapType = 'EXACT_INPUT' | 'EXACT_OUTPUT' | 'FLEX_INPUT' | 'ANY_INPUT';

export interface QuoteRequest {
  dry: boolean;
  swapType: SwapType;
  slippageTolerance: number;
  originAsset: string;
  depositType: 'ORIGIN_CHAIN' | 'INTENTS';
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: 'ORIGIN_CHAIN' | 'INTENTS';
  recipient: string;
  recipientType: 'DESTINATION_CHAIN' | 'INTENTS';
  deadline: string;
  depositMode?: 'SIMPLE' | 'MEMO';
  referral?: string;
  quoteWaitingTimeMs?: number;
}

export interface Quote {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline?: string;
  timeWhenInactive?: string;
  timeEstimate: number;
  refundFee?: string;
  withdrawFee?: string;
}

export interface QuoteResponse {
  correlationId: string;
  timestamp: string;
  signature: string;
  quoteRequest: QuoteRequest;
  quote: Quote;
}

export type OneClickStatus =
  | 'PENDING_DEPOSIT'
  | 'KNOWN_DEPOSIT_TX'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'INCOMPLETE_DEPOSIT'
  | 'REFUNDED'
  | 'FAILED';

export interface TransactionDetails {
  hash: string;
  explorerUrl: string;
}

export interface SwapDetails {
  intentHashes: string[];
  nearTxHashes: string[];
  amountIn?: string;
  amountInFormatted?: string;
  amountInUsd?: string;
  amountOut?: string;
  amountOutFormatted?: string;
  amountOutUsd?: string;
  slippage?: number;
  originChainTxHashes: TransactionDetails[];
  destinationChainTxHashes: TransactionDetails[];
  refundedAmount?: string;
  refundedAmountFormatted?: string;
  refundedAmountUsd?: string;
  /** null when nothing was refunded (seen on a real mainnet payment). */
  refundReason?: string | null;
  depositedAmount?: string;
  depositedAmountFormatted?: string;
  depositedAmountUsd?: string;
  withdrawFee?: string;
}

export interface StatusResponse {
  correlationId: string;
  quoteResponse: QuoteResponse;
  status: OneClickStatus;
  updatedAt: string;
  swapDetails: SwapDetails;
}

export class OneClickError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'OneClickError';
  }
}

export interface OneClickOptions {
  baseUrl?: string;
  /** Optional partner JWT (partners.near-intents.org). Not needed for dry quotes. */
  jwt?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class OneClick {
  private readonly baseUrl: string;
  private readonly jwt?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: OneClickOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? ONECLICK_BASE_URL).replace(/\/$/, '');
    this.jwt = opts.jwt;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body) headers['content-type'] = 'application/json';
    if (this.jwt) headers.authorization = `Bearer ${this.jwt}`;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        /* keep raw text */
      }
      throw new OneClickError(`1Click ${path} -> ${res.status}: ${message}`, res.status);
    }
    return JSON.parse(text) as T;
  }

  tokens(): Promise<OneClickToken[]> {
    return this.request('/v0/tokens');
  }

  quote(req: QuoteRequest): Promise<QuoteResponse> {
    return this.request('/v0/quote', { method: 'POST', body: JSON.stringify(req) });
  }

  status(depositAddress: string, depositMemo?: string): Promise<StatusResponse> {
    const q = new URLSearchParams({ depositAddress });
    if (depositMemo) q.set('depositMemo', depositMemo);
    return this.request(`/v0/status?${q}`);
  }

  submitDeposit(txHash: string, depositAddress: string): Promise<unknown> {
    return this.request('/v0/deposit/submit', {
      method: 'POST',
      body: JSON.stringify({ txHash, depositAddress }),
    });
  }
}
