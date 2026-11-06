'use client';
import Link from 'next/link';
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Tone } from '@/lib/format';
import { short } from '@/lib/format';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'primary',
  size = 'md',
  busy,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' && 'h-8 px-3 text-[13px]',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-11 px-5 text-[15px]',
        variant === 'primary' && 'bg-accent text-accent-ink hover:bg-accent-hover',
        variant === 'secondary' && 'border border-line-strong bg-surface text-ink hover:bg-sunken',
        variant === 'ghost' && 'text-ink-2 hover:bg-sunken',
        variant === 'danger' && 'border border-line-strong bg-surface text-bad hover:bg-bad-bg',
        className,
      )}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant = 'primary', children, className }: { href: string; variant?: Variant; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cx(
        'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        variant === 'primary' && 'bg-accent text-accent-ink hover:bg-accent-hover',
        variant === 'secondary' && 'border border-line-strong bg-surface text-ink hover:bg-sunken',
        variant === 'ghost' && 'text-ink-2 hover:bg-sunken',
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Spinner() {
  return <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-xl bg-surface shadow-card ring-1 ring-line/60', className)}>{children}</section>;
}

const TONES: Record<Tone, string> = {
  good: 'bg-good-bg text-good',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
  info: 'bg-info-bg text-info',
  neutral: 'bg-chip text-ink-2',
};

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex h-[22px] items-center gap-1.5 rounded-md px-2 text-[12px] font-medium whitespace-nowrap', TONES[tone])}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

export function TxLink({ hash, href, label }: { hash: string; href?: string; label?: string }) {
  const text = label ?? short(hash);
  if (!href) return <span className="font-mono text-[12px] text-muted">{text}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-mono text-[12px] text-accent hover:underline">
      {text}
      <span aria-hidden> ↗</span>
    </a>
  );
}

export function Notice({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <div className={cx('rounded-lg px-3 py-2.5 text-[13px] leading-5', TONES[tone])}>{children}</div>;
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1.5 text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

export const inputClass =
  'h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-faint shadow-[0_1px_1px_rgba(16,24,40,0.04)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? 'Copied' : label}
    </Button>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />;
}

export function KeyValue({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] gap-3 py-1 text-[13px] leading-5">
      <dt className="text-muted">{k}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}
