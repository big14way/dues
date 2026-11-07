// pnpm testnet:flow  -  one complete paid invoice on NEAR testnet, every step a real transaction:
//   1. the freelancer's session key (function-call key limited to create_invoice and cancel)
//   2. create_invoice as a meta-transaction through the relayer (the freelancer pays no gas)
//   3. the relayer registers the freelancer with testnet USDC
//   4. the client pays with testnet USDC on NEAR (ft_transfer_call), forwarded to the freelancer
//   5. the watcher verifies the client's transaction and records its hash on the invoice
// Results are appended to deployments/testnet.json. INVOICE_ID=N pays an existing invoice instead.
// API_BASE=https://<host>/api uses a deployed relayer and watcher instead of local ones, so the
// hosted deployment is what pays the gas and records the payment.
// The client needs testnet USDC: https://faucet.circle.com (NEAR testnet) to dues-client.testnet.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Account, KeyPair, nearToYocto, type KeyPairString } from 'near-api-js';
import { formatUsdc, nearTxUrl, parseUsdc, type Invoice } from '@dues/core';
import { DuesView, callWithHash, relay, signForRelay } from '@dues/core/near';
import { buildServer, defaultPolicy } from '@dues/relayer';
import { LiveSource, Watcher, buildWatcherServer } from '@dues/watcher';
import { banner, fail, info, ok, step, tx } from './lib/print';
import { account, defaults, provider, readDeployment, relayerAccount, writeDeployment } from './lib/testnet';

const p = provider();
const cfg = defaults;
const AMOUNT = process.env.AMOUNT_USDC || '1';
const view = new DuesView(cfg.contract, p);
const link = (h?: string) => (h ? nearTxUrl('testnet', h)! : '(none)');
const record: Record<string, string> = {};

banner(`Dues on NEAR testnet: ${cfg.contract}`);
const deployment = readDeployment();
if (!deployment) throw new Error('no deployments/testnet.json: run pnpm deploy:testnet');

const apiBase = process.env.API_BASE?.replace(/\/$/, '');
let relayerUrl: string;
let watcherUrl: string;
let close = async () => {};
if (apiBase) {
  relayerUrl = `${apiBase}/relayer`;
  watcherUrl = `${apiBase}/watcher`;
  info(`using the deployed relayer and watcher at ${apiBase}`);
} else {
  const relayerApp = await buildServer({
    relayer: relayerAccount(cfg.relayer, p),
    provider: p,
    policy: defaultPolicy(cfg.contract),
    usdcId: cfg.usdc,
  });
  await relayerApp.listen({ port: 0, host: '127.0.0.1' });
  relayerUrl = `http://127.0.0.1:${(relayerApp.server.address() as AddressInfo).port}`;
  const watcherAcc = account(cfg.watcher, p);
  const source = new LiveSource();
  const watcherApp = await buildWatcherServer({ dues: view, watcher: watcherAcc, loop: new Watcher({ dues: view, watcher: watcherAcc, source }), source });
  await watcherApp.listen({ port: 0, host: '127.0.0.1' });
  watcherUrl = `http://127.0.0.1:${(watcherApp.server.address() as AddressInfo).port}`;
  close = async () => {
    await relayerApp.close();
    await watcherApp.close();
  };
}

