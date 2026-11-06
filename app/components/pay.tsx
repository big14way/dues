'use client';
// The payment card: pick a method, pay. Any chain goes through the <dues-checkout> widget (NEAR
// Intents 1Click); USDC on NEAR is one ft_transfer_call to the Dues contract; a monthly invoice can
// be prepaid into escrow. After a NEAR payment the watcher checks the transaction and records it.
import { useEffect, useState, type ReactNode } from 'react';
import { formatUsdc, type Invoice } from '@dues/core';
import { DuesCheckout } from '@dues/widget/react';
import { txUrl } from '@/lib/config';
import { usePageTheme } from '@/lib/theme';
import { day, relative, usd } from '@/lib/format';
import { describeFailure, useDues } from '@/lib/wallet';
import { AccountMenu } from './header';
import { Button, Card, Notice, TxLink, cx } from './ui';

const TGAS = 1_000_000_000_000n;
type Method = 'any' | 'near' | 'prepay';

async function annotate(apiBase: string, invoiceId: number, hash: string): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase}/watcher/annotate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invoiceId, hash }),
    });
    return res.ok ? null : ((await res.json()) as { error?: string }).error ?? `watcher answered ${res.status}`;
  } catch (e) {
    return (e as Error).message;
  }
}

function Tile({ active, onClick, title, sub, icon }: { active: boolean; onClick(): void; title: string; sub: string; icon: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'flex min-h-[64px] flex-1 flex-col items-start justify-between rounded-lg border bg-surface px-3 py-2.5 text-left transition-colors',
        active ? 'border-ink ring-1 ring-ink' : 'border-line-strong hover:bg-sunken',
      )}
    >
      <span className="text-muted">{icon}</span>
      <span className="mt-1.5 text-[13px] leading-4 font-medium text-ink">{title}</span>
      <span className="text-[11.5px] leading-4 text-muted">{sub}</span>
    </button>
  );
}

const icons = {
  any: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="7" cy="12" r="4" />
      <circle cx="17" cy="12" r="4" />
      <path d="M11 12h2" />
    </svg>
  ),
  near: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v10M9.5 9.5h3.75a1.75 1.75 0 0 1 0 3.5h-2.5a1.75 1.75 0 0 0 0 3.5H14.5" />
    </svg>
  ),
  prepay: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  ),
};

export function PayCard({ inv, onChange }: { inv: Invoice; onChange(): void }) {
  const { cfg } = useDues();
  const monthly = inv.recurrence === 'monthly';
  const [method, setMethod] = useState<Method>('any');
  const amount = formatUsdc(inv.amount_usdc);
  const inFlight = Boolean(inv.deposit_addr);
  const theme = usePageTheme();
  return (
    <Card className="p-6 sm:p-7">
      <h2 className="text-[15px] font-medium">Choose how to pay</h2>
      <div className="mt-3 flex gap-2">
        <Tile active={method === 'any'} onClick={() => setMethod('any')} title="Any wallet" sub="Base, Solana, Ethereum…" icon={icons.any} />
        <Tile active={method === 'near'} onClick={() => setMethod('near')} title="USDC on NEAR" sub="One transfer" icon={icons.near} />
        {monthly && !inFlight ? (
          <Tile active={method === 'prepay'} onClick={() => setMethod('prepay')} title="Prepay months" sub="Held in escrow" icon={icons.prepay} />
        ) : null}
      </div>
      <div className="mt-5">
        {method === 'any' ? (
          <>
            <DuesCheckout
              amount={amount}
              to={inv.freelancer}
              memo={`Invoice #${inv.id} · ${inv.title}`}
              invoice={inv.id}
              dry={cfg.checkout.dry}
              trackUrl={cfg.checkout.track ? `${cfg.apiBase}/watcher/track` : undefined}
              statusUrl={cfg.checkout.track ? `${cfg.apiBase}/watcher/status` : undefined}
              onPaid={() => onChange()}
              onStatus={() => onChange()}
              compact
              theme={theme}
              dryNote={
                cfg.network === 'sandbox'
                  ? 'Sandbox: prices are live from NEAR Intents; the payment is a recorded 1Click run, settled in mock USDC on the local chain.'
                  : undefined
              }
            />
            {cfg.checkout.dry && !cfg.checkout.track ? (
              <p className="mt-3 text-[12px] leading-5 text-muted">
                NEAR Intents has no testnet, so this checkout quotes live prices but issues no deposit address. To pay this
                invoice for real on testnet, use USDC on NEAR.
              </p>
            ) : null}
          </>
        ) : method === 'near' ? (
          <PayWithNear inv={inv} onChange={onChange} />
        ) : (
          <Prepay inv={inv} onChange={onChange} />
        )}
      </div>
    </Card>
  );
}

