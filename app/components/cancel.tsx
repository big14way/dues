'use client';
import { useState } from 'react';
import type { Invoice } from '@dues/core';
import { txUrl } from '@/lib/config';
import { useSession } from '@/lib/use-session';
import { describeFailure, useDues } from '@/lib/wallet';
import { Button, Notice, TxLink } from './ui';

/** Freelancer cancels a pending invoice: two-step, relayed, no gas. */
export function CancelInvoice({ inv, onDone, compact }: { inv: Invoice; onDone?(): void; compact?: boolean }) {
  const { cfg } = useDues();
  const { state, run } = useSession();
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy'>('idle');
  const [err, setErr] = useState('');
  const [hash, setHash] = useState('');
  if (inv.status !== 'pending' || inv.retainer) return null;
  if (hash) return <span className="text-[12.5px] text-muted">Cancelled <TxLink hash={hash} href={txUrl(cfg, hash)} /></span>;
  if (state !== 'ready') {
    return compact ? null : <p className="text-[12.5px] text-muted">Turn on gasless invoicing (New invoice page) to cancel from here.</p>;
  }
  const go = async () => {
    setStep('busy');
    setErr('');
    try {
      const r = await run('cancel', { id: inv.id });
      setHash(r.hash);
      onDone?.();
    } catch (e) {
      setErr(describeFailure(e));
      setStep('idle');
    }
  };
  if (step === 'idle') {
    return (
      <div>
        <Button variant={compact ? 'ghost' : 'danger'} size="sm" onClick={() => setStep('confirm')}>
          Cancel invoice
        </Button>
        {err ? <div className="mt-2"><Notice tone="bad">{err}</Notice></div> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12.5px] text-bad">Cancel #{inv.id}? It can no longer be paid.</span>
      <Button size="sm" variant="ghost" onClick={() => setStep('idle')} disabled={step === 'busy'}>
        Keep
      </Button>
      <Button size="sm" variant="danger" onClick={go} busy={step === 'busy'}>
        Cancel it
      </Button>
    </div>
  );
}
