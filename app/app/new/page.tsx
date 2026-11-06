'use client';
// Create an invoice. One wallet approval turns on gasless invoicing (a session key that can only
// create and cancel Dues invoices); every invoice after that is relayed and the relayer pays gas.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { parseUsdc } from '@dues/core';
import { Avatar } from '@/components/avatar';
import { AccountMenu, Header } from '@/components/header';
import { Button, ButtonLink, Card, CopyButton, Field, Notice, Skeleton, TxLink, cx, inputClass } from '@/components/ui';
import { txUrl } from '@/lib/config';
import { day, ordinal, usd } from '@/lib/format';
import { SESSION_METHODS } from '@/lib/session';
import { useSession } from '@/lib/use-session';
import { describeFailure, useDues } from '@/lib/wallet';

interface Item {
  description: string;
  amount: string;
}

const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

function toUnits(s: string): bigint | null {
  try {
    return BigInt(parseUsdc(s));
  } catch {
    return null;
  }
}

function isoDay(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export default function NewInvoicePage() {
  const { accountId } = useDues();
  const session = useSession();
  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl px-4 pt-8 pb-20 sm:px-6">
        <div className="mb-6">
          <h1 className="text-[24px] font-semibold tracking-[-0.01em]">New invoice</h1>
          <p className="mt-1 text-[13.5px] text-muted">Your client pays from any wallet, on any chain. You receive USDC on NEAR.</p>
        </div>
        {!accountId ? (
          <SignInCard />
        ) : session.state === 'checking' ? (
          <Card className="max-w-xl space-y-3 p-7">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-10 w-40" />
          </Card>
        ) : session.state === 'missing' ? (
          <EnableCard enable={session.enable} />
        ) : (
          <InvoiceForm run={session.run} addedHash={session.addedHash} />
        )}
      </main>
    </>
  );
}

function SignInCard() {
  return (
    <Card className="max-w-xl p-7">
      <h2 className="text-[16px] font-semibold">Sign in with your NEAR account</h2>
      <p className="mt-1.5 text-[13.5px] leading-5 text-muted">
        Invoices are created by your NEAR account and paid out to it in USDC. Dues never holds your keys or your money.
      </p>
      <div className="mt-5">
        <AccountMenu align="left" />
      </div>
    </Card>
  );
}