function useUsdcBalance(account: string | null, bump: number) {
  const { cfg, provider } = useDues();
  const [bal, setBal] = useState<bigint | null>(null);
  useEffect(() => {
    if (!account) return setBal(null);
    let live = true;
    void provider
      .callFunction({ contractId: cfg.usdc, method: 'ft_balance_of', args: { account_id: account } })
      .then((v) => live && setBal(BigInt(String(v ?? '0'))))
      .catch(() => live && setBal(0n));
    return () => {
      live = false;
    };
  }, [account, bump, cfg.usdc, provider]);
  return bal;
}

function WhoPays({ inv }: { inv: Invoice }): ReactNode {
  const { accountId } = useDues();
  if (!accountId) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg bg-sunken px-3 py-3">
        <span className="text-[13px] text-ink-2">Sign in with the NEAR wallet that holds your USDC.</span>
        <AccountMenu />
      </div>
    );
  }
  if (accountId === inv.freelancer) return <Notice tone="warn">This is your own invoice. Share the link with your client instead.</Notice>;
  if (inv.client && inv.client !== accountId) {
    return (
      <Notice tone="warn">
        This invoice is addressed to <b>{inv.client}</b>. A payment from {accountId} would be returned automatically.
      </Notice>
    );
  }
  return null;
}

