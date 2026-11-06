import { describe, expect, it } from 'vitest';
import { DelegateAction, KeyPair, KeyPairSigner, actions, base64Encode, encodeSignedDelegate } from 'near-api-js';
import { SenderLimiter, checkPolicy, decodeSignedDelegate, defaultPolicy, verifyDelegateSignature, relayedValue } from '../src';

const DUES = 'dues.testnet';
const policy = defaultPolicy(DUES);
const kp = KeyPair.fromRandom('ed25519');
const signer = new KeyPairSigner(kp);

async function signed(receiverId: string, acts: ReturnType<typeof actions.functionCall>[], maxBlockHeight = 1_100n) {
  const da = new DelegateAction({
    senderId: 'ada.testnet',
    receiverId,
    actions: acts,
    nonce: 7n,
    maxBlockHeight,
    publicKey: kp.getPublicKey(),
  });
  const { signedDelegate } = await signer.signDelegateAction(da);
  return base64Encode(encodeSignedDelegate(signedDelegate));
}

const call = (method: string, args: object = {}, deposit = 0n, gas = 30_000_000_000_000n) =>
  actions.functionCall(method, args, gas, deposit);

async function check(b64: string, height = 1_000n) {
  return checkPolicy(decodeSignedDelegate(b64), policy, { currentHeight: height, relayerId: 'relayer.testnet' });
}

describe('relayer policy', () => {
  it('sponsors create_invoice and cancel on the Dues contract', async () => {
    const b64 = await signed(DUES, [call('create_invoice', { title: 'x', amount_usdc: '1', due_ts: 0 })]);
    const d = decodeSignedDelegate(b64);
    expect(verifyDelegateSignature(d)).toBe(true);
    expect(await check(b64)).toMatchObject({ ok: true, senderId: 'ada.testnet', methods: ['create_invoice'] });
    expect(await check(await signed(DUES, [call('cancel', { id: 1 })]))).toMatchObject({ ok: true });
  });

  it('refuses any other receiver', async () => {
    const r = await check(await signed('usdc.testnet', [call('ft_transfer', { receiver_id: 'eve', amount: '1' }, 1n)]));
    expect(r).toMatchObject({ ok: false, code: 'receiver_not_allowed' });
  });

  it('refuses methods outside the allowlist', async () => {
    for (const m of ['mark_paid', 'set_watcher', 'update_contract', 'withdraw_remaining', 'pull']) {
      expect(await check(await signed(DUES, [call(m)]))).toMatchObject({ ok: false, code: 'method_not_allowed' });
    }
  });

  it('refuses deposits, except the exact USDC storage deposit', async () => {
    expect(await check(await signed(DUES, [call('create_invoice', {}, 1n)]))).toMatchObject({ code: 'deposit_not_allowed' });
    expect(await check(await signed(DUES, [call('storage_deposit', {}, 10n ** 24n)]))).toMatchObject({ code: 'deposit_not_allowed' });
    expect(await check(await signed(DUES, [call('storage_deposit', {}, policy.storageDepositYocto)]))).toMatchObject({ ok: true });
  });

  it('refuses non-function-call actions, too much gas, too many actions, long or expired lifetimes', async () => {
    expect(await check(await signed(DUES, [actions.transfer(1n) as never]))).toMatchObject({ code: 'action_not_allowed' });
    expect(await check(await signed(DUES, [call('cancel', {}, 0n, 300_000_000_000_000n)]))).toMatchObject({ code: 'gas_too_high' });
    expect(await check(await signed(DUES, [call('cancel'), call('cancel'), call('cancel')]))).toMatchObject({ code: 'action_count' });
    expect(await check(await signed(DUES, [call('cancel')], 900n))).toMatchObject({ code: 'expired' });
    expect(await check(await signed(DUES, [call('cancel')], 100_000n))).toMatchObject({ code: 'ttl_too_long' });
  });

  it('detects a tampered signature', async () => {
    const b64 = await signed(DUES, [call('cancel', { id: 1 })]);
    const d = decodeSignedDelegate(b64);
    d.delegateAction.receiverId = 'other.testnet';
    expect(verifyDelegateSignature(d)).toBe(false);
  });

  it('rejects junk input', () => {
    expect(() => decodeSignedDelegate('')).toThrow();
    expect(() => decodeSignedDelegate('not base64 at all!')).toThrow();
    expect(() => decodeSignedDelegate(Buffer.from('hello').toString('base64'))).toThrow();
  });
});

describe('sender limiter', () => {
  it('limits requests per window and storage_deposit to once per account', () => {
    const l = new SenderLimiter(2, 1000);
    expect(l.allow('a', ['cancel'], 0).ok).toBe(true);
    expect(l.allow('a', ['cancel'], 1).ok).toBe(true);
    expect(l.allow('a', ['cancel'], 2).ok).toBe(false);
    expect(l.allow('a', ['cancel'], 2000).ok).toBe(true);
    expect(l.allow('b', ['storage_deposit'], 0).ok).toBe(true);
    expect(l.allow('b', ['storage_deposit'], 5000).ok).toBe(false);
  });
});

describe('relayed return value', () => {
  it('reads the value from the receipt the contract executed', () => {
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
    const res = {
      receipts_outcome: [
        { outcome: { executor_id: 'ada.testnet', status: { SuccessValue: '' } } },
        { outcome: { executor_id: DUES, status: { SuccessValue: enc(42) } } },
      ],
    };
    expect(relayedValue(res, DUES)).toBe(42);
    expect(relayedValue({ receipts_outcome: [] }, DUES)).toBeNull();
  });
});