function EnableCard({ enable }: { enable(): Promise<string | null> }) {
  const { cfg, accountId } = useDues();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Card className="max-w-xl p-7">
      <h2 className="text-[16px] font-semibold">Turn on gasless invoicing</h2>
      <p className="mt-1.5 text-[13.5px] leading-5 text-muted">
        One approval in your wallet adds a key to <b className="text-ink">{accountId}</b> that this browser keeps. From then on
        Dues pays the network fee for every invoice you create or cancel.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-good-bg px-4 py-3">
          <div className="text-[12px] font-medium tracking-[0.04em] text-good uppercase">The key can</div>
          <ul className="mt-1.5 space-y-1 text-[13px] text-ink-2">
            {SESSION_METHODS.map((m) => (
              <li key={m}>
                call <code className="font-mono text-[12px]">{m}</code> on <code className="font-mono text-[12px]">{cfg.contract}</code>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg bg-sunken px-4 py-3">
          <div className="text-[12px] font-medium tracking-[0.04em] text-muted uppercase">The key cannot</div>
          <ul className="mt-1.5 space-y-1 text-[13px] text-ink-2">
            <li>move NEAR or USDC</li>
            <li>attach a deposit</li>
            <li>call any other contract</li>
          </ul>
        </div>
      </div>
      <p className="mt-4 text-[12.5px] leading-5 text-muted">
        This approval is the only transaction you pay for (under 0.001 NEAR). Remove the key from your wallet whenever you like.
      </p>
      <Button
        size="lg"
        className="mt-5"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setErr('');
          try {
            await enable();
          } catch (e) {
            setErr(describeFailure(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Approve in wallet
      </Button>
      {err ? (
        <div className="mt-3">
          <Notice tone="bad">{err}</Notice>
        </div>
      ) : null}
    </Card>
  );
}

interface Created {
  id: number;
  hash: string;
  registeredHash?: string;
}

function InvoiceForm({ run, addedHash }: { run: ReturnType<typeof useSession>['run']; addedHash: string | null }) {
  const { cfg, accountId } = useDues();
  const [client, setClient] = useState('');
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<Item[]>([{ description: '', amount: '' }]);
  const [due, setDue] = useState(isoDay(Date.now() + 14 * 86_400_000));
  const [monthly, setMonthly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [created, setCreated] = useState<Created | null>(null);

  const units = items.map((i) => toUnits(i.amount));
  const total = units.reduce<bigint>((a, u) => a + (u ?? 0n), 0n);
  const dueTs = useMemo(() => {
    const [y, m, d] = due.split('-').map(Number);
    return y && m && d ? Date.UTC(y, m - 1, d, 9) : NaN;
  }, [due]);
  const clientOk = client.trim() === '' || (ACCOUNT_RE.test(client.trim()) && client.trim() !== accountId);
  const problems = [
    !title.trim() && 'Add a title, for example "Logo design".',
    items.some((i) => !i.description.trim()) && 'Every line needs a description.',
    units.some((u) => u === null || u === 0n) && 'Every line needs an amount above zero, in USD.',
    !clientOk && 'The client must be a NEAR account other than yours, or left empty.',
    Number.isNaN(dueTs) && 'Pick a due date.',
  ].filter(Boolean) as string[];

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await run('create_invoice', {
        title: title.trim(),
        amount_usdc: total.toString(),
        due_ts: dueTs,
        recurrence: monthly ? 'monthly' : 'none',
        client: client.trim() || null,
        items: items.map((i, k) => ({ description: i.description.trim(), amount_usdc: units[k]!.toString() })),
      });
      setCreated({ id: Number(r.value), hash: r.hash, registeredHash: r.registeredHash });
    } catch (e) {
      setErr(describeFailure(e));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    const link = `${window.location.origin}/i/?id=${created.id}`;
    return (
      <Card className="max-w-xl p-7">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-9 items-center justify-center rounded-full bg-good-bg text-good" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <div>
            <h2 className="text-[16px] font-semibold">Invoice #{created.id} is ready to send</h2>
            <p className="text-[13px] text-muted">
              {usd(total)} {monthly ? 'every month' : ''} · due {day(dueTs)}
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-2 rounded-lg bg-sunken px-3 py-2">
          <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{link}</code>
          <CopyButton text={link} />
        </div>
        <dl className="mt-5 space-y-2 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Created on NEAR, gas paid by the Dues relayer</dt>
            <dd>
              <TxLink hash={created.hash} href={txUrl(cfg, created.hash)} />
            </dd>
          </div>
          {created.registeredHash ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Registered you to receive USDC (relayer paid)</dt>
              <dd>
                <TxLink hash={created.registeredHash} href={txUrl(cfg, created.registeredHash)} />
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-6 flex flex-wrap gap-2">
          <ButtonLink href={`/i/?id=${created.id}`}>Open invoice</ButtonLink>
          <Button
            variant="secondary"
            onClick={() => {
              setCreated(null);
              setTitle('');
              setItems([{ description: '', amount: '' }]);
            }}
          >
            Create another
          </Button>
          <ButtonLink href="/dashboard/" variant="ghost">
            All invoices
          </ButtonLink>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <Card className="p-6 sm:p-7">
        {addedHash ? (
          <div className="mb-5">
            <Notice tone="good">
              Gasless invoicing is on. <TxLink hash={addedHash} href={txUrl(cfg, addedHash)} label="Key added" />
            </Notice>
          </div>
        ) : null}
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (problems.length === 0) void submit();
          }}
        >
          <Field label="Client" htmlFor="client" hint="Their NEAR account, if they have one. Leave empty to let anyone with the link pay.">
            <input
              id="client"
              className={cx(inputClass, !clientOk && 'border-bad')}
              placeholder="client.near (optional)"
              value={client}
              onChange={(e) => setClient(e.target.value.toLowerCase())}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Title" htmlFor="title">
            <input id="title" className={inputClass} placeholder="Brand refresh" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[13px] font-medium text-ink-2">Line items</span>
              <span className="text-[12px] text-muted">USD, settled as USDC</span>
            </div>
            <div className="space-y-2">
              {items.map((it, k) => (
                <div key={k} className="flex gap-2">
                  <input
                    aria-label={`Item ${k + 1} description`}
                    className={cx(inputClass, 'flex-1')}
                    placeholder="What you did"
                    value={it.description}
                    maxLength={120}
                    onChange={(e) => setItems(items.map((x, j) => (j === k ? { ...x, description: e.target.value } : x)))}
                  />
                  <div className="relative w-32 shrink-0">
                    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
                    <input
                      aria-label={`Item ${k + 1} amount`}
                      className={cx(inputClass, 'tnum pl-6 text-right', it.amount && units[k] === null && 'border-bad')}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={it.amount}
                      onChange={(e) => setItems(items.map((x, j) => (j === k ? { ...x, amount: e.target.value.replace(/[^\d.]/g, '') } : x)))}
                    />
                  </div>
                  <button
                    type="button"
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-sunken hover:text-ink disabled:opacity-30"
                    aria-label={`Remove item ${k + 1}`}
                    disabled={items.length === 1}
                    onClick={() => setItems(items.filter((_, j) => j !== k))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {items.length < 20 ? (
              <button
                type="button"
                className="mt-2 text-[13px] font-medium text-accent hover:underline"
                onClick={() => setItems([...items, { description: '', amount: '' }])}
              >
                + Add line
              </button>
            ) : null}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Due date" htmlFor="due">
              <input id="due" type="date" className={inputClass} value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
            <Field label="Repeats" htmlFor="monthly">
              <label className="flex h-10 cursor-pointer items-center gap-2.5 rounded-lg border border-line-strong px-3 text-sm">
                <input id="monthly" type="checkbox" className="size-4 accent-[var(--accent)]" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />
                Monthly retainer{monthly && !Number.isNaN(dueTs) ? `, on the ${ordinal(new Date(dueTs).getUTCDate())}` : ''}
              </label>
            </Field>
          </div>
          {monthly ? (
            <Notice tone="info">
              A client on NEAR can prepay months into escrow; each month is released to you on the due date. Clients on other
              chains get a fresh payment link each month.
            </Notice>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <Button type="submit" size="lg" busy={busy} disabled={problems.length > 0}>
              Create invoice · {usd(total)}
            </Button>
            <span className="text-[12.5px] text-muted">No network fee: the Dues relayer pays it.</span>
          </div>
          {problems.length > 0 && (title || items[0]!.description || items[0]!.amount) ? (
            <ul className="space-y-1 text-[12.5px] text-muted">
              {problems.map((p) => (
                <li key={p}>· {p}</li>
              ))}
            </ul>
          ) : null}
          {err ? <Notice tone="bad">{err}</Notice> : null}
        </form>
      </Card>
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="mb-2 text-[12px] font-medium tracking-[0.04em] text-muted uppercase">Your client sees</div>
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Avatar account={accountId!} size={24} />
            <span className="truncate text-[13px] font-semibold">{accountId}</span>
          </div>
          <div className="tnum text-[30px] leading-9 font-semibold tracking-[-0.02em]">{usd(total)}</div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            Due {Number.isNaN(dueTs) ? '…' : day(dueTs)}
            {monthly ? ' · monthly' : ''}
          </div>
          <dl className="mt-4 space-y-1 text-[12.5px]">
            <div className="grid grid-cols-[56px_1fr] gap-2">
              <dt className="text-muted">To</dt>
              <dd className="truncate">{client.trim() || <span className="text-muted">Anyone with the link</span>}</dd>
            </div>
            <div className="grid grid-cols-[56px_1fr] gap-2">
              <dt className="text-muted">Memo</dt>
              <dd className="truncate">{title || <span className="text-faint">Title</span>}</dd>
            </div>
          </dl>
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {items.map((it, k) => (
              <li key={k} className="flex justify-between gap-3 py-2 text-[12.5px]">
                <span className="truncate">{it.description || <span className="text-faint">Line {k + 1}</span>}</span>
                <span className="tnum shrink-0">{usd(units[k] ?? 0n)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 rounded-lg bg-sunken px-3 py-2 text-[12px] text-muted">
            Pay from Base, Solana, Ethereum, Tron and more, or with USDC on NEAR.
          </div>
        </Card>
        <p className="mt-3 text-[12px] text-muted">
          Your invoices: <Link href="/dashboard/" className="text-accent hover:underline">dashboard</Link>
        </p>
      </aside>
    </div>
  );
}
