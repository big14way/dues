// Dues as an MCP server: lets an AI agent read invoices, export the books, quote and track
// any-chain payments, make payment links and, with a session key, create and cancel invoices.
//
// Read tools need no keys. Write tools appear only when the server is given an agent session key:
// a NEAR function-call key that can call create_invoice and cancel on the Dues contract and nothing
// else. The Dues relayer pays the gas, so the agent's account never needs NEAR, and the key cannot
// move NEAR or USDC.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  OneClick,
  TX_KIND_LABEL,
  deliveryTxOf,
  formatUsdc,
  invoicesToCsv,
  mainnetAccountExists,
  mainnetAccountProblem,
  mapStatus,
  nearTxUrl,
  originTxUrl,
  parseUsdc,
  paymentLinkUrl,
  usdAmountProblem,
  type Invoice,
  type NetworkId,
  type OneClickToken,
} from '@dues/core';
import { DuesView, accountWith, relay, rpc, signForRelay } from '@dues/core/near';
import { buildQuoteRequest, dryRecipient, mapQuote, sampleRefundFor } from '@dues/widget/quote';
import { chainName, chainsOf, loadTokens, tokensOn } from '@dues/widget/tokens';

export interface DuesMcpOptions {
  network: NetworkId;
  contractId: string;
  rpcUrl: string;
  /** Hosted Dues site, for invoice and payment links. */
  siteUrl: string;
  /** Dues API base (`https://<host>/api`); the write tools relay through `${apiBase}/relayer`. */
  apiBase?: string;
  /** An agent's session key: a function-call key limited to create_invoice and cancel. */
  agent?: { accountId: string; key: string };
  /** Injected in tests. */
  view?: Pick<DuesView, 'invoice' | 'byFreelancer' | 'byClient'>;
  oneClick?: Pick<OneClick, 'quote' | 'status' | 'tokens'>;
  accountExists?: (id: string) => Promise<boolean>;
}

const INSTRUCTIONS = `Dues is a checkout and invoicing service on NEAR. A buyer pays from any chain and token through NEAR Intents 1Click; the recipient receives exactly the asked amount in USDC on NEAR. Invoices live on the Dues contract; their status is pending, paid, refunded or cancelled, and every payment line links its NEAR transaction.
Payments through 1Click are real money on NEAR mainnet. checkout_quote is a dry run unless live is true. Never send funds to a deposit address unless the user asked you to pay.`;

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (data: unknown): Result => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (message: string): Result => ({ content: [{ type: 'text', text: message }], isError: true });
const usd = (units: string | bigint) => Number(formatUsdc(units)).toFixed(2);
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const USD = /^\d+(\.\d{1,2})?$/;

