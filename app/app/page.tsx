'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DuesCheckout } from '@dues/widget/react';
import { Header } from '@/components/header';
import { Mark } from '@/components/logo';
import { ButtonLink, Card, CopyButton, cx } from '@/components/ui';
import { networkLabel } from '@/lib/config';
import { usePageTheme } from '@/lib/theme';
import { useDues } from '@/lib/wallet';

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] font-medium tracking-[0.06em] text-accent uppercase">{children}</div>;
}

export default function Home() {
  const { cfg } = useDues();
  const theme = usePageTheme();
  const [origin, setOrigin] = useState('https://sendues.vercel.app');
  useEffect(() => setOrigin(window.location.origin), []);
  const demoTo = cfg.devAccounts?.find((a) => a.role === 'freelancer')?.id ?? (cfg.network === 'mainnet' ? 'you.near' : 'dues-freelancer.testnet');
  return (
    <>
      <Header />
      <main>
        {/* Hero: the button, live */}
        <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 pt-12 pb-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
          <div>
            <Eyebrow>Checkout on NEAR Intents</Eyebrow>
            <h1 className="mt-3 text-[40px] leading-[1.08] font-semibold tracking-[-0.025em] sm:text-[52px]">
              One checkout button. Any wallet, any chain.
            </h1>
            <p className="mt-4 max-w-[520px] text-[17px] leading-7 text-ink-2">
              Paste one tag and a Pay button appears. Your customer pays with whatever they hold: USDC on Base, SOL, ETH, USDT on
              Tron. You receive exactly the amount you asked for, in USDC on NEAR.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink href="/#embed">Add it to a site</ButtonLink>
              <ButtonLink href="/new/" variant="secondary">
                Send an invoice
              </ButtonLink>
            </div>
            <dl className="mt-10 grid max-w-[520px] grid-cols-3 gap-4 border-t border-line pt-6">
              {[
                ['Exact amount', 'EXACT_OUTPUT quotes: fees land on the payer'],
                ['No gas for sellers', 'a relayer pays, only for Dues calls'],
                ['Every claim linked', 'NEAR and origin-chain tx on each line'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[13px] font-semibold">{k}</dt>
                  <dd className="mt-1 text-[12.5px] leading-5 text-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="relative">
            <div className="rounded-2xl border border-line bg-sunken p-3 shadow-pop">
              <div className="mb-3 flex items-center gap-1.5 px-1">
                <span className="size-2.5 rounded-full bg-line-strong" />
                <span className="size-2.5 rounded-full bg-line-strong" />
                <span className="size-2.5 rounded-full bg-line-strong" />
                <span className="ml-3 h-6 flex-1 rounded-md bg-surface px-2 text-[11.5px] leading-6 text-faint">any-merchant.com/checkout</span>
              </div>
              <Card className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-[13px] text-muted">Order 1042 · Poster print, A2</div>
                    <div className="text-[13px] text-muted">Ships from Lagos</div>
                  </div>
                  <span className="rounded-md bg-chip px-2 py-1 text-[11px] text-muted">dry run</span>
                </div>
                <DuesCheckout amount="25" to={demoTo} memo="Order 1042" dry chain="base" token="USDC" theme={theme} />
              </Card>
            </div>
            <p className="mt-3 text-center text-[12px] text-muted">
              Live prices from NEAR Intents 1Click. Dry run: no deposit address is issued, nothing can be paid.{' '}
              <Link href="/pay/" className="font-medium text-accent hover:underline">
                Make a real payment link
              </Link>
            </p>
          </div>
        </section>

        {/* Embed */}
        <section id="embed" className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.15fr]">
            <div>
              <Eyebrow>Embed</Eyebrow>
              <h2 className="mt-3 text-[30px] leading-9 font-semibold tracking-[-0.02em]">Two lines on any page</h2>
              <p className="mt-3 max-w-[460px] text-[15px] leading-6 text-ink-2">
                A web component with no framework and no wallet SDK. It lists every chain and token 1Click supports, asks for an
                exact-output quote, shows the deposit address with a QR code and wallet links, and follows the payment until USDC
                lands on NEAR.
              </p>
              <ul className="mt-5 space-y-2 text-[13.5px] text-ink-2">
                <li>
                  <code className="font-mono text-[12.5px]">dues:paid</code> event and <code className="font-mono text-[12.5px]">onPaid</code> with
                  the NEAR and origin-chain hashes
                </li>
                <li>
                  <code className="font-mono text-[12.5px]">dry</code> attribute for live prices without a payable address
                </li>
                <li>Light and dark, inside a shadow root, so your CSS and ours never clash</li>
              </ul>
            </div>
            <div className="min-w-0 space-y-4">
              <Snippet
                title="HTML"
                code={`<script src="${origin}/widget.js"></script>\n<dues-checkout amount="25" to="you.near" memo="Order 1042"></dues-checkout>`}
              />
              <Snippet
                title="React"
                code={`import { DuesCheckout } from '@dues/widget/react';\n\n<DuesCheckout amount={25} to="you.near" onPaid={(p) => fulfil(p.nearTxHashes)} />`}
              />
            </div>
          </div>
        </section>

        {/* Invoices */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <Eyebrow>Built on it</Eyebrow>
          <h2 className="mt-3 max-w-[640px] text-[30px] leading-9 font-semibold tracking-[-0.02em]">
            Invoices and monthly retainers for freelancers paid from abroad
          </h2>
          <p className="mt-3 max-w-[620px] text-[15px] leading-6 text-ink-2">
            A designer in Lagos sends a client one link for a $1,500 monthly retainer. The client pays from whatever they hold. The
            designer gets USDC on NEAR and a CSV their accountant can read without questions.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              ['1', 'Create', 'Line items, due date, monthly or not. One wallet approval turns on gasless invoicing; after that the relayer pays every fee.'],
              ['2', 'Get paid', 'The client picks a chain and token, or pays USDC on NEAR directly, or prepays months into escrow released on each due date.'],
              ['3', 'Reconcile', 'Paid, pending, refunded, with the NEAR and origin-chain transaction on every line. Export CSV for the books.'],
            ].map(([n, t, d]) => (
              <Card key={n} className="p-6">
                <div className="inline-flex size-7 items-center justify-center rounded-md bg-accent-soft text-[13px] font-semibold text-accent">{n}</div>
                <h3 className="mt-3 text-[16px] font-semibold">{t}</h3>
                <p className="mt-1.5 text-[13.5px] leading-5 text-muted">{d}</p>
              </Card>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="/new/">Create an invoice</ButtonLink>
            <ButtonLink href="/dashboard/" variant="secondary">
              See invoices
            </ButtonLink>
          </div>
        </section>

        {/* Keys */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <Eyebrow>What each key can do</Eyebrow>
            <h2 className="mt-3 text-[30px] leading-9 font-semibold tracking-[-0.02em]">No key here can take your money</h2>
            <div className="mt-8 overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead className="bg-sunken text-[12px] text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Key</th>
                    <th className="px-4 py-2.5 font-medium">Held by</th>
                    <th className="px-4 py-2.5 font-medium">Can</th>
                    <th className="px-4 py-2.5 font-medium">Cannot</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[
                    ['Session key', "freelancer's browser", 'create_invoice, cancel on the Dues contract; zero deposit', 'move NEAR or USDC, call any other contract'],
                    ['Relayer keys (3)', 'Dues relayer', 'pay gas for delegate actions whose receiver is the Dues contract and method is create_invoice, cancel or storage_deposit', 'sponsor any other contract or method; refusals cost it nothing'],
                    ['Pull key', 'scheduler, granted by the client', 'call pull, which pays the agreed monthly amount to the named freelancer once it is due', 'withdraw escrow, cancel, transfer anything'],
                    ['Watcher', 'Dues watcher', 'mark an invoice paid or refunded after checking 1Click pays this freelancer, in USDC, in full', 'move any funds: 1Click pays the freelancer directly'],
                  ].map(([k, h, c, n]) => (
                    <tr key={k}>
                      <td className="px-4 py-3 font-medium">{k}</td>
                      <td className="px-4 py-3 text-muted">{h}</td>
                      <td className="px-4 py-3">{c}</td>
                      <td className="px-4 py-3 text-muted">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-8 text-[12.5px] text-muted sm:px-6">
            <span className="inline-flex items-center gap-2 text-ink">
              <Mark size={18} /> <b className="font-semibold">Dues</b>
            </span>
            <span>
              {networkLabel(cfg.network)} · <span className="font-mono">{cfg.contract}</span>
            </span>
            <a className="hover:text-ink" href="https://github.com/big14way/dues" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <span>MIT</span>
          </div>
        </footer>
      </main>
    </>
  );
}

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-canvas">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="text-[12px] font-medium text-muted">{title}</span>
        <CopyButton text={code} />
      </div>
      <pre className={cx('overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-5 text-ink-2')}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
