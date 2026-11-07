import QRCode from 'qrcode';
import {
  OneClick,
  formatUsdc,
  mapStatus,
  parseUsdc,
  type OneClickStatus,
  type OneClickToken,
  type QuoteRequest,
  type QuoteResponse,
  type StatusResponse,
} from '@dues/core';
import { paymentUri, receiptOf, walletLinks } from './links';
import {
  buildQuoteRequest,
  dryRecipient,
  formatDeadline,
  mapQuote,
  refundPlaceholder,
  sampleRefundFor,
  type QuoteView,
} from './quote';
import { chainName, chainsOf, loadTokens, tokensOn } from './tokens';

export interface QuoteDetail {
  request: QuoteRequest;
  response: QuoteResponse;
  view: QuoteView;
  depositAddress: string;
}

export interface StatusDetail {
  status: OneClickStatus | 'NOT_FOUND';
  label: string;
  depositAddress: string;
}

export interface PaidDetail {
  depositAddress: string;
  amountUsdc: string;
  recipient: string;
  memo?: string;
  invoice?: string;
  nearTxHashes: string[];
  originTxHashes: { hash: string; explorerUrl: string }[];
  dry: boolean;
  /** True when the steps were replayed in the page (dry run, no status-url): nothing was paid. */
  simulated: boolean;
  status: StatusResponse | null;
}

const STEPS: { status: OneClickStatus; text: string }[] = [
  { status: 'PENDING_DEPOSIT', text: 'Waiting for payment' },
  { status: 'KNOWN_DEPOSIT_TX', text: 'Payment seen' },
  { status: 'PROCESSING', text: 'Converting to USDC' },
  { status: 'SUCCESS', text: 'Paid' },
];

const STYLE = `
:host { all: initial; display: block; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --dues-bg: #ffffff; --dues-fg: #14161a; --dues-muted: #5d6470; --dues-line: #e3e6eb; --dues-soft: #f4f6f8;
  --dues-accent: #0f7b5f; --dues-accent-fg: #ffffff; --dues-warn: #9a5b00; --dues-bad: #b42318; --dues-radius: 14px;
  color: var(--dues-fg); max-width: 420px; }
@media (prefers-color-scheme: dark) { :host(:not([theme="light"])) {
  --dues-bg: #15181d; --dues-fg: #eef1f5; --dues-muted: #9aa3af; --dues-line: #2a2f37; --dues-soft: #1d2127;
  --dues-accent: #2fbf8f; --dues-accent-fg: #0b1410; } }
:host([theme="dark"]) { --dues-bg: #15181d; --dues-fg: #eef1f5; --dues-muted: #9aa3af; --dues-line: #2a2f37;
  --dues-soft: #1d2127; --dues-accent: #2fbf8f; --dues-accent-fg: #0b1410; }
* { box-sizing: border-box; }
.card { background: var(--dues-bg); border: 1px solid var(--dues-line); border-radius: var(--dues-radius); padding: 18px; }
.top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.amount { font-size: 28px; font-weight: 650; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.to { color: var(--dues-muted); font-size: 13px; text-align: right; word-break: break-all; }
.memo { margin: 4px 0 0; color: var(--dues-muted); }
.dry { margin-top: 12px; padding: 8px 10px; border-radius: 10px; background: var(--dues-soft); color: var(--dues-warn); font-size: 12.5px; }
label { display: block; font-size: 12.5px; color: var(--dues-muted); margin: 14px 0 6px; }
select, input { width: 100%; font: inherit; color: var(--dues-fg); background: var(--dues-bg); border: 1px solid var(--dues-line);
  border-radius: 10px; padding: 10px 12px; min-height: 42px; }
select:focus-visible, input:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--dues-accent); outline-offset: 2px; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
button { font: inherit; cursor: pointer; border: 0; border-radius: 10px; min-height: 44px; padding: 10px 14px; }
.primary { width: 100%; margin-top: 16px; background: var(--dues-accent); color: var(--dues-accent-fg); font-weight: 600; }
.primary[disabled] { opacity: .55; cursor: progress; }
.ghost { background: var(--dues-soft); color: var(--dues-fg); min-height: 34px; padding: 6px 10px; font-size: 12.5px; }
.err { color: var(--dues-bad); margin-top: 10px; font-size: 13px; }
.quote { margin-top: 16px; border-top: 1px solid var(--dues-line); padding-top: 14px; }
.send { font-size: 15px; } .send b { font-variant-numeric: tabular-nums; }
.kv { display: flex; justify-content: space-between; gap: 10px; color: var(--dues-muted); font-size: 12.5px; margin-top: 4px; }
.addr { display: flex; align-items: center; gap: 8px; margin-top: 10px; background: var(--dues-soft); border-radius: 10px; padding: 8px 10px; }
.addr code { flex: 1; font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.qr { display: flex; justify-content: center; margin: 12px 0 4px; }
.qr svg { width: 176px; height: 176px; background: #fff; border-radius: 10px; padding: 6px; }
.links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.links a { color: var(--dues-accent); text-decoration: none; font-size: 13px; border: 1px solid var(--dues-line); border-radius: 999px; padding: 6px 10px; }
ol.steps { list-style: none; padding: 0; margin: 14px 0 0; display: grid; gap: 6px; }
ol.steps li { display: flex; align-items: center; gap: 8px; color: var(--dues-muted); font-size: 13px; }
ol.steps li::before { content: ""; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--dues-line); flex: none; }
ol.steps li.done { color: var(--dues-fg); } ol.steps li.done::before { background: var(--dues-accent); border-color: var(--dues-accent); }
ol.steps li.now { color: var(--dues-fg); font-weight: 600; } ol.steps li.now::before { border-color: var(--dues-accent); }
.paid { margin-top: 14px; padding: 12px; border-radius: 10px; background: var(--dues-soft); }
.paid strong { color: var(--dues-accent); }
.receipt { display: grid; gap: 4px; margin-top: 8px; font-size: 12.5px; }
.receipt a { color: var(--dues-accent); text-decoration: none; }
.receipt a:hover { text-decoration: underline; }
.receipt span { color: var(--dues-muted); }
.foot { margin-top: 14px; color: var(--dues-muted); font-size: 11.5px; text-align: center; }
.hidden { display: none !important; }
`;