function PayWithNear({ inv, onChange }: { inv: Invoice; onChange(): void }) {
  const { cfg, accountId, call } = useDues();
  const [bump, setBump] = useState(0);
  const bal = useUsdcBalance(accountId, bump);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hash, setHash] = useState('');
  const block = WhoPays({ inv });
  const short = bal !== null && bal < BigInt(inv.amount_usdc);
  const pay = async () => {
    setBusy(true);
    setErr('');
    try {
      const h = await call(cfg.usdc, [
        {
          method: 'ft_transfer_call',
          args: { receiver_id: cfg.contract, amount: inv.amount_usdc, msg: JSON.stringify({ invoice_id: inv.id }) },
          gas: 100n * TGAS,
          deposit: 1n,
        },
      ]);
      if (h) {
        setHash(h);
        const problem = await annotate(cfg.apiBase, inv.id, h);
        if (problem) setErr(`Paid, but the receipt link could not be recorded yet: ${problem}`);
      }
      setBump((b) => b + 1);
      onChange();
    } catch (e) {
      setErr(describeFailure(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      {block ?? (
        <div className="rounded-lg border border-line px-3 py-2.5 text-[13px]">
          <div className="flex justify-between gap-3">
            <span className="text-muted">From</span>
            <span className="truncate">{accountId}</span>
          </div>
          <div className="mt-1 flex justify-between gap-3">
            <span className="text-muted">Your USDC on NEAR</span>
            <span className={cx('tnum', short && 'text-bad')}>{bal === null ? '…' : usd(bal)}</span>
          </div>
          <div className="mt-1 flex justify-between gap-3">
            <span className="text-muted">Network fee</span>
            <span>under 0.001 NEAR, from your wallet</span>
          </div>
        </div>
      )}
      {short && !block ? (
        <Notice tone="warn">
          Not enough USDC on NEAR.{' '}
          {cfg.network === 'testnet' ? (
            <>
              Get testnet USDC at{' '}
              <a className="underline" href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">
                faucet.circle.com
              </a>{' '}
              (network: NEAR testnet).
            </>
          ) : (
            'Use "Any wallet" to pay from another chain.'
          )}
        </Notice>
      ) : null}
      <Button size="lg" className="w-full" onClick={pay} busy={busy} disabled={Boolean(block) || short || bal === null}>
        Pay {usd(inv.amount_usdc)}
      </Button>
      <p className="text-[12px] leading-5 text-muted">
        Sends USDC to the Dues contract, which forwards exactly {usd(inv.amount_usdc)} to {inv.freelancer} in the same
        transaction. If anything fails, all of it comes back to you.
      </p>
      {hash ? (
        <Notice tone="good">
          Payment sent. <TxLink hash={hash} href={txUrl(cfg, hash)} />
        </Notice>
      ) : null}
      {err ? <Notice tone="bad">{err}</Notice> : null}
    </div>
  );
}

function Prepay({ inv, onChange }: { inv: Invoice; onChange(): void }) {
  const { cfg, accountId, call } = useDues();
  const [months, setMonths] = useState(3);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const bal = useUsdcBalance(accountId, 0);
  const total = BigInt(inv.amount_usdc) * BigInt(months);
  const block = WhoPays({ inv });
  const fund = async () => {
    setBusy(true);
    setErr('');
    try {
      const h = await call(cfg.usdc, [
        {
          method: 'ft_transfer_call',
          args: { receiver_id: cfg.contract, amount: total.toString(), msg: JSON.stringify({ invoice_id: inv.id }) },
          gas: 100n * TGAS,
          deposit: 1n,
        },
      ]);
      if (h) await annotate(cfg.apiBase, inv.id, h);
      onChange();
    } catch (e) {
      setErr(describeFailure(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      {block}
      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Months to prepay">
        {[1, 3, 6, 12].map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={months === m}
            onClick={() => setMonths(m)}
            className={cx(
              'h-10 rounded-lg border text-[13px]',
              months === m ? 'border-ink font-medium ring-1 ring-ink' : 'border-line-strong text-ink-2 hover:bg-sunken',
            )}
          >
            {m} mo
          </button>
        ))}
      </div>
      <ul className="space-y-1.5 text-[12.5px] leading-5 text-muted">
        <li>Held by the Dues contract, not by Dues the company.</li>
        <li>
          Released to {inv.freelancer} one month at a time, from {day(inv.due_ts)}. The release can only ever pay that
          account {usd(inv.amount_usdc)}, once a month.
        </li>
        <li>Stop whenever you like and take back every month not yet released.</li>
      </ul>
      <Button
        size="lg"
        className="w-full"
        onClick={fund}
        busy={busy}
        disabled={Boolean(block) || !accountId || (bal !== null && bal < total)}
      >
        Prepay {months} month{months > 1 ? 's' : ''} · {usd(total)}
      </Button>
      {bal !== null && bal < total && !block ? <Notice tone="warn">You hold {usd(bal)} USDC on NEAR.</Notice> : null}
      {err ? <Notice tone="bad">{err}</Notice> : null}
    </div>
  );
}

/** A funded retainer: escrow balance, next release, stop and withdraw. */
export function RetainerCard({ inv, onChange }: { inv: Invoice; onChange(): void }) {
  const { cfg, accountId, call, dev } = useDues();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const escrow = BigInt(inv.escrow_usdc);
  const covered = escrow / BigInt(inv.amount_usdc);
  const isClient = accountId === inv.client;
  const active = inv.status === 'pending';
  const withdraw = async () => {
    setBusy('withdraw');
    setErr('');
    try {
      const h = await call(cfg.contract, [{ method: 'withdraw_remaining', args: { id: inv.id }, gas: 100n * TGAS }]);
      if (h) await annotate(cfg.apiBase, inv.id, h);
      onChange();
    } catch (e) {
      setErr(describeFailure(e));
    } finally {
      setBusy('');
      setConfirm(false);
    }
  };
  const advance = async (days: number) => {
    setBusy(`advance${days}`);
    setErr('');
    try {
      const res = await fetch(`${cfg.apiBase}/dev/advance?days=${days}`, { method: 'POST' });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `status ${res.status}`);
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  return (
    <Card className="p-6 sm:p-7">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-medium">Retainer escrow</h2>
        <span className="text-[12px] text-muted">month {inv.periods_paid + (active ? 1 : 0)}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-sunken px-3 py-3">
          <div className="text-[12px] text-muted">In escrow</div>
          <div className="tnum mt-0.5 text-[20px] font-semibold">{usd(escrow)}</div>
          <div className="text-[12px] text-muted">
            covers {covered.toString()} month{covered === 1n ? '' : 's'}
          </div>
        </div>
        <div className="rounded-lg bg-sunken px-3 py-3">
          <div className="text-[12px] text-muted">{active ? 'Next release' : 'Status'}</div>
          <div className="mt-0.5 text-[20px] font-semibold">{active ? day(inv.due_ts).replace(/, \d{4}$/, '') : 'Ended'}</div>
          <div className="text-[12px] text-muted">{active ? relative(inv.due_ts) : `${inv.periods_paid} month${inv.periods_paid === 1 ? '' : 's'} paid`}</div>
        </div>
      </div>
      <p className="mt-4 text-[12.5px] leading-5 text-muted">
        On each due date the scheduler calls <code className="font-mono text-[12px]">pull</code>, which moves exactly{' '}
        {usd(inv.amount_usdc)} from escrow to {inv.freelancer}. Anyone may call it; it can pay no one else and never twice in a month.
      </p>
      {isClient && active ? (
        <div className="mt-4">
          {confirm ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-bad/30 bg-bad-bg px-3 py-2.5">
              <span className="flex-1 text-[13px] text-bad">
                Stop the retainer? What is left in escrow comes back to you; a month already due is paid first.
              </span>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                Keep it
              </Button>
              <Button size="sm" variant="danger" busy={busy === 'withdraw'} onClick={withdraw}>
                Stop and withdraw
              </Button>
            </div>
          ) : (
            <Button variant="danger" className="w-full" onClick={() => setConfirm(true)}>
              Stop retainer and withdraw the rest
            </Button>
          )}
        </div>
      ) : null}
      {dev && active ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2.5">
          <span className="flex-1 text-[12px] text-muted">Sandbox clock: jump ahead, then the scheduler runs.</span>
          <Button size="sm" variant="secondary" busy={busy === 'advance1'} onClick={() => advance(1)}>
            +1 day
          </Button>
          <Button size="sm" variant="secondary" busy={busy === 'advance31'} onClick={() => advance(31)}>
            +1 month
          </Button>
        </div>
      ) : null}
      {err ? (
        <div className="mt-3">
          <Notice tone="bad">{err}</Notice>
        </div>
      ) : null}
    </Card>
  );
}
