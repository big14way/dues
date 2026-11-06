// React wrapper: <DuesCheckout amount={25} to="ada.near" onPaid={...} />
import { createElement, useEffect, useRef, type CSSProperties } from 'react';
import { defineDuesCheckout, type PaidDetail, type QuoteDetail, type StatusDetail } from './element';

export type { PaidDetail, QuoteDetail, StatusDetail };

export interface DuesCheckoutProps {
  /** Amount the recipient receives, in USD (settled as USDC). */
  amount: string | number;
  /** NEAR account that receives USDC. */
  to: string;
  memo?: string;
  invoice?: string | number;
  /** Live prices, no deposit address, nothing can be paid. */
  dry?: boolean;
  theme?: 'light' | 'dark';
  apiBase?: string;
  statusUrl?: string;
  trackUrl?: string;
  chain?: string;
  token?: string;
  refundTo?: string;
  drySequence?: 'success' | 'refunded' | 'failed';
  /** Hide amount and memo when the page around the widget already shows them. */
  compact?: boolean;
  /** Replaces the dry-run banner text. */
  dryNote?: string;
  className?: string;
  style?: CSSProperties;
  onQuote?: (d: QuoteDetail) => void;
  onStatus?: (d: StatusDetail) => void;
  onPaid?: (d: PaidDetail) => void;
  onError?: (d: { message: string }) => void;
}

export function DuesCheckout(props: DuesCheckoutProps) {
  const ref = useRef<HTMLElement | null>(null);
  const handlers = useRef(props);
  handlers.current = props;

  useEffect(() => {
    defineDuesCheckout();
    const el = ref.current;
    if (!el) return;
    const on = (name: string, pick: (p: DuesCheckoutProps) => ((d: never) => void) | undefined) => {
      const fn = (e: Event) => pick(handlers.current)?.((e as CustomEvent).detail as never);
      el.addEventListener(name, fn);
      return () => el.removeEventListener(name, fn);
    };
    const offs = [
      on('dues:quote', (p) => p.onQuote),
      on('dues:status', (p) => p.onStatus),
      on('dues:paid', (p) => p.onPaid),
      on('dues:error', (p) => p.onError),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const attrs: Record<string, unknown> = {
    ref,
    amount: String(props.amount),
    to: props.to,
    memo: props.memo,
    invoice: props.invoice === undefined ? undefined : String(props.invoice),
    theme: props.theme,
    'api-base': props.apiBase,
    'status-url': props.statusUrl,
    'track-url': props.trackUrl,
    chain: props.chain,
    token: props.token,
    'refund-to': props.refundTo,
    'dry-sequence': props.drySequence,
    'dry-note': props.dryNote,
    className: props.className,
    style: props.style,
  };
  // React 19 sets known custom-element properties directly; `dry` has a boolean setter.
  if (props.dry) attrs.dry = true;
  if (props.compact) attrs.compact = '';
  return createElement('dues-checkout', attrs);
}
