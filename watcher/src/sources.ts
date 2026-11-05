import { readFileSync } from 'node:fs';
import {
  OneClick,
  OneClickError,
  formatUsdc,
  type Invoice,
  type OneClickStatus,
  type QuoteResponse,
  type StatusResponse,
} from '@dues/core';

/** Where the watcher reads 1Click statuses from. `null` means 1Click does not know the address yet. */
export interface StatusSource {
  readonly kind: 'live' | 'fixture';
  status(depositAddress: string, invoice: Invoice): Promise<StatusResponse | null>;
}

export class LiveSource implements StatusSource {
  readonly kind = 'live' as const;
  constructor(private readonly api: OneClick = new OneClick()) {}

  async status(depositAddress: string): Promise<StatusResponse | null> {
    try {
      return await this.api.status(depositAddress);
    } catch (e) {
      if (e instanceof OneClickError && e.status === 404) return null;
      throw e;
    }
  }
}

interface FixtureStep {
  status: OneClickStatus;
  originTx?: string;
  nearTx?: string;
  intentHash?: string;
  refundTx?: string;
  refundReason?: string;
  depositedFraction?: number;
}

export interface StatusFixture {
  originAsset: string;
  sequences: Record<string, FixtureStep[]>;
}

/** Simulates 1Click delivering USDC; returns the NEAR tx hash of the delivery. */
export type SettleHook = (invoice: Invoice, depositAddress: string) => Promise<string>;

/** Is this a deposit address the dry-run fixture understands? */
export const isDryAddress = (addr: string) => addr.startsWith('dry-');

export function dryDepositAddress(sequence: 'success' | 'refunded' | 'failed', salt: string | number): string {
  return `dry-${sequence}-${salt}`;
}

/**
 * Replays recorded status sequences, one step per poll, per deposit address.
 * Amounts and recipient are filled from the invoice, using the price ratio of
 * a real dry quote, so fees look like what 1Click actually charges.
 */
export class FixtureSource implements StatusSource {
  readonly kind = 'fixture' as const;
  private steps = new Map<string, number>();
  private settled = new Map<string, string>();

  constructor(
    private readonly fixture: StatusFixture,
    private readonly recordedQuote: QuoteResponse,
    private readonly settle?: SettleHook,
  ) {}

  static fromFiles(sequencesPath: string, quotePath: string, settle?: SettleHook): FixtureSource {
    return new FixtureSource(
      JSON.parse(readFileSync(sequencesPath, 'utf8')) as StatusFixture,
      JSON.parse(readFileSync(quotePath, 'utf8')) as QuoteResponse,
      settle,
    );
  }

  private sequenceFor(addr: string): FixtureStep[] {
    const name = /^dry-([a-z]+)-/.exec(addr)?.[1] ?? 'success';
    return this.fixture.sequences[name] ?? this.fixture.sequences.success ?? [];
  }

  async status(depositAddress: string, invoice: Invoice): Promise<StatusResponse | null> {
    if (!isDryAddress(depositAddress)) return null;
    const seq = this.sequenceFor(depositAddress);
    const i = Math.min(this.steps.get(depositAddress) ?? 0, seq.length - 1);
    this.steps.set(depositAddress, i + 1);
    const step = seq[i];
    if (!step) return null;
    if (step.status === 'SUCCESS' && this.settle && !this.settled.has(depositAddress)) {
      this.settled.set(depositAddress, await this.settle(invoice, depositAddress));
    }
    return this.build(step, depositAddress, invoice);
  }

  private build(step: FixtureStep, depositAddress: string, inv: Invoice): StatusResponse {
    const rq = this.recordedQuote;
    const out = BigInt(inv.amount_usdc);
    const ratio = (n: string) => (BigInt(n) * out) / BigInt(rq.quote.amountOut);
    const usd = (units: bigint, base: string, baseUnits: string) =>
      ((Number(base) * Number(units)) / Number(baseUnits)).toFixed(6);
    const amountIn = ratio(rq.quote.amountIn);
    const quoteResponse: QuoteResponse = {
      ...rq,
      quoteRequest: {
        ...rq.quoteRequest,
        dry: false,
        originAsset: this.fixture.originAsset,
        recipient: inv.freelancer,
        amount: inv.amount_usdc,
      },
      quote: {
        ...rq.quote,
        depositAddress,
        amountIn: amountIn.toString(),
        amountInFormatted: formatUsdc(amountIn),
        amountInUsd: usd(amountIn, rq.quote.amountInUsd, rq.quote.amountIn),
        minAmountIn: ratio(rq.quote.minAmountIn).toString(),
        amountOut: inv.amount_usdc,
        amountOutFormatted: formatUsdc(out),
        amountOutUsd: usd(out, rq.quote.amountOutUsd, rq.quote.amountOut),
        minAmountOut: inv.amount_usdc,
      },
    };
    const deposited = step.depositedFraction
      ? BigInt(Math.floor(Number(amountIn) * step.depositedFraction))
      : step.status === 'PENDING_DEPOSIT'
        ? 0n
        : amountIn;
    const origin = step.originTx ? [{ hash: step.originTx, explorerUrl: `https://basescan.org/tx/${step.originTx}` }] : [];
    if (step.refundTx) origin.push({ hash: step.refundTx, explorerUrl: `https://basescan.org/tx/${step.refundTx}` });
    const nearTx = this.settled.get(depositAddress) ?? step.nearTx;
    const success = step.status === 'SUCCESS';
    return {
      correlationId: `dry-${depositAddress}`,
      quoteResponse,
      status: step.status,
      updatedAt: new Date().toISOString(),
      swapDetails: {
        intentHashes: success && step.intentHash ? [step.intentHash] : [],
        nearTxHashes: success && nearTx ? [nearTx] : [],
        originChainTxHashes: origin,
        destinationChainTxHashes: success && nearTx ? [{ hash: nearTx, explorerUrl: '' }] : [],
        ...(deposited > 0n
          ? {
              depositedAmount: deposited.toString(),
              depositedAmountFormatted: formatUsdc(deposited),
              depositedAmountUsd: usd(deposited, rq.quote.amountInUsd, rq.quote.amountIn),
            }
          : {}),
        ...(success
          ? {
              amountIn: amountIn.toString(),
              amountInFormatted: formatUsdc(amountIn),
              amountInUsd: quoteResponse.quote.amountInUsd,
              amountOut: inv.amount_usdc,
              amountOutFormatted: formatUsdc(out),
              amountOutUsd: quoteResponse.quote.amountOutUsd,
            }
          : {}),
        ...(step.status === 'REFUNDED'
          ? {
              refundedAmount: deposited.toString(),
              refundedAmountFormatted: formatUsdc(deposited),
              refundReason: step.refundReason,
            }
          : {}),
      },
    };
  }
}