const TEMPLATE = `
<div class="card" part="card">
  <div class="top"><div class="amount" data-amount></div><div class="to" data-to></div></div>
  <p class="memo" data-memo></p>
  <div class="dry hidden" data-dry>Dry run: prices are live from NEAR Intents, but no deposit address is issued and nothing can be paid.</div>
  <form data-form novalidate>
    <div class="row">
      <div><label for="chain">Pay from</label><select id="chain" data-chain aria-label="Chain"></select></div>
      <div><label for="token">With</label><select id="token" data-token aria-label="Token"></select></div>
    </div>
    <label for="refund">Refund address, in case the payment cannot complete</label>
    <input id="refund" data-refund autocomplete="off" spellcheck="false" />
    <button class="primary" type="submit" data-go>Get payment details</button>
    <div class="err hidden" role="alert" data-err></div>
  </form>
  <section class="quote hidden" data-quote aria-live="polite">
    <div data-instr>
    <div class="send">Send <b data-pay></b> <span data-paysym></span> on <span data-paychain></span></div>
    <div class="kv"><span>Recipient gets</span><span data-receive></span></div>
    <div class="kv"><span>Conversion cost</span><span data-fee></span></div>
    <div class="kv"><span>Usually arrives in</span><span data-eta></span></div>
    <div class="kv"><span>Address valid until</span><span data-deadline></span></div>
    <div class="qr" data-qr></div>
    <div class="addr"><code data-addr></code><button class="ghost" type="button" data-copy>Copy</button></div>
    <div class="kv hidden" data-memo-row><span>Memo (required)</span><code data-dmemo></code></div>
    <div class="links" data-links></div>
    </div>
    <ol class="steps" data-steps></ol>
    <div class="paid hidden" data-paid></div>
  </section>
  <div class="foot">Settles as USDC on NEAR through NEAR Intents</div>
</div>`;

function q<T extends Element>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
}

