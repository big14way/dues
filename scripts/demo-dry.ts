// pnpm demo:dry  -  the whole Dues flow on a local NEAR sandbox. No keys, no accounts, no funds.
//
//   1. freelancer approves one session key, then creates invoices with no gas (relayer pays)
//   2. client pays from Base through NEAR Intents 1Click (live dry quote, recorded status replay)
//   3. a 1Click payment that is refunded
//   4. client pays with USDC on NEAR directly
//   5. the relayer refuses everything outside its policy
//   6. monthly retainer: client funds 3 months, a pull-only key releases month 1, client withdraws the rest
//   7. bookkeeper CSV
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  OneClick,
  USDC_NEAR_ASSET_ID,
  formatUsdc,
  invoicesToCsv,
  nearTxUrl,
  type Invoice,
  type QuoteResponse,
} from '@dues/core';
import { DuesView, callWithHash, relay, signForRelay } from '@dues/core/near';
import { buildServer, defaultPolicy } from '@dues/relayer';
import { FixtureSource, Watcher, buildWatcherServer, dryDepositAddress, pullDueRetainers } from '@dues/watcher';
import { buildQuoteRequest, dryRecipient, mapQuote, sampleRefundFor } from '@dues/widget/quote';
import { FALLBACK_TOKENS } from '@dues/widget/tokens';
import { Account, KeyPair, actions, base64Decode, base64Encode, encodeSignedDelegate, nearToYocto, teraToGas } from 'near-api-js';
import { banner, bold, fail, green, info, ok, red, scene, step, tx } from './lib/print';
import {
  DAY_MS,
  ROOT,
  USDC,
  addSessionKey,
  chainNowMs,
  fastForward,
  nearBalance,
  solverSettle,
  startWorld,
  usdcBalance,
  waitBlocks,
  type World,
} from './lib/world';

const FIXTURES = path.join(ROOT, 'fixtures', '1click');
const t0 = Date.now();
const results: [string, boolean][] = [];
let w: World | undefined;
const closers: (() => Promise<unknown>)[] = [];

function expect(cond: boolean, text: string): boolean {
  (cond ? ok : fail)(text);
  return cond;
}

