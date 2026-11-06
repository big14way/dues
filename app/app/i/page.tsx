'use client';
// Hosted invoice page: /i/?id=N. Public; anyone with the link can see and pay it.
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import type { Invoice } from '@dues/core';
import { chainName } from '@dues/widget/tokens';
import { Avatar } from '@/components/avatar';
import { InvoiceSummary } from '@/components/invoice';
import { Mark } from '@/components/logo';
import { PayCard, RetainerCard } from '@/components/pay';
import { Card, CopyButton, Notice, Skeleton, TxLink } from '@/components/ui';
import { CancelInvoice } from '@/components/cancel';
import { AccountMenu } from '@/components/header';
import { networkLabel, originUrl, txUrl } from '@/lib/config';
import { day, methodLine, paymentOf, usd } from '@/lib/format';
import { useDues } from '@/lib/wallet';

export default function InvoicePage() {
  return (
    <Suspense fallback={<Shell><Loading /></Shell>}>
      <InvoiceRoute />
    </Suspense>
  );
}

function Shell({ children, freelancer }: { children: React.ReactNode; freelancer?: string }) {
  const { cfg } = useDues();
  return (
    <div className="min-h-screen bg-canvas">
      <main className="mx-auto w-full max-w-[480px] px-4 pt-10 pb-16 sm:pt-14">
        <div className="mb-5 flex items-center gap-2.5">
          {freelancer ? <Avatar account={freelancer} size={30} /> : <Mark size={30} />}
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{freelancer ?? 'Dues'}</span>
          <AccountMenu />
        </div>
        <div className="space-y-4">{children}</div>
        <footer className="mt-8 flex items-center justify-center gap-3 text-[12px] text-faint">
          <Link href="/" className="inline-flex items-center gap-1.5 hover:text-muted">
            Powered by <Mark size={14} /> <b className="font-semibold">Dues</b>
          </Link>
          <span aria-hidden>|</span>
          <span>{networkLabel(cfg.network)}</span>
          <span aria-hidden>|</span>
          <span className="font-mono">{cfg.contract}</span>
        </footer>
      </main>
    </div>
  );
}

function Loading() {
  return (
    <>
      <Card className="space-y-3 p-7">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="mt-6 h-16 w-full" />
      </Card>
      <Card className="space-y-3 p-7">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-11 w-full" />
      </Card>
    </>
  );
}

function InvoiceRoute() {
  const params = useSearchParams();
  const id = Number(params.get('id'));
  const { view, accountId } = useDues();
  const [inv, setInv] = useState<Invoice | null | undefined>(undefined);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!Number.isInteger(id) || id < 1) return setInv(null);
    try {
      const v = await view.invoice(id);
      setInv(v);
      setError('');
      if (v?.recurrence === 'monthly' && v.status === 'paid' && !v.retainer) {
        const list = await view.byFreelancer(v.freelancer, 100);
        setNext(list.find((x) => x.previous_id === id)?.id ?? null);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, view]);

  useEffect(() => {
    void load();
  }, [load]);
  // Keep the status live while money can still move.
  useEffect(() => {
    if (!inv || inv.status !== 'pending') return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [inv, load]);

  if (inv === undefined && !error) return <Shell><Loading /></Shell>;
  if (error) return <Shell><Notice tone="bad">Could not read the invoice from NEAR: {error}</Notice></Shell>;
  if (!inv) {
    return (
      <Shell>
        <Card className="p-7">
          <h1 className="text-[17px] font-semibold">No invoice here</h1>
          <p className="mt-2 text-[13.5px] text-muted">Check the link you were sent. Invoice links look like /i/?id=12.</p>
        </Card>
      </Shell>
    );
  }
  const own = accountId === inv.freelancer;
  return (
    <Shell freelancer={inv.freelancer}>
      <InvoiceSummary inv={inv} />
      {own && inv.status === 'pending' && !inv.retainer ? <ShareCard inv={inv} /> : null}
      {inv.retainer ? (
        <RetainerCard inv={inv} onChange={load} />
      ) : inv.status === 'pending' ? (
        own ? null : <PayCard inv={inv} onChange={load} />
      ) : (
        <Outcome inv={inv} next={next} />
      )}
    </Shell>
  );
}

function ShareCard({ inv }: { inv: Invoice }) {
  const url = typeof window !== 'undefined' ? window.location.href : '';
  return (
    <Card className="p-6">
      <h2 className="text-[15px] font-medium">Send this link to your client</h2>
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-sunken px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{url}</code>
        <CopyButton text={url} />
      </div>
      <p className="mt-3 text-[12.5px] leading-5 text-muted">
        They can pay from any wallet on any chain, or with USDC on NEAR. You receive USDC on NEAR either way.
      </p>
      <div className="mt-4 border-t border-line pt-4">
        <CancelInvoice inv={inv} />
      </div>
    </Card>
  );
}

function Outcome({ inv, next }: { inv: Invoice; next: number | null }) {
  const { cfg } = useDues();
  if (inv.status === 'paid') {
    const t = paymentOf(inv);
    const origin = t?.kind === 'intent' ? originUrl(cfg, t.origin_chain, t.origin_tx) : undefined;
    return (
      <Card className="p-6 sm:p-7">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-9 items-center justify-center rounded-full bg-good-bg text-good" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <div>
            <h2 className="text-[15px] font-semibold">Paid {t ? day(t.ts) : ''}</h2>
            <p className="text-[13px] text-muted">{t ? methodLine(t) : 'Paid in full'}</p>
          </div>
        </div>
        {t ? (
          <dl className="mt-5 space-y-2 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">{inv.freelancer} received</dt>
              <dd className="tnum font-medium">{usd(t.amount_usdc)} USDC</dd>
            </div>
            {BigInt(t.fee_usdc) > 0n ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Conversion cost, paid by the payer</dt>
                <dd className="tnum">{usd(t.fee_usdc)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-muted">NEAR transaction</dt>
              <dd>{t.hash ? <TxLink hash={t.hash} href={txUrl(cfg, t.hash)} /> : <span className="text-muted">being recorded</span>}</dd>
            </div>
            {t.origin_tx ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{chainName(t.origin_chain ?? '')} transaction</dt>
                <dd>
                  <TxLink hash={t.origin_tx} href={origin} />
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {next ? (
          <div className="mt-5 border-t border-line pt-4 text-[13px]">
            Next month&apos;s invoice is ready:{' '}
            <Link className="font-medium text-accent hover:underline" href={`/i/?id=${next}`}>
              invoice #{next}
            </Link>
          </div>
        ) : null}
      </Card>
    );
  }
  return (
    <Card className="p-6 sm:p-7">
      <h2 className="text-[15px] font-semibold">{inv.status === 'refunded' ? 'Payment refunded' : 'Invoice cancelled'}</h2>
      <p className="mt-1.5 text-[13px] leading-5 text-muted">
        {inv.status === 'refunded'
          ? 'The payment could not complete, so NEAR Intents sent it back to the payer on the chain they paid from. Nothing was received. Ask the freelancer for a new link to try again.'
          : `${inv.freelancer} cancelled this invoice. It can no longer be paid.`}
      </p>
    </Card>
  );
}
