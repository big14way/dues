'use client';
// Freelancer dashboard: every invoice from the contract, plain-language status, tx links, CSV.
// /dashboard/?account=x.testnet shows any account read-only (all of this is public on-chain).
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { invoicesToCsv, type Invoice, type InvoiceStatus } from '@dues/core';
import { chainName } from '@dues/widget/tokens';
import { Avatar } from '@/components/avatar';
import { CancelInvoice } from '@/components/cancel';
import { AccountMenu, Header } from '@/components/header';
import { Button, ButtonLink, Card, Notice, Pill, Skeleton, TxLink, cx, inputClass } from '@/components/ui';
import { originUrl, txUrl } from '@/lib/config';
import { day, dayShort, paymentOf, relative, statusOf, usd } from '@/lib/format';
import { useDues } from '@/lib/wallet';

type Filter = 'all' | 'open' | 'paid' | 'refunded' | 'cancelled';
const FILTERS: { id: Filter; label: string; match: (s: InvoiceStatus) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'open', label: 'Open', match: (s) => s === 'pending' },
  { id: 'paid', label: 'Paid', match: (s) => s === 'paid' },
  { id: 'refunded', label: 'Refunded', match: (s) => s === 'refunded' },
  { id: 'cancelled', label: 'Cancelled', match: (s) => s === 'cancelled' },
];

export default function DashboardPage() {
  return (
    <>
      <Header />
      <Suspense fallback={null}>
        <Dashboard />
      </Suspense>
    </>
  );
}

function Dashboard() {
  const params = useSearchParams();
  const { accountId } = useDues();
  const lookup = params.get('account');
  const account = lookup || accountId;
  if (!account) return <SignedOut />;
  return <Invoices account={account} readOnly={Boolean(lookup) && lookup !== accountId} />;
}

function SignedOut() {
  const router = useRouter();
  const [q, setQ] = useState('');
  return (
    <main className="mx-auto max-w-6xl px-4 pt-10 pb-20 sm:px-6">
      <Card className="max-w-xl p-7">
        <h1 className="text-[18px] font-semibold">Your invoices</h1>
        <p className="mt-1.5 text-[13.5px] leading-5 text-muted">Sign in to see and manage the invoices your NEAR account created.</p>
        <div className="mt-5">
          <AccountMenu align="left" />
        </div>
        <form
          className="mt-6 flex gap-2 border-t border-line pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) router.push(`/dashboard/?account=${encodeURIComponent(q.trim().toLowerCase())}`);
          }}
        >
          <input className={inputClass} placeholder="or look up any account, read-only" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button variant="secondary" type="submit">
            Look up
          </Button>
        </form>
      </Card>
    </main>
  );
}

function sumPaid(list: Invoice[]): bigint {
  let s = 0n;
  for (const inv of list) for (const t of inv.txs) if (t.kind === 'intent' || t.kind === 'direct' || t.kind === 'pull') s += BigInt(t.amount_usdc);
  return s;
}

