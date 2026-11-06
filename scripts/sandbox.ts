// pnpm sandbox  -  a local Dues you can click through with no wallet, keys or funds:
// NEAR sandbox + Dues contract + mock USDC, the API on :3031 (relayer, watcher replaying recorded
// 1Click statuses, retainer scheduler), a few seeded invoices, and app/public/dues-config.json so
// `pnpm dev` (the app on :3000) signs in with sandbox-only dev accounts. Ctrl+C stops everything.
import { createServer } from 'node:http';
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createApi } from '@dues/api';
import { parseUsdc } from '@dues/core';
import { DuesView, callWithHash, relay, signForRelay } from '@dues/core/near';
import { FixtureSource, dryDepositAddress } from '@dues/watcher';
import { banner, info, ok, step } from './lib/print';
import { DAY_MS, ROOT, addSessionKey, chainNowMs, fastForward, solverSettle, startWorld } from './lib/world';

const PORT = Number(process.env.API_PORT ?? 3031);
const CONFIG = path.join(ROOT, 'app', 'public', 'dues-config.json');

banner('Dues sandbox');
const w = await startWorld((s) => info(s));
const source = FixtureSource.fromFiles(
  path.join(ROOT, 'fixtures', '1click', 'status-sequences.json'),
  path.join(ROOT, 'fixtures', '1click', 'quote-dry.json'),
  solverSettle(w),
);
const api = await createApi({
  network: 'sandbox',
  rpcUrl: w.rpcUrl,
  contractId: w.dues,
  relayer: { accountId: w.relayer.id, keys: w.relayer.keys },
  watcher: { accountId: w.watcher.id, key: w.watcher.key },
  source,
  dev: { advanceDays: (days) => fastForward(w.rpcUrl, days * DAY_MS + 60_000) },
  onEvent: (e) => info(`${e.type} ${JSON.stringify(e).slice(0, 140)}`),
});
const server = createServer(api.handle).listen(PORT, '127.0.0.1');
const apiBase = `http://127.0.0.1:${PORT}/api`;

let busy = false;
const tick = setInterval(async () => {
  if (busy || !api.loop) return;
  busy = true;
  try {
    await api.loop.tick();
  } catch (e) {
    info(`watcher tick failed: ${(e as Error).message}`);
  } finally {
    busy = false;
  }
}, 1500);

if (process.env.SEED !== '0') {
  step('seeding invoices for ada.sandbox');
  const session = await addSessionKey(w.ada, w.dues, w.provider);
  const now = await chainNowMs(w.rpcUrl);
  const create = async (args: Record<string, unknown>) => {
    const r = await relay(`${apiBase}/relayer`, await signForRelay(session.account, w.dues, 'create_invoice', args));
    return Number(r.value);
  };
  const track = (invoiceId: number, depositAddress: string) =>
    fetch(`${apiBase}/watcher/track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invoiceId, depositAddress }),
    });
  const a = await create({
    title: 'Brand refresh',
    amount_usdc: parseUsdc('25'),
    due_ts: now + 7 * DAY_MS,
    items: [
      { description: 'Logo redraw', amount_usdc: parseUsdc('20') },
      { description: 'Colour palette', amount_usdc: parseUsdc('5') },
    ],
  });
  await track(a, dryDepositAddress('success', a));
  const b = await create({ title: 'Icon set', amount_usdc: parseUsdc('12'), due_ts: now + 3 * DAY_MS });
  await track(b, dryDepositAddress('refunded', b));
  const c = await create({ title: 'Logo usage licence', amount_usdc: parseUsdc('40'), due_ts: now + 14 * DAY_MS, client: w.acme.id });
  const pay = await callWithHash(
    w.acme.account,
    w.usdc,
    'ft_transfer_call',
    { receiver_id: w.dues, amount: parseUsdc('40'), msg: JSON.stringify({ invoice_id: c }) },
    { deposit: 1n, gasTera: 100 },
  );
  await fetch(`${apiBase}/watcher/annotate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ invoiceId: c, hash: pay.hash }),
  });
  const d = await create({
    title: 'Monthly design retainer',
    amount_usdc: parseUsdc('1500'),
    due_ts: now + DAY_MS,
    recurrence: 'monthly',
    client: w.acme.id,
    items: [
      { description: 'Product design, up to 60 hours', amount_usdc: parseUsdc('1200') },
      { description: 'Design system upkeep', amount_usdc: parseUsdc('300') },
    ],
  });
  const e = await create({
    title: 'Landing page copy',
    amount_usdc: parseUsdc('300'),
    due_ts: now + 10 * DAY_MS,
    items: [
      { description: 'Homepage and pricing page copy', amount_usdc: parseUsdc('250') },
      { description: 'Two rounds of edits', amount_usdc: parseUsdc('50') },
    ],
  });
  ok(`invoices #${a} (paying via 1Click replay), #${b} (refund replay), #${c} (paid in USDC on NEAR), #${d} (retainer), #${e} (open)`);
}

const view = new DuesView(w.dues, w.provider);
const { invoice_count } = await view.config();
writeFileSync(
  CONFIG,
  `${JSON.stringify(
    {
      network: 'sandbox',
      rpcUrl: w.rpcUrl,
      contract: w.dues,
      usdc: w.usdc,
      apiBase,
      checkout: { dry: true, track: true },
      devAccounts: [
        { id: w.ada.id, key: w.ada.key, role: 'freelancer' },
        { id: w.acme.id, key: w.acme.key, role: 'client' },
      ],
    },
    null,
    2,
  )}\n`,
);
step('ready');
info(`chain    ${w.rpcUrl}  (Dues ${w.dues}, ${invoice_count} invoices)`);
info(`api      ${apiBase}/health`);
info(`app      run \`pnpm dev\` in another terminal, then open http://localhost:3000`);
info(`config   ${path.relative(ROOT, CONFIG)} (sandbox-only dev keys; deleted on exit)`);

const stop = async () => {
  clearInterval(tick);
  server.close();
  await api.close().catch(() => {});
  await w.stop().catch(() => {});
  rmSync(CONFIG, { force: true });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
