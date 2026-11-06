'use client';
import { useCallback, useEffect, useState } from 'react';
import type { RelayResult } from '@dues/core/near';
import { SESSION_ALLOWANCE, SESSION_METHODS, newSession, relayed, sessionOnChain, storedSession, type Session } from './session';
import { useDues } from './wallet';

export type SessionState = 'signed-out' | 'checking' | 'missing' | 'ready';

/** The signed-in freelancer's gasless session key: whether it is on-chain, how to add it, how to use it. */
export function useSession() {
  const { cfg, provider, accountId, addKey } = useDues();
  const [state, setState] = useState<SessionState>('checking');
  const [session, setSession] = useState<Session | null>(null);
  const [addedHash, setAddedHash] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!accountId) {
      setState('signed-out');
      setSession(null);
      return;
    }
    setState('checking');
    const s = storedSession(cfg, accountId);
    if (!s) {
      setState('missing');
      return;
    }
    void sessionOnChain(provider, cfg, accountId, s.publicKey).then((ok) => {
      if (!live) return;
      setSession(ok ? s : null);
      setState(ok ? 'ready' : 'missing');
    });
    return () => {
      live = false;
    };
  }, [accountId, cfg, provider]);

  const enable = useCallback(async () => {
    if (!accountId) throw new Error('sign in first');
    const s = storedSession(cfg, accountId) ?? newSession(cfg, accountId);
    const hash = await addKey(s.publicKey, cfg.contract, [...SESSION_METHODS], SESSION_ALLOWANCE);
    for (let i = 0; i < 20; i++) {
      if (await sessionOnChain(provider, cfg, accountId, s.publicKey)) {
        setSession(s);
        setState('ready');
        setAddedHash(hash);
        return hash;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('the key did not appear on your account; try again');
  }, [accountId, addKey, cfg, provider]);

  const run = useCallback(
    (method: (typeof SESSION_METHODS)[number], args: Record<string, unknown>): Promise<RelayResult> => {
      if (!accountId || !session) throw new Error('gasless invoicing is not turned on');
      return relayed(cfg, provider, accountId, session, method, args);
    },
    [accountId, cfg, provider, session],
  );

  return { state, session, enable, run, addedHash };
}
