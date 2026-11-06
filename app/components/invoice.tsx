'use client';
// The invoice summary card and its ledger, laid out like a hosted invoice page:
// amount and due date first, then To / From / Memo, then details on demand.
import { useState } from 'react';
import { TX_KIND_LABEL, type Invoice } from '@dues/core';
import { chainName } from '@dues/widget/tokens';
import { accountUrl, originUrl, txUrl } from '@/lib/config';
import { day, money, ordinal, statusOf, usd } from '@/lib/format';
import { useDues } from '@/lib/wallet';
import { Card, KeyValue, Pill, TxLink } from './ui';

function DocGlyph() {
  return (
    <svg width="56" height="64" viewBox="0 0 56 64" aria-hidden className="shrink-0">
      <rect x="4" y="2" width="44" height="56" rx="6" fill="var(--sunken)" stroke="var(--line)" />
      <rect x="12" y="13" width="10" height="10" rx="5" fill="var(--chip)" />
      <rect x="26" y="15" width="14" height="3" rx="1.5" fill="var(--chip)" />
      <rect x="12" y="30" width="28" height="3" rx="1.5" fill="var(--chip)" />
      <rect x="12" y="37" width="22" height="3" rx="1.5" fill="var(--chip)" />
      <rect x="12" y="44" width="25" height="3" rx="1.5" fill="var(--chip)" />
      <circle cx="44" cy="54" r="9" fill="var(--surface)" stroke="var(--line)" />
      <path d="M40.5 54.5l2.5 2.5 4.5-5" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function InvoiceSummary({ inv }: { inv: Invoice }) {
  const { cfg } = useDues();
  const [open, setOpen] = useState(false);
  const s = statusOf(inv);
  const freelancerUrl = accountUrl(cfg, inv.freelancer);
  return (
    <Card className="p-6 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2">
            <Pill tone={s.tone}>{s.label}</Pill>
          </div>
          <div className="tnum text-[36px] leading-[44px] font-semibold tracking-[-0.02em]">{usd(inv.amount_usdc)}</div>
          <div className="mt-1 text-[13px] text-muted">
            {inv.status === 'paid' ? s.sentence.split(' · ')[0] : `Due ${day(inv.due_ts)}`}
            {inv.recurrence === 'monthly' ? ` · repeats monthly on the ${ordinal(inv.anchor_day)}` : ''}
          </div>
        </div>
        <DocGlyph />
      </div>
      <dl className="mt-5">
        <KeyValue k="To">{inv.client ?? <span className="text-muted">Anyone with this link</span>}</KeyValue>
        <KeyValue k="From">
          {freelancerUrl ? (
            <a href={freelancerUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {inv.freelancer}
            </a>
          ) : (
            inv.freelancer
          )}
        </KeyValue>
        <KeyValue k="Memo">{inv.title}</KeyValue>
        <KeyValue k="Settles">USDC on NEAR, to {inv.freelancer}</KeyValue>
      </dl>
      <div className="mt-3 border-t border-line pt-3 sm:ml-[84px]">
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-[13px] text-muted hover:text-ink" aria-expanded={open}>
          {open ? 'Hide invoice details' : 'View invoice details'} <span aria-hidden>{open ? '⌃' : '›'}</span>
        </button>
      </div>
      {open ? <InvoiceDetails inv={inv} /> : null}
      <p className="mt-4 text-[12.5px] leading-5 text-muted">{s.sentence}</p>
    </Card>
  );
}

function InvoiceDetails({ inv }: { inv: Invoice }) {
  const items = inv.items.length ? inv.items : [{ description: inv.title, amount_usdc: inv.amount_usdc }];
  return (
    <div className="mt-4">
      <div className="text-[12px] font-medium tracking-[0.04em] text-muted uppercase">Invoice #{inv.id}</div>
      <ul className="mt-2 divide-y divide-line">
        {items.map((it, i) => (
          <li key={i} className="flex items-baseline justify-between gap-4 py-2.5 text-[13.5px]">
            <span className="min-w-0">{it.description}</span>
            <span className="tnum shrink-0">{usd(it.amount_usdc)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between border-t border-line-strong pt-2.5 text-[13.5px] font-semibold">
        <span>Amount due{inv.recurrence === 'monthly' ? ' each month' : ''}</span>
        <span className="tnum">{usd(inv.amount_usdc)}</span>
      </div>
      <Ledger inv={inv} />
    </div>
  );
}

export function Ledger({ inv }: { inv: Invoice }) {
  const { cfg } = useDues();
  if (inv.txs.length === 0) return null;
  return (
    <div className="mt-5">
      <div className="text-[12px] font-medium tracking-[0.04em] text-muted uppercase">Payment history</div>
      <ul className="mt-2 space-y-2.5">
        {inv.txs.map((t, i) => {
          const origin = t.kind === 'intent' || t.kind === 'refund' ? originUrl(cfg, t.origin_chain, t.origin_tx) : undefined;
          return (
            <li key={i} className="rounded-lg bg-sunken px-3 py-2.5 text-[13px]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">
                  {t.kind === 'intent' ? `Paid from ${chainName(t.origin_chain ?? '')} via NEAR Intents` : TX_KIND_LABEL[t.kind]}
                  {t.period ? ` · month ${t.period}` : ''}
                </span>
                <span className="tnum shrink-0">{t.kind === 'refund' ? '—' : usd(t.amount_usdc)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                <span>{day(t.ts)}</span>
                {t.hash ? <TxLink hash={t.hash} href={txUrl(cfg, t.hash)} label={`NEAR ${t.hash.slice(0, 6)}…`} /> : <span>NEAR tx pending</span>}
                {t.origin_tx && origin ? (
                  <TxLink hash={t.origin_tx} href={origin} label={`${chainName(t.origin_chain ?? '')} ${t.origin_tx.slice(0, 8)}…`} />
                ) : null}
                {BigInt(t.fee_usdc) > 0n ? <span>conversion cost {money(t.fee_usdc)} USDC, paid by the payer</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
