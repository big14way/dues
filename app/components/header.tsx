'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { networkLabel } from '@/lib/config';
import { useDues } from '@/lib/wallet';
import { Avatar } from './avatar';
import { Wordmark } from './logo';
import { Button, cx } from './ui';

const NAV = [
  { href: '/#embed', label: 'Checkout button' },
  { href: '/pay/', label: 'Payment link' },
  { href: '/new/', label: 'New invoice' },
  { href: '/dashboard/', label: 'Invoices' },
];

export function Header() {
  const path = usePathname();
  const { cfg } = useDues();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="shrink-0" aria-label="Dues home">
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                'rounded-md px-2.5 py-1.5 text-[13.5px] text-muted hover:bg-sunken hover:text-ink',
                path === n.href && 'text-ink',
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span
            className="hidden h-6 items-center rounded-md border border-line px-2 text-[12px] text-muted sm:inline-flex"
            title={`Contract ${cfg.contract}`}
          >
            {networkLabel(cfg.network)}
          </span>
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

export function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem('dues-theme', next);
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-ink"
      aria-label="Toggle dark mode"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    </button>
  );
}

export function AccountMenu({ align = 'right' }: { align?: 'left' | 'right' }) {
  const { accountId, options, signIn, signOut, ready, dev } = useDues();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="relative" ref={ref}>
      {accountId ? (
        <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="size-2 rounded-full bg-good" aria-hidden />
          <span className="max-w-[160px] truncate">{accountId}</span>
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen((o) => !o)} disabled={!ready} aria-expanded={open}>
          Sign in
        </Button>
      )}
      {open ? (
        <div
          className={cx(
            'absolute top-10 z-40 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-pop',
            align === 'right' ? 'right-0' : 'left-0',
          )}
          role="menu"
        >
          {accountId ? (
            <>
              <div className="px-2.5 py-2 text-[12px] text-muted">Signed in as</div>
              <div className="truncate px-2.5 pb-2 text-[13px] font-medium">{accountId}</div>
              <Link href="/dashboard/" className="block rounded-md px-2.5 py-2 text-[13px] hover:bg-sunken" onClick={() => setOpen(false)}>
                Your invoices
              </Link>
              <button
                type="button"
                className="block w-full rounded-md px-2.5 py-2 text-left text-[13px] text-bad hover:bg-sunken"
                onClick={() => {
                  setOpen(false);
                  void signOut();
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <div className="px-2.5 py-2 text-[12px] text-muted">{dev ? 'Sandbox accounts (local keys)' : 'Sign in with a NEAR wallet'}</div>
              {options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-sunken"
                  onClick={() => {
                    setOpen(false);
                    void signIn(o.id);
                  }}
                >
                  {o.iconUrl ? <img src={o.iconUrl} alt="" className="size-5 rounded" /> : <Avatar account={o.id} size={20} />}
                  <span className="flex-1">{o.name}</span>
                  {o.note ? <span className="text-[11px] text-muted">{o.note}</span> : null}
                </button>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