function Invoices({ account, readOnly }: { account: string; readOnly: boolean }) {
  const { view, cfg } = useDues();
  const [list, setList] = useState<Invoice[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    try {
      setList(await view.byFreelancer(account, 100));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [account, view]);
  useEffect(() => {
    setList(null);
    void load();
    const t = setInterval(() => void load(), 6000);
    return () => clearInterval(t);
  }, [load]);

  const stats = useMemo(() => {
    if (!list) return null;
    const open = list.filter((i) => i.status === 'pending' && !i.retainer);
    const fees = list.flatMap((i) => i.txs).reduce((a, t) => a + BigInt(t.fee_usdc), 0n);
    return {
      received: sumPaid(list),
      paidCount: list.reduce((a, i) => a + i.txs.filter((t) => t.kind === 'intent' || t.kind === 'direct' || t.kind === 'pull').length, 0),
      outstanding: open.reduce((a, i) => a + BigInt(i.amount_usdc), 0n),
      openCount: open.length,
      escrow: list.reduce((a, i) => a + BigInt(i.escrow_usdc), 0n),
      retainers: list.filter((i) => i.retainer && i.status === 'pending').length,
      refunded: list.filter((i) => i.status === 'refunded').length,
      fees,
    };
  }, [list]);

  const exportCsv = () => {
    if (!list) return;
    const csv = invoicesToCsv(list, { txCell: (h) => txUrl(cfg, h) ?? h });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `dues-${account}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const shown = list?.filter((i) => FILTERS.find((f) => f.id === filter)!.match(i.status)) ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 pt-8 pb-20 sm:px-6">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar account={account} size={40} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[22px] font-semibold tracking-[-0.01em]">{account}</h1>
          <p className="text-[13px] text-muted">{readOnly ? 'Read-only view of public on-chain invoices' : 'Invoices you created'}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={exportCsv} disabled={!list?.length}>
            Export CSV
          </Button>
          {!readOnly ? <ButtonLink href="/new/">New invoice</ButtonLink> : null}
        </div>
      </div>

      {error ? (
        <div className="mt-6">
          <Notice tone="bad">Could not read invoices from NEAR: {error}</Notice>
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Received" value={stats ? `${usd(stats.received)}` : null} sub={stats ? `${stats.paidCount} payment${stats.paidCount === 1 ? '' : 's'}, in USDC on NEAR` : ''} />
        <Stat label="Outstanding" value={stats ? usd(stats.outstanding) : null} sub={stats ? `${stats.openCount} open invoice${stats.openCount === 1 ? '' : 's'}` : ''} />
        <Stat label="In retainer escrow" value={stats ? usd(stats.escrow) : null} sub={stats ? `${stats.retainers} active retainer${stats.retainers === 1 ? '' : 's'}` : ''} />
        <Stat
          label="Conversion costs"
          value={stats ? usd(stats.fees) : null}
          sub={stats ? `paid by clients · ${stats.refunded} refunded` : ''}
        />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex gap-1 overflow-x-auto border-b border-line px-3 pt-2" role="tablist">
          {FILTERS.map((f) => {
            const n = list?.filter((i) => f.match(i.status)).length ?? 0;
            return (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cx(
                  '-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 px-2.5 text-[13px] whitespace-nowrap',
                  filter === f.id ? 'border-accent font-medium text-ink' : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {f.label}
                <span className="tnum rounded bg-chip px-1.5 text-[11px] text-muted">{n}</span>
              </button>
            );
          })}
        </div>
        {list === null ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-[14px] font-medium">{list.length === 0 ? 'No invoices yet' : 'Nothing here'}</p>
            <p className="mt-1 text-[13px] text-muted">
              {list.length === 0 ? 'Create one and send the link; your client pays from any chain.' : 'Try another tab.'}
            </p>
            {list.length === 0 && !readOnly ? (
              <div className="mt-4">
                <ButtonLink href="/new/">New invoice</ButtonLink>
              </div>
            ) : null}
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="hidden text-left text-[12px] text-muted md:table-header-group">
              <tr className="border-b border-line">
                <th className="px-5 py-2.5 font-medium">Invoice</th>
                <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Receipt</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((inv) => (
                <Row key={inv.id} inv={inv} readOnly={readOnly} onChange={load} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="mt-4 text-[12px] text-muted">
        Read live from <span className="font-mono">{cfg.contract}</span>. The CSV has one row per payment: date, invoice, client, amount,
        fee, tx link, status.
      </p>
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | null; sub: string }) {
  return (
    <Card className="px-4 py-3.5">
      <div className="text-[12px] text-muted">{label}</div>
      {value === null ? <Skeleton className="mt-1.5 h-6 w-24" /> : <div className="tnum mt-0.5 text-[20px] font-semibold tracking-[-0.01em]">{value}</div>}
      <div className="mt-0.5 truncate text-[12px] text-muted">{sub}</div>
    </Card>
  );
}

function Row({ inv, readOnly, onChange }: { inv: Invoice; readOnly: boolean; onChange(): void }) {
  const { cfg } = useDues();
  const s = statusOf(inv);
  const pay = paymentOf(inv);
  const refund = inv.txs.find((t) => t.kind === 'refund');
  const when = pay ? pay.ts : inv.due_ts;
  return (
    <tr className="flex flex-col gap-1.5 px-5 py-3.5 md:table-row md:p-0">
      <td className="md:px-5 md:py-3">
        <Link href={`/i/?id=${inv.id}`} className="font-medium hover:underline">
          {inv.title}
        </Link>
        <div className="text-[12px] text-muted">
          #{inv.id} · {inv.client ?? 'anyone with the link'}
          {inv.recurrence === 'monthly' ? ' · monthly' : ''}
        </div>
      </td>
      <td className="tnum md:px-3 md:py-3 md:text-right">{usd(inv.amount_usdc)}</td>
      <td className="md:px-3 md:py-3">
        <span title={s.sentence}>
          <Pill tone={s.tone}>{s.label}</Pill>
        </span>
      </td>
      <td className="md:px-3 md:py-3">
        {inv.retainer && inv.status === 'pending' ? (
          <>
            <div>Next {dayShort(inv.due_ts)}</div>
            <div className="text-[12px] text-muted">
              {inv.periods_paid} month{inv.periods_paid === 1 ? '' : 's'} paid
            </div>
          </>
        ) : refund ? (
          <>
            <div>Refunded {dayShort(refund.ts)}</div>
            <div className="text-[12px] text-muted">{day(refund.ts)}</div>
          </>
        ) : (
          <>
            <div>{pay ? `Paid ${dayShort(when)}` : `Due ${dayShort(when)}`}</div>
            <div className="text-[12px] text-muted">{pay ? day(when) : relative(when)}</div>
          </>
        )}
      </td>
      <td className="md:px-3 md:py-3">
        <div className="flex flex-col gap-0.5">
          {pay?.hash ? <TxLink hash={pay.hash} href={txUrl(cfg, pay.hash)} label={`NEAR ${pay.hash.slice(0, 6)}…`} /> : null}
          {pay?.origin_tx && pay.kind === 'intent' ? (
            <TxLink hash={pay.origin_tx} href={originUrl(cfg, pay.origin_chain, pay.origin_tx)} label={`${chainName(pay.origin_chain ?? '')} ${pay.origin_tx.slice(0, 6)}…`} />
          ) : null}
          {refund?.origin_tx ? (
            <TxLink hash={refund.origin_tx} href={originUrl(cfg, refund.origin_chain, refund.origin_tx)} label={`refund ${refund.origin_tx.slice(0, 6)}…`} />
          ) : null}
          {!pay && !refund ? <span className="text-[12px] text-faint">—</span> : null}
        </div>
      </td>
      <td className="md:px-5 md:py-3 md:text-right">{!readOnly ? <CancelInvoice inv={inv} onDone={onChange} compact /> : null}</td>
    </tr>
  );
}