try {
  let id = process.env.INVOICE_ID ? Number(process.env.INVOICE_ID) : undefined;
  if (id === undefined) {
    step(`1. session key for ${cfg.freelancer}`);
    const sessionFile = path.join(homedir(), '.near-credentials', 'testnet', `${cfg.freelancer}.dues-session.json`);
    let sessionKey: KeyPairString;
    if (existsSync(sessionFile)) {
      sessionKey = (JSON.parse(readFileSync(sessionFile, 'utf8')) as { private_key: KeyPairString }).private_key;
      ok(`reusing ${KeyPair.fromString(sessionKey).getPublicKey().toString()}`);
    } else {
      const kp = KeyPair.fromRandom('ed25519');
      const res = await account(cfg.freelancer, p).addFunctionCallAccessKey({
        publicKey: kp.getPublicKey(),
        contractId: cfg.contract,
        methodNames: ['create_invoice', 'cancel'],
        allowance: nearToYocto('0.01'),
      });
      sessionKey = kp.toString() as KeyPairString;
      writeFileSync(sessionFile, JSON.stringify({ account_id: cfg.freelancer, public_key: kp.getPublicKey().toString(), private_key: sessionKey }), {
        mode: 0o600,
      });
      record.session_key = res.transaction.hash;
      tx('add session key (the one wallet approval)', res.transaction.hash);
    }
    const session = new Account(cfg.freelancer, p, sessionKey);

    step(`2. create_invoice through the relayer (${AMOUNT} USDC)`);
    const near0 = BigInt((await p.viewAccount({ accountId: cfg.freelancer })).amount);
    const signed = await signForRelay(session, cfg.contract, 'create_invoice', {
      title: process.env.INVOICE_TITLE || 'Logo refresh (testnet)',
      amount_usdc: parseUsdc(AMOUNT),
      due_ts: Date.now() + 7 * 86_400_000,
      client: cfg.client,
      items: [{ description: 'Logo redraw, two rounds', amount_usdc: parseUsdc(AMOUNT) }],
    });
    const r = await relay(relayerUrl, signed);
    if (r.status !== 'success') throw new Error(`create_invoice failed: ${r.error}`);
    id = Number(r.value);
    record.create_invoice = r.hash;
    tx(`relayed create_invoice -> #${id}`, r.hash);
    if (r.registeredHash) {
      record.usdc_register = r.registeredHash;
      tx('3. relayer registers freelancer with USDC', r.registeredHash);
    } else ok('3. freelancer already registered with USDC');
    await new Promise((res) => setTimeout(res, 3000));
    const near1 = BigInt((await p.viewAccount({ accountId: cfg.freelancer })).amount);
    (near1 >= near0 ? ok : fail)(`freelancer NEAR balance ${near1 >= near0 ? 'unchanged' : 'dropped'} by the relayed call`);
  }

  const inv = (await view.invoice(id)) as Invoice;
  info(`invoice #${id}: ${inv.title}, ${formatUsdc(inv.amount_usdc)} USDC, status ${inv.status}`);
  if (inv.status === 'pending') {
    step(`4. ${cfg.client} pays with testnet USDC on NEAR`);
    const bal = BigInt(String(await p.callFunction({ contractId: cfg.usdc, method: 'ft_balance_of', args: { account_id: cfg.client } })));
    if (bal < BigInt(inv.amount_usdc)) {
      fail(`${cfg.client} holds ${formatUsdc(bal)} testnet USDC, needs ${formatUsdc(inv.amount_usdc)}`);
      info(`get testnet USDC at https://faucet.circle.com (network: NEAR testnet, address: ${cfg.client}),`);
      info(`then run: INVOICE_ID=${id} pnpm testnet:flow`);
      process.exitCode = 2;
    } else {
      const before = BigInt(String(await p.callFunction({ contractId: cfg.usdc, method: 'ft_balance_of', args: { account_id: inv.freelancer } })));
      const pay = await callWithHash(
        account(cfg.client, p),
        cfg.usdc,
        'ft_transfer_call',
        { receiver_id: cfg.contract, amount: inv.amount_usdc, msg: JSON.stringify({ invoice_id: id }) },
        { deposit: 1n, gasTera: 100 },
      );
      record.pay = pay.hash;
      tx('client ft_transfer_call', pay.hash);
      const after = BigInt(String(await p.callFunction({ contractId: cfg.usdc, method: 'ft_balance_of', args: { account_id: inv.freelancer } })));
      ok(`freelancer received ${formatUsdc(after - before)} USDC`);
      step('5. watcher checks the transaction and records it');
      const res = await fetch(`${watcherUrl}/annotate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invoiceId: id, hash: pay.hash }),
      });
      const body = (await res.json()) as { hash?: string; error?: string };
      if (!res.ok) throw new Error(`annotate: ${body.error}`);
      record.annotate = body.hash!;
      tx('watcher annotate_tx', body.hash);
    }
  }

  const final = (await view.invoice(id)) as Invoice;
  info(`invoice #${id} is ${final.status}`);
  for (const t of final.txs) info(`ledger ${t.kind} ${formatUsdc(t.amount_usdc)} USDC ${link(t.hash ?? undefined)}`);
  if (Object.keys(record).length > 0) {
    const d = readDeployment()!;
    d.flows = [...(d.flows ?? []), { invoice: id, title: final.title, txs: record, recorded_at: new Date().toISOString() }];
    writeDeployment(d);
    ok('recorded in deployments/testnet.json');
  }
  for (const [k, h] of Object.entries(record)) info(`${k.padEnd(16)} ${link(h)}`);
} finally {
  await close();
}