async function postJson(url: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function listen(app: { listen(o: { port: number; host: string }): Promise<string>; server: { address(): unknown }; close(): Promise<unknown> }) {
  await app.listen({ port: 0, host: '127.0.0.1' });
  closers.push(() => app.close());
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}

try {
  banner('DUES DRY RUN: local NEAR sandbox, mock USDC, recorded 1Click statuses');
  w = await startWorld((s) => info(s));
  const world = w;
  const view = new DuesView(world.dues, world.provider);
  info(`dues ${world.dues}  usdc ${world.usdc}  relayer ${world.relayer.id} (${world.relayer.keys.length} keys)  watcher ${world.watcher.id}`);

  // Services: the same relayer and watcher that `pnpm relayer` and `pnpm watcher` run.
  const relayerApp = await buildServer({
    relayer: world.relayer.account,
    provider: world.provider,
    policy: defaultPolicy(world.dues),
    usdcId: world.usdc,
  });
  const relayerUrl = await listen(relayerApp);
  const source = FixtureSource.fromFiles(
    path.join(FIXTURES, 'status-sequences.json'),
    path.join(FIXTURES, 'quote-dry.json'),
    solverSettle(world),
  );
  const loop = new Watcher({ dues: view, watcher: world.watcher.account, source });
  const watcherUrl = await listen(await buildWatcherServer({ dues: view, watcher: world.watcher.account, loop, source }));
  info(`relayer ${relayerUrl}/relay   watcher ${watcherUrl}`);

  /** Runs the watcher until the invoice leaves `pending`, printing each 1Click status. */
  const settle = async (id: number): Promise<Invoice | null> => {
    for (let i = 0; i < 10; i++) {
      for (const e of await loop.tick()) {
        if (e.invoiceId !== id) continue;
        if (e.type === 'status') info(`1Click ${e.status.padEnd(18)} ${e.label}`);
        if (e.type === 'paid') tx('watcher mark_paid', e.hash);
        if (e.type === 'refunded') tx('watcher mark_refunded', e.hash);
        if (e.type === 'flagged' || e.type === 'error') fail(`${e.type}: ${'reason' in e ? e.reason : e.error}`);
      }
      const inv = await view.invoice(id);
      if (inv && inv.status !== 'pending') return inv;
    }
    return view.invoice(id);
  };

  // ---------------------------------------------------------------- 1
  scene('1. Freelancer onboarding: one approval, then no gas');
  const ada = world.ada;
  const near0 = await nearBalance(world.provider, ada.id);
  const session = await addSessionKey(ada, world.dues, world.provider);
  tx('ada adds a session key (one time)', session.hash);
  info(`key ${session.publicKey} may call only create_invoice and cancel on ${world.dues}, and attach no deposit`);
  await waitBlocks(world.rpcUrl, 3); // let the gas refund of that transaction land before measuring
  const near1 = await nearBalance(world.provider, ada.id);
  info(`that approval cost ada ${formatUsdc((near0 - near1) / 10n ** 12n, 12)} NEAR in gas; nothing after this does`);

  const create = async (args: Record<string, unknown>) => {
    const signed = await signForRelay(session.account, world.dues, 'create_invoice', args);
    const r = await relay(relayerUrl, signed);
    if (r.status !== 'success') throw new Error(`create_invoice failed: ${r.error}`);
    return { id: Number(r.value), hash: r.hash, registeredHash: r.registeredHash };
  };
  const now = await chainNowMs(world.rpcUrl);
  const inv1 = await create({
    title: 'Brand refresh',
    amount_usdc: (25n * USDC).toString(),
    due_ts: now + 7 * DAY_MS,
    items: [
      { description: 'Logo redraw', amount_usdc: (20n * USDC).toString() },
      { description: 'Colour palette', amount_usdc: (5n * USDC).toString() },
    ],
  });
  tx(`relayed create_invoice -> #${inv1.id}`, inv1.hash);
  tx('relayer registers ada with USDC', inv1.registeredHash);
  results.push([
    'gasless onboarding',
    expect(inv1.id === 1, 'invoice #1 created by ada, signed with the session key') &&
      expect(Boolean(inv1.registeredHash), 'relayer paid the USDC storage deposit for ada') &&
      expect((await waitBlocks(world.rpcUrl, 3), await nearBalance(world.provider, ada.id)) === near1, 'ada paid no gas for the relayed call'),
  ]);

  // ---------------------------------------------------------------- 2
  scene('2. Client pays from Base through NEAR Intents 1Click');
  const baseUsdc = FALLBACK_TOKENS.find((t) => t.blockchain === 'base' && t.symbol === 'USDC')!;
  const request = buildQuoteRequest({
    amountUsd: '25',
    recipient: await dryRecipient(ada.id),
    origin: baseUsdc,
    refundTo: sampleRefundFor('base')!,
    dry: true,
  });
  let quote: QuoteResponse;
  let quoteSource = 'live from 1click.chaindefuser.com';
  try {
    quote = await new OneClick({ timeoutMs: 8000 }).quote(request);
  } catch (e) {
    quote = (await import('../fixtures/1click/quote-dry.json', { with: { type: 'json' } })).default as QuoteResponse;
    quoteSource = `recorded (live quote unavailable: ${(e as Error).message.slice(0, 60)})`;
  }
  const qv = mapQuote(quote, baseUsdc);
  step(`EXACT_OUTPUT dry quote, ${quoteSource}`);
  info(`client sends ${qv.pay} USDC on Base (about $${qv.payUsd}); ada receives ${qv.receive} USDC on NEAR`);
  info(`conversion cost $${qv.feeUsd}, paid by the client; destination ${USDC_NEAR_ASSET_ID.slice(0, 20)}...`);
  const addr1 = dryDepositAddress('success', inv1.id);
  const track = await postJson(`${watcherUrl}/track`, { invoiceId: inv1.id, depositAddress: addr1 });
  tx(`watcher attach_deposit ${addr1}`, track.body.hash as string);
  const ada0 = await usdcBalance(world, ada.id);
  const paid1 = await settle(inv1.id);
  const got = (await usdcBalance(world, ada.id)) - ada0;
  const t1 = paid1?.txs[0];
  results.push([
    '1Click payment',
    expect(paid1?.status === 'paid', `invoice #1 is paid`) &&
      expect(got === 25n * USDC, `ada received ${formatUsdc(got)} USDC on NEAR`) &&
      expect(Boolean(t1?.hash && t1?.origin_tx), `ledger links the NEAR tx and the Base tx (${t1?.origin_chain})`),
  ]);
  info(`fee recorded for the bookkeeper: ${formatUsdc(t1?.fee_usdc ?? '0')} USDC`);

  // ---------------------------------------------------------------- 3
  scene('3. A 1Click payment that cannot complete is refunded');
  const inv2 = await create({ title: 'Icon set', amount_usdc: (12n * USDC).toString(), due_ts: now + 3 * DAY_MS });
  tx(`relayed create_invoice -> #${inv2.id}`, inv2.hash);
  const addr2 = dryDepositAddress('refunded', inv2.id);
  const track2 = await postJson(`${watcherUrl}/track`, { invoiceId: inv2.id, depositAddress: addr2 });
  tx(`watcher attach_deposit ${addr2}`, track2.body.hash as string);
  const refunded = await settle(inv2.id);
  results.push(['refund', expect(refunded?.status === 'refunded', 'invoice #2 is refunded; nothing counts as received')]);

  // ---------------------------------------------------------------- 4
  scene('4. Client pays with USDC on NEAR, no bridge');
  const acme = world.acme;
  const inv3 = await create({
    title: 'Logo usage licence',
    amount_usdc: (40n * USDC).toString(),
    due_ts: now + 14 * DAY_MS,
    client: acme.id,
  });
  tx(`relayed create_invoice -> #${inv3.id}`, inv3.hash);
  const before3 = await usdcBalance(world, ada.id);
  const pay3 = await callWithHash(
    acme.account,
    world.usdc,
    'ft_transfer_call',
    { receiver_id: world.dues, amount: (40n * USDC).toString(), msg: JSON.stringify({ invoice_id: inv3.id }) },
    { deposit: 1n, gasTera: 100 },
  );
  tx('acme ft_transfer_call 40 USDC to Dues', pay3.hash);
  const ann3 = await postJson(`${watcherUrl}/annotate`, { invoiceId: inv3.id, hash: pay3.hash });
  tx('watcher annotate_tx (checked on-chain)', ann3.body.hash as string);
  const paid3 = await view.invoice(inv3.id);
  results.push([
    'direct USDC',
    expect(paid3?.status === 'paid' && paid3.txs[0]?.kind === 'direct', 'invoice #3 is paid directly') &&
      expect((await usdcBalance(world, ada.id)) - before3 === 40n * USDC, 'Dues forwarded 40 USDC to ada in the same transaction') &&
      expect(paid3?.txs[0]?.hash === pay3.hash, "the client's tx hash is on the ledger"),
  ]);

  // ---------------------------------------------------------------- 5
  scene('5. The relayer only pays for Dues');
  const relayerNear0 = await nearBalance(world.provider, world.relayer.id);
  const tryRelay = async (label: string, receiverId: string, action: ReturnType<typeof actions.functionCall>, want: string) => {
    const { signedDelegate } = await ada.account.createSignedMetaTransaction({ receiverId, actions: [action], blockHeightTtl: 120 });
    const r = await postJson(`${relayerUrl}/relay`, { signedDelegate: base64Encode(encodeSignedDelegate(signedDelegate)) });
    return expect(r.body.code === want, `${label}: ${r.status} ${r.body.code} (${r.body.error})`);
  };
  const refusals = [
    await tryRelay(
      'ft_transfer on the USDC contract',
      world.usdc,
      actions.functionCall('ft_transfer', { receiver_id: ada.id, amount: '1' }, teraToGas(30), 1n),
      'receiver_not_allowed',
    ),
    await tryRelay(
      'mark_paid on Dues',
      world.dues,
      actions.functionCall('mark_paid', { id: inv2.id, intent_tx: 'x' }, teraToGas(30), 0n),
      'method_not_allowed',
    ),
    await tryRelay(
      'create_invoice with 1 NEAR attached',
      world.dues,
      actions.functionCall('create_invoice', { title: 'x', amount_usdc: '1', due_ts: 0 }, teraToGas(30), nearToYocto('1')),
      'deposit_not_allowed',
    ),
  ];
  const good = await signForRelay(session.account, world.dues, 'cancel', { id: inv2.id });
  const bytes = base64Decode(good);
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
  const forged = await postJson(`${relayerUrl}/relay`, { signedDelegate: base64Encode(bytes) });
  refusals.push(expect(forged.body.code === 'bad_signature', `tampered signature: ${forged.status} ${forged.body.code}`));
  refusals.push(expect((await nearBalance(world.provider, world.relayer.id)) === relayerNear0, 'refused requests cost the relayer nothing'));
  results.push(['relayer policy', refusals.every(Boolean)]);

  // ---------------------------------------------------------------- 6
  scene('6. Monthly retainer: escrow, a pull-only key, cancel any time');
  const monthly = 1_500n * USDC;
  const now6 = await chainNowMs(world.rpcUrl);
  const ret = await create({
    title: 'Monthly design retainer',
    amount_usdc: monthly.toString(),
    due_ts: now6 + DAY_MS,
    recurrence: 'monthly',
    client: acme.id,
  });
  tx(`relayed create_invoice -> #${ret.id} (monthly, due tomorrow)`, ret.hash);
  const fund = await callWithHash(
    acme.account,
    world.usdc,
    'ft_transfer_call',
    { receiver_id: world.dues, amount: (3n * monthly).toString(), msg: JSON.stringify({ invoice_id: ret.id }) },
    { deposit: 1n, gasTera: 100 },
  );
  tx('acme funds 3 months (4,500 USDC)', fund.hash);
  tx('watcher annotate_tx', ((await postJson(`${watcherUrl}/annotate`, { invoiceId: ret.id, hash: fund.hash })).body.hash as string));
  const pullKp = KeyPair.fromRandom('ed25519');
  const grant = await acme.account.addFunctionCallAccessKey({
    publicKey: pullKp.getPublicKey(),
    contractId: world.dues,
    methodNames: ['pull'],
    allowance: nearToYocto('0.25'),
  });
  tx('acme grants a key limited to pull', grant.transaction.hash);
  const pullers = new Map([[acme.id, new Account(acme.id, world.provider, pullKp.toString())]]);
  const early = await pullDueRetainers({ dues: view, watcher: world.watcher.account, pullers });
  const notYet = expect(early.length === 0, 'nothing is due today, so the scheduler pulls nothing');
  step('fast-forwarding the sandbox one day to the due date');
  await fastForward(world.rpcUrl, DAY_MS + 60_000);
  const beforePull = await usdcBalance(world, ada.id);
  const pulled = await pullDueRetainers({ dues: view, watcher: world.watcher.account, pullers });
  for (const e of pulled) {
    if (e.type === 'pulled') tx(`pull month ${e.period} by ${e.by}`, e.hash);
    else fail(e.error);
  }
  const afterPull = await view.invoice(ret.id);
  const pullOk =
    expect((await usdcBalance(world, ada.id)) - beforePull === monthly, 'ada received month 1 (1,500 USDC)') &&
    expect(afterPull?.escrow_usdc === (2n * monthly).toString(), '3,000 USDC stays in escrow for months 2 and 3');
  const misuse = await callWithHash(pullers.get(acme.id)!, world.dues, 'withdraw_remaining', { id: ret.id }).then(
    () => false,
    () => true,
  );
  const keyScoped = expect(misuse, 'the pull-only key cannot call withdraw_remaining');
  const acmeBefore = await usdcBalance(world, acme.id);
  const wd = await callWithHash(acme.account, world.dues, 'withdraw_remaining', { id: ret.id }, { gasTera: 100 });
  tx('acme cancels and withdraws the rest', wd.hash);
  tx('watcher annotate_tx', ((await postJson(`${watcherUrl}/annotate`, { invoiceId: ret.id, hash: wd.hash })).body.hash as string));
  const closed = await view.invoice(ret.id);
  results.push([
    'retainer',
    notYet &&
      pullOk &&
      keyScoped &&
      expect((await usdcBalance(world, acme.id)) - acmeBefore === 2n * monthly, 'acme got 3,000 USDC back') &&
      expect(closed?.status === 'cancelled', 'retainer is cancelled') &&
      expect(Boolean(closed?.txs.every((t) => t.hash)), 'every ledger line on the retainer has a NEAR tx hash'),
  ]);

  // ---------------------------------------------------------------- 7
  scene('7. CSV for the bookkeeper');
  const all = await view.byFreelancer(ada.id);
  const csv = invoicesToCsv(all);
  const out = path.join(ROOT, '.dues', 'dry-run.csv');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, csv);
  console.log(csv.trimEnd().split('\r\n').map((l) => `  ${l}`).join('\n'));
  info(`written to ${path.relative(process.cwd(), out)}; on testnet the tx column links to ${nearTxUrl('testnet', '<hash>')}`);
  const lines = csv.trimEnd().split('\r\n').slice(1);
  results.push([
    'csv',
    expect(lines.length === 4, `${lines.length} rows: two paid invoices, one refund, one retainer month`) &&
      expect(lines.filter((l) => l.endsWith(',paid')).length === 3, '3 paid rows'),
  ]);

  scene('Gas paid by the freelancer');
  await waitBlocks(world.rpcUrl, 3);
  const near2 = await nearBalance(world.provider, ada.id);
  const key = await world.provider.viewAccessKey({ accountId: ada.id, publicKey: session.publicKey });
  const allowance = (key.permission as { FunctionCall?: { allowance?: string | null } }).FunctionCall?.allowance;
  results.push([
    'gasless overall',
    expect(near2 === near1, `ada's NEAR balance did not move across ${all.length} relayed invoices`) &&
      expect(allowance === nearToYocto('0.01').toString(), 'the session key allowance is untouched (0.01 NEAR): the relayer paid every byte of gas'),
  ]);
} catch (e) {
  console.error(e);
  results.push(['run', false]);
} finally {
  for (const close of closers) await close().catch(() => {});
  await w?.stop().catch(() => {});
}

const passed = results.filter(([, r]) => r).length;
console.log(
  `\n${(passed === results.length ? green : red)(bold(`${passed}/${results.length} scenes behaved as expected`))} (${((Date.now() - t0) / 1000).toFixed(0)} s)`,
);
for (const [name, r] of results) console.log(`  ${r ? green('ok  ') : red('FAIL')} ${name}`);
process.exit(passed === results.length ? 0 : 1);