export function createDuesMcp(opts: DuesMcpOptions): McpServer {
  const provider = rpc(opts.rpcUrl);
  const view = opts.view ?? new DuesView(opts.contractId, provider);
  const oneClick = opts.oneClick ?? new OneClick();
  const accountExists = opts.accountExists ?? ((id: string) => mainnetAccountExists(id));
  const site = opts.siteUrl.replace(/\/+$/, '');
  const txLink = (hash: string | null) => (hash ? (nearTxUrl(opts.network, hash) ?? hash) : null);

  const server = new McpServer({ name: 'dues', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  const describe = (inv: Invoice) => ({
    id: inv.id,
    title: inv.title,
    status: inv.status,
    amount_usd: usd(inv.amount_usdc),
    freelancer: inv.freelancer,
    client: inv.client ?? 'anyone with the link',
    due: day(inv.due_ts),
    monthly_retainer: inv.retainer,
    ...(inv.retainer ? { escrow_usd: usd(inv.escrow_usdc), months_paid: inv.periods_paid } : {}),
    items: inv.items.map((i) => ({ description: i.description, amount_usd: usd(i.amount_usdc) })),
    link: `${site}/i/?id=${inv.id}`,
    ledger: inv.txs.map((t) => ({
      what: TX_KIND_LABEL[t.kind],
      date: day(t.ts),
      amount_usd: usd(t.amount_usdc),
      fee_usd: usd(t.fee_usdc),
      near_tx: txLink(t.hash),
      ...(t.origin_chain && t.origin_chain !== 'near' ? { paid_from: t.origin_chain, origin_tx: originTxUrl(t.origin_chain, t.origin_tx) ?? t.origin_tx } : {}),
    })),
  });

  server.registerTool(
    'get_invoice',
    {
      title: 'Get an invoice',
      description: 'One Dues invoice: amount, status, due date, line items, link, and every payment on its ledger with transaction links.',
      inputSchema: { id: z.number().int().positive().describe('Invoice number') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      const inv = await view.invoice(id);
      return inv ? ok(describe(inv)) : fail(`No invoice #${id} on ${opts.contractId}.`);
    },
  );

  server.registerTool(
    'list_invoices',
    {
      title: 'List invoices',
      description: 'Invoices a NEAR account sent (as freelancer) or received (as client), newest first, with totals received and outstanding.',
      inputSchema: {
        account: z.string().min(2).describe('NEAR account ID'),
        as: z.enum(['freelancer', 'client']).default('freelancer'),
        status: z.enum(['pending', 'paid', 'refunded', 'cancelled']).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ account, as, status }) => {
      const all = as === 'client' ? await view.byClient(account) : await view.byFreelancer(account);
      const rows = all.filter((i) => !status || i.status === status).sort((a, b) => b.id - a.id);
      const received = all
        .flatMap((i) => i.txs)
        .filter((t) => t.kind === 'intent' || t.kind === 'direct' || t.kind === 'pull')
        .reduce((s, t) => s + BigInt(t.amount_usdc), 0n);
      const outstanding = all.filter((i) => i.status === 'pending' && !i.retainer).reduce((s, i) => s + BigInt(i.amount_usdc), 0n);
      return ok({
        account,
        as,
        ...(as === 'freelancer' ? { received_usd: usd(received), outstanding_usd: usd(outstanding) } : {}),
        invoices: rows.map((i) => ({
          id: i.id,
          title: i.title,
          status: i.status,
          amount_usd: usd(i.amount_usdc),
          due: day(i.due_ts),
          [as === 'client' ? 'from' : 'to']: as === 'client' ? i.freelancer : (i.client ?? 'anyone with the link'),
          link: `${site}/i/?id=${i.id}`,
        })),
        dashboard: `${site}/dashboard/?account=${encodeURIComponent(account)}`,
      });
    },
  );

  server.registerTool(
    'invoices_csv',
    {
      title: 'Export the books as CSV',
      description: "A freelancer's payments as CSV, one row per payment: date, invoice, client, amount, fee, tx, status. The same file the dashboard exports.",
      inputSchema: { account: z.string().min(2).describe('Freelancer NEAR account ID') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ account }) => {
      const invoices = await view.byFreelancer(account);
      return { content: [{ type: 'text', text: invoicesToCsv(invoices, { txCell: (h) => nearTxUrl(opts.network, h) ?? h }) }] };
    },
  );

  const findToken = async (chain: string, symbol: string): Promise<OneClickToken | string> => {
    const { tokens } = await loadTokens(oneClick as OneClick);
    const on = tokensOn(tokens, chain);
    if (on.length === 0) return `No chain "${chain}". Chains: ${chainsOf(tokens).map((c) => c.id).join(', ')}.`;
    const t = on.find((x) => x.symbol.toLowerCase() === symbol.toLowerCase());
    return t ?? `No ${symbol} on ${chainName(chain)}. Tokens there: ${on.map((x) => x.symbol).join(', ')}.`;
  };

  server.registerTool(
    'checkout_quote',
    {
      title: 'Quote an any-chain payment',
      description:
        'What a buyer must send, from a chosen chain and token, for a NEAR account to receive exactly amount_usd in USDC on NEAR (NEAR Intents 1Click, EXACT_OUTPUT). Dry run by default: live prices, no deposit address. With live=true it issues a real mainnet deposit address; nothing moves until someone sends funds to it.',
      inputSchema: {
        to: z.string().min(2).describe('NEAR account that receives the USDC'),
        amount_usd: z.string().regex(USD).describe('Amount the recipient receives, in dollars, e.g. "25" or "25.50"'),
        pay_chain: z.string().default('base').describe('Chain the buyer pays from: base, eth, arb, sol, tron, btc, near, ...'),
        pay_token: z.string().default('USDC').describe('Token symbol on that chain'),
        refund_to: z.string().optional().describe("Buyer's own address on pay_chain, where a failed payment is refunded. Required when live."),
        live: z.boolean().default(false).describe('true issues a real mainnet deposit address'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ to, amount_usd, pay_chain, pay_token, refund_to, live }) => {
      if (Number(amount_usd) <= 0) return fail('amount_usd must be more than zero.');
      if (live) {
        const problem = mainnetAccountProblem(to);
        if (problem) return fail(`${problem} 1Click pays out on NEAR mainnet only.`);
        if (!(await accountExists(to))) return fail(`${to} does not exist on NEAR mainnet, so it cannot receive USDC.`);
        if (!refund_to) return fail('A live quote needs refund_to: the buyer’s own address on the chain they pay from.');
      }
      const token = await findToken(pay_chain, pay_token);
      if (typeof token === 'string') return fail(token);
      const refundTo = refund_to ?? sampleRefundFor(token.blockchain);
      if (!refundTo) return fail(`Pass refund_to: an address on ${chainName(token.blockchain)}.`);
      const recipient = live ? to : await dryRecipient(to);
      const res = await oneClick.quote(buildQuoteRequest({ amountUsd: amount_usd, recipient, origin: token, refundTo, dry: !live }));
      const q = mapQuote(res, token);
      return ok({
        live,
        buyer_sends: `${q.pay} ${q.paySymbol} on ${chainName(q.payChain)}`,
        minimum_accepted: `${formatUsdc(q.minPay, token.decimals)} ${q.paySymbol}`,
        recipient_gets: `${q.receive} USDC on NEAR, to ${to}`,
        conversion_cost_usd: q.feeUsd,
        usually_arrives_in_seconds: q.etaSeconds,
        ...(live
          ? {
              deposit_address: q.depositAddress,
              ...(q.depositMemo ? { deposit_memo: q.depositMemo } : {}),
              valid_until: q.deadline,
              next: 'Send the amount to deposit_address on that chain, then call payment_status with it.',
            }
          : { next: 'Dry run: no deposit address. Ask again with live=true and refund_to to get one.' }),
      });
    },
  );

  server.registerTool(
    'payment_status',
    {
      title: 'Track a payment',
      description: 'Status of a 1Click deposit address: waiting, processing, paid, refunded or failed, with the deposit and the NEAR delivery transaction once paid.',
      inputSchema: {
        deposit_address: z.string().min(8),
        deposit_memo: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ deposit_address, deposit_memo }) => {
      let s;
      try {
        s = await oneClick.status(deposit_address, deposit_memo);
      } catch (e) {
        return fail(`1Click has no payment for ${deposit_address} (${(e as Error).message}).`);
      }
      const d = s.swapDetails;
      const req = s.quoteResponse?.quoteRequest;
      const { tokens } = await loadTokens(oneClick as OneClick);
      const payChain = tokens.find((t) => t.assetId === req?.originAsset)?.blockchain ?? null;
      const origin = d.originChainTxHashes?.[0];
      const delivery = s.status === 'SUCCESS' ? deliveryTxOf(d) : undefined;
      return ok({
        status: s.status,
        meaning: mapStatus(s.status).label,
        final: mapStatus(s.status).final,
        recipient: req?.recipient,
        ...(d.depositedAmountFormatted ? { deposited: d.depositedAmountFormatted } : {}),
        ...(s.status === 'SUCCESS' ? { delivered_usdc: d.amountOutFormatted ?? s.quoteResponse.quote.amountOutFormatted } : {}),
        ...(d.refundedAmountFormatted && Number(d.refundedAmountFormatted) > 0 ? { returned_to_payer: d.refundedAmountFormatted } : {}),
        ...(origin ? { deposit_tx: origin.explorerUrl || originTxUrl(payChain, origin.hash) || origin.hash } : {}),
        ...(delivery ? { near_delivery_tx: nearTxUrl('mainnet', delivery) } : {}),
      });
    },
  );

  server.registerTool(
    'payment_link',
    {
      title: 'Make a payment link',
      description:
        'A hosted checkout link for any NEAR mainnet account: whoever opens it can pay from any chain, and the account receives exactly amount_usd in USDC on NEAR. Checks the account exists on mainnet.',
      inputSchema: {
        to: z.string().min(2).describe('NEAR mainnet account that receives the USDC'),
        amount_usd: z.string().describe('$1 to $10,000, e.g. "25" or "25.50"'),
        memo: z.string().max(80).optional().describe('Shown to the payer, like an order number'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ to, amount_usd, memo }) => {
      const problem = mainnetAccountProblem(to) ?? usdAmountProblem(amount_usd);
      if (problem) return fail(problem);
      if (!(await accountExists(to))) return fail(`${to} does not exist on NEAR mainnet, so it cannot receive USDC.`);
      const url = paymentLinkUrl(site, { to, amount: amount_usd, memo });
      return ok({ url, embed: `<script src="${site}/widget.js"></script>\n<dues-checkout amount="${amount_usd}" to="${to}"${memo ? ` memo="${memo.replace(/"/g, '&quot;')}"` : ''}></dues-checkout>` });
    },
  );

  if (opts.agent) {
    const agent = accountWith(opts.agent.accountId, provider, [opts.agent.key]);
    const relayerUrl = `${(opts.apiBase ?? `${site}/api`).replace(/\/+$/, '')}/relayer`;

    server.registerTool(
      'create_invoice',
      {
        title: 'Create an invoice',
        description: `Creates an invoice from ${opts.agent.accountId}, gas paid by the Dues relayer. Returns the link to send to the client. Line items, when given, must add up to amount_usd.`,
        inputSchema: {
          title: z.string().min(1).max(120),
          amount_usd: z.string().regex(USD).describe('e.g. "1500" or "250.50"'),
          due_date: z.string().describe('ISO date or time, in the future, e.g. "2026-12-01"'),
          client: z.string().optional().describe('NEAR account allowed to pay; omit for anyone with the link'),
          items: z.array(z.object({ description: z.string().min(1).max(120), amount_usd: z.string().regex(USD) })).max(20).optional(),
          monthly: z.boolean().default(false).describe('true makes it a monthly retainer the client can prepay into escrow'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      async ({ title, amount_usd, due_date, client, items, monthly }) => {
        const due = Date.parse(due_date);
        if (Number.isNaN(due) || due <= Date.now()) return fail('due_date must be a future date, like 2026-12-01.');
        if (client && client === opts.agent!.accountId) return fail('The client cannot be the account sending the invoice.');
        const lines = (items ?? []).map((i) => ({ description: i.description, amount_usdc: parseUsdc(i.amount_usd) }));
        const signed = await signForRelay(agent, opts.contractId, 'create_invoice', {
          title,
          amount_usdc: parseUsdc(amount_usd),
          due_ts: due,
          client: client ?? null,
          items: lines,
          ...(monthly ? { recurrence: 'monthly' } : {}),
        });
        const r = await relay(relayerUrl, signed);
        if (r.status !== 'success') return fail(`The contract refused it: ${r.error ?? 'unknown error'} (${txLink(r.hash)})`);
        const id = Number(r.value);
        return ok({ id, link: `${site}/i/?id=${id}`, tx: txLink(r.hash), gas_paid_by: 'the Dues relayer' });
      },
    );

    server.registerTool(
      'cancel_invoice',
      {
        title: 'Cancel an invoice',
        description: `Cancels an unpaid invoice sent by ${opts.agent.accountId}, gas paid by the Dues relayer. Paid invoices cannot be cancelled.`,
        inputSchema: { id: z.number().int().positive() },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      },
      async ({ id }) => {
        const signed = await signForRelay(agent, opts.contractId, 'cancel', { id });
        const r = await relay(relayerUrl, signed);
        if (r.status !== 'success') return fail(`The contract refused it: ${r.error ?? 'unknown error'} (${txLink(r.hash)})`);
        return ok({ id, status: 'cancelled', tx: txLink(r.hash) });
      },
    );
  }

  return server;
}
