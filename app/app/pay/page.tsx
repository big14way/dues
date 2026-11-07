'use client';
// Payment link: /pay/?to=<NEAR mainnet account>&amount=<USD>&memo=<text>.
// A real checkout with no invoice and no contract: the buyer pays from any chain through NEAR Intents
// 1Click, and the recipient gets exactly `amount` USDC on NEAR mainnet. 1Click runs on mainnet only,
// so this page is real money even while the rest of the site points at testnet.
// Without parameters it is a form that builds such a link.
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { DuesCheckout } from '@dues/widget/react';
import { Avatar } from '@/components/avatar';
import { Header } from '@/components/header';
import { Mark } from '@/components/logo';
import { Button, Card, CopyButton, Field, Notice, Skeleton, inputClass } from '@/components/ui';
import { MAX_USD, MIN_USD, accountExists, accountProblem, amountProblem } from '@/lib/paylink';
import { usePageTheme } from '@/lib/theme';

function useAccountCheck(id: string) {
  const [state, setState] = useState<'idle' | 'checking' | 'ok' | 'missing' | 'error'>('idle');
  useEffect(() => {
    if (accountProblem(id)) return setState('idle');
    let live = true;
    setState('checking');
    const t = setTimeout(() => {
      accountExists(id).then(
        (ok) => live && setState(ok ? 'ok' : 'missing'),
        () => live && setState('error'),
      );
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [id]);
  return state;
}

export default function PayPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto mt-16 h-64 max-w-[480px]" />}>
      <PayRoute />
    </Suspense>
  );
}

function PayRoute() {
  const p = useSearchParams();
  const to = (p.get('to') ?? '').trim().toLowerCase();
  const amount = (p.get('amount') ?? '').trim();
  const memo = (p.get('memo') ?? '').trim().slice(0, 80);
  if (p.has('to') && p.has('amount') && !accountProblem(to) && !amountProblem(amount)) {
    return <LinkCheckout to={to} amount={amount} memo={memo} />;
  }
  return <LinkBuilder initial={{ to, amount, memo }} />;
}

function usdLabel(amount: string) {
  return `$${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function LinkCheckout({ to, amount, memo }: { to: string; amount: string; memo: string }) {
  const theme = usePageTheme();
  const check = useAccountCheck(to);
  return (
    <div className="min-h-screen bg-canvas">
      <main className="mx-auto w-full max-w-[480px] px-4 pt-10 pb-16 sm:pt-14">
        <div className="mb-5 flex items-center gap-2.5">
          <Avatar account={to} size={30} />
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{to}</span>
        </div>
        <div className="space-y-4">
          <Card className="p-7">
            <span className="inline-flex h-[22px] items-center gap-1.5 rounded-md bg-warn-bg px-2 text-[12px] font-medium text-warn">
              <span className="size-1.5 rounded-full bg-current" aria-hidden />
              NEAR mainnet · real payment
            </span>
            <div className="mt-3 text-[36px] leading-[44px] font-semibold tracking-[-0.02em] tabular-nums">{usdLabel(amount)}</div>
            {memo ? <p className="mt-1 text-[14px] text-ink-2">{memo}</p> : null}
            <dl className="mt-5 space-y-1 border-t border-line pt-4 text-[13px]">
              <div className="grid grid-cols-[72px_1fr] gap-3">
                <dt className="text-muted">To</dt>
                <dd className="min-w-0 break-words">{to}</dd>
              </div>
              <div className="grid grid-cols-[72px_1fr] gap-3">
                <dt className="text-muted">Settles</dt>
                <dd>exactly {usdLabel(amount)} in USDC on NEAR</dd>
              </div>
            </dl>
          </Card>
          <Card className="p-7">
            <h2 className="text-[15px] font-semibold">Pay from any wallet</h2>
            <p className="mt-1 mb-4 text-[13px] text-muted">USDC on Base, SOL, ETH, USDT on Tron and more. Conversion costs are shown before you pay.</p>
            {check === 'missing' ? (
              <Notice tone="bad">
                <b>{to}</b> does not exist on NEAR mainnet, so it cannot receive USDC. Ask the sender for a working link.
              </Notice>
            ) : check === 'ok' || check === 'error' ? (
              <DuesCheckout amount={amount} to={to} memo={memo || undefined} compact theme={theme} />
            ) : (
              <Skeleton className="h-48 w-full" />
            )}
          </Card>
        </div>
        <footer className="mt-8 flex items-center justify-center gap-3 text-[12px] text-faint">
          <Link href="/" className="inline-flex items-center gap-1.5 hover:text-muted">
            Powered by <Mark size={14} /> <b className="font-semibold">Dues</b>
          </Link>
          <span aria-hidden>|</span>
          <span>NEAR Intents 1Click</span>
          <span aria-hidden>|</span>
          <span>NEAR mainnet</span>
        </footer>
      </main>
    </div>
  );
}

function LinkBuilder({ initial }: { initial: { to: string; amount: string; memo: string } }) {
  const router = useRouter();
  const [to, setTo] = useState(initial.to);
  const [amount, setAmount] = useState(initial.amount);
  const [memo, setMemo] = useState(initial.memo);
  const [origin, setOrigin] = useState('https://sendues.vercel.app');
  useEffect(() => setOrigin(window.location.origin), []);
  const id = to.trim().toLowerCase();
  const toErr = to ? accountProblem(id) : null;
  const amtErr = amount ? amountProblem(amount.trim()) : null;
  const check = useAccountCheck(id);
  const ready = id && amount && !toErr && !amtErr && check !== 'missing';
  const query = useMemo(() => {
    const q = new URLSearchParams({ to: id, amount: amount.trim() });
    if (memo.trim()) q.set('memo', memo.trim().slice(0, 80));
    return q.toString();
  }, [id, amount, memo]);
  const link = `${origin}/pay/?${query}`;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const snippet = `<script src="${origin}/widget.js"></script>\n<dues-checkout amount="${esc(amount.trim())}" to="${esc(id)}"${memo.trim() ? ` memo="${esc(memo.trim().slice(0, 80))}"` : ''}></dues-checkout>`;

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-[640px] px-4 pt-10 pb-16 sm:px-6">
        <h1 className="text-[28px] leading-9 font-semibold tracking-[-0.02em]">Payment link</h1>
        <p className="mt-2 text-[15px] leading-6 text-ink-2">
          A checkout for any NEAR account. Your customer pays from any chain; you receive exactly the amount, in USDC on NEAR.
          No sign-in, no contract, no keys.
        </p>
        <div className="mt-5">
          <Notice tone="warn">
            Real money. NEAR Intents runs on mainnet only, so payment links take real payments to a NEAR <b>mainnet</b> account. Use
            an account you control.
          </Notice>
        </div>
        <Card className="mt-6 space-y-5 p-6">
          <Field
            label="Your NEAR mainnet account"
            htmlFor="to"
            hint={
              toErr ??
              (check === 'checking'
                ? 'Checking it exists on NEAR mainnet…'
                : check === 'ok'
                  ? 'Found on NEAR mainnet.'
                  : check === 'missing'
                    ? 'No such account on NEAR mainnet: it could not receive USDC.'
                    : check === 'error'
                      ? 'Could not reach NEAR mainnet to check it; double-check the spelling.'
                      : 'Named (yourname.near) or implicit (64 hex characters).')
            }
          >
            <input
              id="to"
              className={inputClass}
              placeholder="yourname.near"
              autoComplete="off"
              spellCheck={false}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-invalid={Boolean(toErr) || check === 'missing'}
            />
          </Field>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-[160px_1fr]">
            <Field label="Amount (USD)" htmlFor="amount" hint={amtErr ?? `Settled as USDC. $${MIN_USD} to $${MAX_USD.toLocaleString('en-US')}.`}>
              <input
                id="amount"
                className={inputClass}
                inputMode="decimal"
                placeholder="25"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={Boolean(amtErr)}
              />
            </Field>
            <Field label="Memo (optional)" htmlFor="memo" hint="Shown to the payer, like an order number.">
              <input id="memo" className={inputClass} maxLength={80} placeholder="Order 1042" value={memo} onChange={(e) => setMemo(e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card className="mt-4 p-6">
          <h2 className="text-[15px] font-semibold">Your link</h2>
          {ready ? (
            <>
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-sunken px-3 py-2.5">
                <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{link}</code>
                <CopyButton text={link} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" onClick={() => router.push(`/pay/?${query}`)}>
                  Open the checkout
                </Button>
              </div>
              <h3 className="mt-6 text-[13px] font-medium text-ink-2">Or put the button on your own site</h3>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-sunken p-3 font-mono text-[12px] leading-5">{snippet}</pre>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-muted">Fill in your account and an amount to get a link.</p>
          )}
        </Card>
      </main>
    </>
  );
}
