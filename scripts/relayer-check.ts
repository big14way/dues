// Asks the deployed relayer to pay for calls its policy forbids, and checks it refuses each one
// without spending anything. Signs with the freelancer's full-access key from ~/.near-credentials,
// so the refusals come from the relayer's policy, not from a key that could not make the call.
//
//   pnpm relayer:check                       # https://sendues.vercel.app/api, dues-freelancer.testnet
//   API_BASE=http://127.0.0.1:3031/api pnpm relayer:check
import { actions, base64Decode, base64Encode, encodeSignedDelegate, nearToYocto, teraToGas } from 'near-api-js';
import { signForRelay } from '@dues/core/near';
import { banner, bold, fail, info, ok, scene } from './lib/print';
import { account, defaults, provider } from './lib/testnet';
import { nearBalance } from './lib/world';

const API_BASE = (process.env.API_BASE || 'https://sendues.vercel.app/api').replace(/\/$/, '');
const RELAY = `${API_BASE}/relayer/relay`;

async function post(body: unknown): Promise<{ status: number; code: string; error: string }> {
  const res = await fetch(RELAY, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
  return { status: res.status, code: json.code ?? '', error: json.error ?? '' };
}

async function main() {
  const p = provider();
  const me = account(defaults.freelancer, p);
  banner(`Relayer policy, live: ${RELAY}`);
  info(`signer ${me.accountId} with a full-access key: only the relayer's policy stands in the way`);
  const before = await nearBalance(p, defaults.relayer);
  info(`${defaults.relayer} holds ${(Number(before / 10n ** 20n) / 1e4).toFixed(4)} NEAR`);

  const results: boolean[] = [];
  const expect = (cond: boolean, text: string) => {
    (cond ? ok : fail)(text);
    results.push(cond);
  };
  const tryRelay = async (label: string, receiverId: string, action: ReturnType<typeof actions.functionCall>, want: string) => {
    scene(label);
    const { signedDelegate } = await me.createSignedMetaTransaction({ receiverId, actions: [action], blockHeightTtl: 120 });
    const r = await post({ signedDelegate: base64Encode(encodeSignedDelegate(signedDelegate)) });
    expect(r.code === want, `${r.status} ${r.code}: ${r.error}`);
  };

  await tryRelay(
    'Move 1 USDC out of the freelancer account',
    defaults.usdc,
    actions.functionCall('ft_transfer', { receiver_id: defaults.relayer, amount: '1000000' }, teraToGas(30), 1n),
    'receiver_not_allowed',
  );
  await tryRelay(
    'Mark an invoice paid without a payment',
    defaults.contract,
    actions.functionCall('mark_paid', { id: 1, intent_tx: 'forged' }, teraToGas(30), 0n),
    'method_not_allowed',
  );
  await tryRelay(
    'Create an invoice with 1 NEAR attached',
    defaults.contract,
    actions.functionCall('create_invoice', { title: 'x', amount_usdc: '1000000', due_ts: 0 }, teraToGas(30), nearToYocto('1')),
    'deposit_not_allowed',
  );

  scene('Tamper with a valid request');
  const good = await signForRelay(me, defaults.contract, 'cancel', { id: 1 });
  const bytes = base64Decode(good);
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
  const forged = await post({ signedDelegate: base64Encode(bytes) });
  expect(forged.code === 'bad_signature', `${forged.status} ${forged.code}: ${forged.error}`);

  scene('What the refusals cost');
  const after = await nearBalance(p, defaults.relayer);
  expect(after === before, `${defaults.relayer} balance unchanged: refused requests are never sent on-chain`);

  const passed = results.filter(Boolean).length;
  console.log(`\n${bold(`${passed}/${results.length} refusals as expected`)}`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