/**
 * <dues-checkout amount="25" to="ada.near" memo="Invoice 12"></dues-checkout>
 *
 * Attributes: amount (USD), to (NEAR account), memo, invoice, dry, theme,
 * api-base (1Click base URL), status-url (poll here instead of 1Click),
 * track-url (POST {invoiceId, depositAddress} here before showing the address),
 * chain / token (preselect), refund-to, dry-sequence (success|refunded|failed),
 * compact (hide amount and memo when the host page shows them), dry-note (dry-run banner text).
 * Events (bubbling, composed): dues:quote, dues:status, dues:paid, dues:error.
 * Property: onPaid(detail).
 */
export class DuesCheckout extends HTMLElement {
  static observedAttributes = ['amount', 'to', 'memo', 'dry', 'compact', 'dry-note'];

  onPaid?: (detail: PaidDetail) => void;
  onQuote?: (detail: QuoteDetail) => void;

  private shadow: ShadowRoot;
  private tokens: OneClickToken[] = [];
  private poll?: ReturnType<typeof setInterval>;
  private tick?: ReturnType<typeof setInterval>;
  private done = false;
  private payChain = '';
  private paySymbol = '';

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    const wrap = document.createElement('div');
    wrap.innerHTML = TEMPLATE;
    this.shadow.append(style, ...Array.from(wrap.childNodes));
  }

  get amount(): string {
    return this.getAttribute('amount') ?? '0';
  }
  set amount(v: string) {
    this.setAttribute('amount', String(v));
  }
  get to(): string {
    return this.getAttribute('to') ?? '';
  }
  set to(v: string) {
    this.setAttribute('to', v);
  }
  get dry(): boolean {
    const v = this.getAttribute('dry');
    return v !== null && v !== 'false';
  }
  set dry(v: boolean) {
    this.toggleAttribute('dry', Boolean(v));
  }
  private get api(): OneClick {
    return new OneClick({ baseUrl: this.getAttribute('api-base') ?? undefined });
  }

  connectedCallback() {
    this.renderHeader();
    q<HTMLFormElement>(this.shadow, '[data-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.requestQuote();
    });
    q<HTMLSelectElement>(this.shadow, '[data-chain]').addEventListener('change', () => this.fillTokens());
    q<HTMLButtonElement>(this.shadow, '[data-copy]').addEventListener('click', () => this.copyAddress());
    void this.loadTokenList();
  }

  disconnectedCallback() {
    this.stopTimers();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.renderHeader();
  }

  private stopTimers() {
    if (this.poll) clearInterval(this.poll);
    if (this.tick) clearInterval(this.tick);
    this.poll = undefined;
    this.tick = undefined;
  }

  private renderHeader() {
    let shown = this.amount;
    try {
      shown = formatUsdc(parseUsdc(this.amount));
    } catch {
      /* leave as typed; quote will report it */
    }
    q(this.shadow, '[data-amount]').textContent = `$${shown}`;
    q(this.shadow, '[data-to]').textContent = this.to ? `to ${this.to}` : '';
    const memo = this.getAttribute('memo');
    const memoEl = q(this.shadow, '[data-memo]');
    memoEl.textContent = memo ?? '';
    // compact: the host page already shows amount and memo (an invoice page, for one).
    const compact = this.hasAttribute('compact');
    memoEl.classList.toggle('hidden', !memo || compact);
    q(this.shadow, '.top').classList.toggle('hidden', compact);
    const dryEl = q(this.shadow, '[data-dry]');
    dryEl.classList.toggle('hidden', !this.dry);
    const note = this.getAttribute('dry-note');
    if (note) dryEl.textContent = note;
  }

  private async loadTokenList() {
    const { tokens } = await loadTokens(this.api);
    this.tokens = tokens;
    const chainSel = q<HTMLSelectElement>(this.shadow, '[data-chain]');
    chainSel.replaceChildren(
      ...chainsOf(tokens).map((c) => {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.name;
        return o;
      }),
    );
    chainSel.value = this.getAttribute('chain') ?? 'base';
    if (!chainSel.value) chainSel.selectedIndex = 0;
    this.fillTokens(this.getAttribute('token') ?? undefined);
  }

  private fillTokens(prefer?: string) {
    const chain = q<HTMLSelectElement>(this.shadow, '[data-chain]').value;
    const tokenSel = q<HTMLSelectElement>(this.shadow, '[data-token]');
    tokenSel.replaceChildren(
      ...tokensOn(this.tokens, chain).map((t) => {
        const o = document.createElement('option');
        o.value = t.assetId;
        o.textContent = t.symbol;
        return o;
      }),
    );
    if (prefer) {
      const match = tokensOn(this.tokens, chain).find((t) => t.symbol === prefer || t.assetId === prefer);
      if (match) tokenSel.value = match.assetId;
    }
    const refund = q<HTMLInputElement>(this.shadow, '[data-refund]');
    refund.placeholder = refundPlaceholder(chain);
    const preset = this.getAttribute('refund-to');
    const sample = this.dry ? sampleRefundFor(chain) : undefined;
    if (preset) refund.value = preset;
    else if (sample && (!refund.value || refund.dataset.sample === '1')) {
      refund.value = sample;
      refund.dataset.sample = '1';
    } else if (refund.dataset.sample === '1') {
      refund.value = '';
      delete refund.dataset.sample;
    }
  }

  private showError(message: string) {
    const el = q(this.shadow, '[data-err]');
    el.textContent = message;
    el.classList.toggle('hidden', !message);
    if (message) this.fire('dues:error', { message });
  }

  private fire<T>(name: string, detail: T) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private async requestQuote() {
    const go = q<HTMLButtonElement>(this.shadow, '[data-go]');
    const assetId = q<HTMLSelectElement>(this.shadow, '[data-token]').value;
    const token = this.tokens.find((t) => t.assetId === assetId);
    const refundTo = q<HTMLInputElement>(this.shadow, '[data-refund]').value.trim();
    this.showError('');
    if (!this.to) return this.showError('This checkout has no recipient (the "to" attribute).');
    if (!token) return this.showError('Pick a token to pay with.');
    if (!refundTo) return this.showError('Enter your address on that chain so a failed payment can be refunded.');
    let amountOk = false;
    try {
      amountOk = BigInt(parseUsdc(this.amount)) > 0n;
    } catch {
      amountOk = false;
    }
    if (!amountOk) return this.showError('The amount on this checkout is not valid.');

    go.disabled = true;
    go.textContent = 'Getting a price…';
    this.stopTimers();
    this.done = false;
    try {
      const recipient = this.dry ? await dryRecipient(this.to) : this.to;
      const request = buildQuoteRequest({ amountUsd: this.amount, recipient, origin: token, refundTo, dry: this.dry });
      const response = await this.api.quote(request);
      const view = mapQuote(response, token);
      const depositAddress =
        view.depositAddress ??
        `dry-${this.getAttribute('dry-sequence') ?? 'success'}-${Math.random().toString(36).slice(2, 10)}`;
      await this.track(depositAddress);
      await this.renderQuote(view, token, depositAddress);
      const detail: QuoteDetail = { request, response, view, depositAddress };
      this.onQuote?.(detail);
      this.fire('dues:quote', detail);
      this.startStatus(depositAddress, view.depositMemo);
    } catch (e) {
      this.showError((e as Error).message.replace(/^1Click \/v0\/quote -> \d+: /, ''));
    } finally {
      go.disabled = false;
      go.textContent = 'Get new payment details';
    }
  }

  /**
   * Tells the invoice's watcher which deposit address this payer got, before
   * the address is shown. If that fails the address is never shown, so nobody
   * pays into an address the invoice does not know about.
   */
  private async track(depositAddress: string) {
    const url = this.getAttribute('track-url');
    const invoice = this.getAttribute('invoice');
    if (!url || !invoice) return;
    const res = await fetch(new URL(url, typeof location !== 'undefined' ? location.href : undefined), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invoiceId: Number(invoice), depositAddress }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(`Could not link this payment to the invoice: ${body.error ?? res.status}. Do not pay yet.`);
    }
  }

  private async renderQuote(view: QuoteView, token: OneClickToken, depositAddress: string) {
    const s = this.shadow;
    q(s, '[data-quote]').classList.remove('hidden');
    q(s, '[data-instr]').classList.remove('hidden');
    q(s, '[data-form]').classList.remove('hidden');
    this.payChain = token.blockchain;
    this.paySymbol = token.symbol;
    q(s, '[data-pay]').textContent = view.pay;
    q(s, '[data-paysym]').textContent = token.symbol;
    q(s, '[data-paychain]').textContent = chainName(token.blockchain);
    q(s, '[data-receive]').textContent = `${view.receive} USDC on NEAR`;
    q(s, '[data-fee]').textContent = `$${view.feeUsd}`;
    q(s, '[data-eta]').textContent = view.etaSeconds < 90 ? `${view.etaSeconds} s` : `${Math.round(view.etaSeconds / 60)} min`;
    q(s, '[data-addr]').textContent = depositAddress;
    const memoRow = q(s, '[data-memo-row]');
    memoRow.classList.toggle('hidden', !view.depositMemo);
    q(s, '[data-dmemo]').textContent = view.depositMemo ?? '';
    const deadlineEl = q(s, '[data-deadline]');
    const deadline = view.deadline ? new Date(view.deadline) : undefined;
    const paint = () => {
      if (!deadline) {
        deadlineEl.textContent = view.dry ? 'not issued (dry run)' : '—';
        return;
      }
      deadlineEl.textContent = formatDeadline(deadline);
    };
    paint();
    this.tick = setInterval(paint, 30_000);

    const uri = view.depositAddress ? paymentUri(token, view.depositAddress, view.amountInUnits) : undefined;
    const qr = q(s, '[data-qr]');
    qr.innerHTML = await QRCode.toString(uri ?? depositAddress, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    qr.setAttribute('aria-label', `QR code for ${depositAddress}`);
    const links = q(s, '[data-links]');
    const anchors: HTMLAnchorElement[] = [];
    if (uri) {
      const a = document.createElement('a');
      a.href = uri;
      a.textContent = 'Open in wallet app';
      anchors.push(a);
    }
    if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
      for (const l of walletLinks(location.href, token.blockchain)) {
        const a = document.createElement('a');
        a.href = l.href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = l.name;
        anchors.push(a);
      }
    }
    links.replaceChildren(...anchors);
    q(s, '[data-paid]').classList.add('hidden');
    this.paintSteps('PENDING_DEPOSIT');
  }

  private paintSteps(status: string) {
    const idx = STEPS.findIndex((x) => x.status === status);
    const list = q(this.shadow, '[data-steps]');
    list.replaceChildren(
      ...STEPS.map((step, i) => {
        const li = document.createElement('li');
        li.textContent = step.text;
        if (idx >= 0 && (i < idx || (i === idx && status === 'SUCCESS'))) li.className = 'done';
        else if (i === idx) li.className = 'now';
        return li;
      }),
    );
    if (idx < 0) {
      const li = document.createElement('li');
      li.className = 'now';
      li.textContent = mapStatus(status).label;
      list.append(li);
    }
  }

  private async copyAddress() {
    const text = q(this.shadow, '[data-addr]').textContent ?? '';
    const btn = q<HTMLButtonElement>(this.shadow, '[data-copy]');
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
    } catch {
      btn.textContent = 'Select and copy';
    }
    setTimeout(() => (btn.textContent = 'Copy'), 1500);
  }

  /** Polls status: a custom status-url, 1Click itself, or (dry, no URL) a local replay. */
  private startStatus(depositAddress: string, memo?: string) {
    const statusUrl = this.getAttribute('status-url');
    let last = '';
    let i = 0;
    const handle = (status: OneClickStatus | 'NOT_FOUND', res: StatusResponse | null) => {
      const shown = status === 'NOT_FOUND' ? 'PENDING_DEPOSIT' : status;
      if (shown !== last) {
        last = shown;
        this.paintSteps(shown);
        this.fire<StatusDetail>('dues:status', { status, label: mapStatus(shown).label, depositAddress });
      }
      const m = mapStatus(shown);
      if (m.final) {
        this.stopTimers();
        // The deposit address is spent or dead: stop showing it so nobody pays it again.
        q(this.shadow, '[data-instr]').classList.add('hidden');
        if (shown === 'SUCCESS') this.paid(depositAddress, res);
        else this.showFinal(m.label);
      }
    };
    const pollOnce = async () => {
      if (this.done) return;
      if (this.dry && !statusUrl) {
        const step = STEPS[Math.min(i++, STEPS.length - 1)]!.status;
        handle(step, null);
        return;
      }
      try {
        const res = statusUrl
          ? await fetchStatus(statusUrl, depositAddress, memo)
          : await this.api.status(depositAddress, memo).catch((e: { status?: number }) => {
              if (e.status === 404) return null;
              throw e;
            });
        if (!res) handle('NOT_FOUND', null);
        else handle(res.status, res);
      } catch {
        /* transient; keep polling */
      }
    };
    void pollOnce();
    this.poll = setInterval(pollOnce, this.dry && !statusUrl ? 1500 : 4000);
  }

  private showFinal(text: string) {
    const box = q(this.shadow, '[data-paid]');
    box.textContent = text;
    box.classList.remove('hidden');
  }

  private paid(depositAddress: string, res: StatusResponse | null) {
    this.done = true;
    const amount = (() => {
      try {
        return formatUsdc(parseUsdc(this.amount));
      } catch {
        return this.amount;
      }
    })();
    const box = q(this.shadow, '[data-paid]');
    const strong = document.createElement('strong');
    // A dry run with no status-url replays the steps locally: nothing was paid, so say so.
    const simulated = this.dry && !this.getAttribute('status-url');
    strong.textContent = simulated ? 'Dry run finished. ' : 'Paid. ';
    box.replaceChildren(
      strong,
      document.createTextNode(
        simulated
          ? `In a live checkout, ${amount} USDC would now be with ${this.to} on NEAR. Nothing was paid.`
          : `${amount} USDC delivered to ${this.to} on NEAR.`,
      ),
    );
    if (!this.dry && res) {
      // A real payment: link both sides, and any change sent back to the payer.
      q(this.shadow, '[data-form]').classList.add('hidden');
      const r = receiptOf(res.swapDetails, this.payChain);
      const list = document.createElement('div');
      list.className = 'receipt';
      const line = (label: string, url?: string, note?: string) => {
        const row = document.createElement('div');
        if (url) {
          const a = document.createElement('a');
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = `${label} ↗`;
          row.append(a);
        } else row.append(label);
        if (note) {
          const span = document.createElement('span');
          span.textContent = ` ${note}`;
          row.append(span);
        }
        list.append(row);
      };
      if (r.origin) line(`Payment on ${chainName(this.payChain)}`, r.origin.url);
      if (r.delivery) line('Delivery on NEAR', r.delivery.url);
      if (r.returned) line(`${r.returned.amount} ${this.paySymbol} extra returned`, r.returned.url, 'to your refund address');
      if (list.childElementCount) box.append(list);
    }
    box.classList.remove('hidden');
    const detail: PaidDetail = {
      depositAddress,
      amountUsdc: parseUsdc(this.amount),
      recipient: this.to,
      memo: this.getAttribute('memo') ?? undefined,
      invoice: this.getAttribute('invoice') ?? undefined,
      nearTxHashes: res?.swapDetails.nearTxHashes ?? [],
      originTxHashes: res?.swapDetails.originChainTxHashes ?? [],
      dry: this.dry,
      simulated: this.dry && !this.getAttribute('status-url'),
      status: res,
    };
    this.onPaid?.(detail);
    this.fire('dues:paid', detail);
  }
}

async function fetchStatus(url: string, depositAddress: string, memo?: string): Promise<StatusResponse | null> {
  const u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
  u.searchParams.set('depositAddress', depositAddress);
  if (memo) u.searchParams.set('depositMemo', memo);
  const res = await fetch(u, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`status ${res.status}`);
  return (await res.json()) as StatusResponse;
}

export function defineDuesCheckout(tag = 'dues-checkout') {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    customElements.define(tag, DuesCheckout);
  }
}
