'use client';
// Config + wallet in one provider.
//  - testnet / mainnet: NEAR Wallet Selector (core only; Meteor and Intear). MyNearWallet is left
//    out: it stopped app connections on 1 Nov 2026.
//  - sandbox: the dev accounts `pnpm sandbox` wrote to /dues-config.json sign directly. Those keys
//    exist only on the local chain.
import { actionCreators, setupWalletSelector, type WalletSelector } from '@near-wallet-selector/core';
import { setupIntearWallet } from '@near-wallet-selector/intear-wallet';
import { setupMeteorWallet } from '@near-wallet-selector/meteor-wallet';
import { PublicKey } from '@near-js/crypto';
import { Account, JsonRpcProvider, actions, type KeyPairString } from 'near-api-js';
import { DuesView } from '@dues/core/near';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadConfig, type DuesConfig } from './config';

export interface WalletOption {
  id: string;
  name: string;
  iconUrl?: string;
  note?: string;
}

export interface Call {
  method: string;
  args: Record<string, unknown>;
  gas?: bigint;
  deposit?: bigint;
}

interface Ctx {
  cfg: DuesConfig;
  provider: JsonRpcProvider;
  view: DuesView;
  ready: boolean;
  dev: boolean;
  accountId: string | null;
  options: WalletOption[];
  signIn(walletId: string): Promise<void>;
  signOut(): Promise<void>;
  /** A transaction the user signs in their wallet (they pay its gas). Resolves to the tx hash. */
  call(receiverId: string, calls: Call[]): Promise<string | null>;
  /** Adds a function-call key to the signed-in account. */
  addKey(publicKey: string, receiverId: string, methodNames: string[], allowance: bigint): Promise<string | null>;
}

const WalletContext = createContext<Ctx | null>(null);
const DEV_KEY = 'dues:dev-account';
const TGAS = 1_000_000_000_000n;

function readDev(): string | null {
  try {
    return localStorage.getItem(DEV_KEY);
  } catch {
    return null;
  }
}

export function describeFailure(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);
  const m = /Smart contract panicked: ([^"\\]+)/.exec(raw) ?? /"ExecutionError":"([^"]+)"/.exec(raw);
  return (m?.[1] ?? raw).slice(0, 240);
}

export function Providers({ children }: { children: ReactNode }) {
  const [cfg, setCfg] = useState<DuesConfig | null>(null);
  useEffect(() => {
    void loadConfig().then(setCfg);
  }, []);
  if (!cfg) return <div className="min-h-screen bg-canvas" aria-busy="true" />;
  return <WalletProvider cfg={cfg}>{children}</WalletProvider>;
}

function WalletProvider({ cfg, children }: { cfg: DuesConfig; children: ReactNode }) {
  const provider = useMemo(() => new JsonRpcProvider({ url: cfg.rpcUrl }), [cfg.rpcUrl]);
  const view = useMemo(() => new DuesView(cfg.contract, provider), [cfg.contract, provider]);
  const dev = Boolean(cfg.devAccounts?.length);
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [options, setOptions] = useState<WalletOption[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (dev) {
      const saved = readDev();
      setAccountId(cfg.devAccounts!.some((a) => a.id === saved) ? saved : null);
      setOptions(cfg.devAccounts!.map((a) => ({ id: a.id, name: a.id, note: `sandbox ${a.role}` })));
      setReady(true);
      return;
    }
    if (cfg.network === 'sandbox') {
      setReady(true);
      return;
    }
    let sub: { unsubscribe(): void } | undefined;
    let cancelled = false;
    void setupWalletSelector({ network: cfg.network, modules: [setupMeteorWallet(), setupIntearWallet()] }).then((s) => {
      if (cancelled) return;
      setSelector(s);
      const sync = () => {
        const state = s.store.getState();
        setAccountId(state.accounts.find((a) => a.active)?.accountId ?? null);
        setOptions(state.modules.map((m) => ({ id: m.id, name: m.metadata.name, iconUrl: m.metadata.iconUrl })));
      };
      sync();
      sub = s.store.observable.subscribe(sync);
      setReady(true);
    });
    return () => {
      cancelled = true;
      sub?.unsubscribe();
    };
  }, [cfg, dev]);

  const devAccount = useCallback(() => {
    const a = cfg.devAccounts?.find((x) => x.id === accountId);
    if (!a) throw new Error('not signed in');
    return new Account(a.id, provider, a.key as KeyPairString);
  }, [cfg.devAccounts, accountId, provider]);

  const signIn = useCallback(
    async (walletId: string) => {
      if (dev) {
        try {
          localStorage.setItem(DEV_KEY, walletId);
        } catch {
          /* private mode: session-only */
        }
        setAccountId(walletId);
        return;
      }
      if (!selector) return;
      const wallet = await selector.wallet(walletId);
      await wallet.signIn({ contractId: cfg.contract, methodNames: [] } as never);
    },
    [dev, selector, cfg.contract],
  );

  const signOut = useCallback(async () => {
    if (dev) {
      try {
        localStorage.removeItem(DEV_KEY);
      } catch {
        /* ignore */
      }
      setAccountId(null);
      return;
    }
    if (!selector) return;
    await (await selector.wallet()).signOut();
    setAccountId(null);
  }, [dev, selector]);

  const call = useCallback(
    async (receiverId: string, calls: Call[]) => {
      if (dev) {
        try {
          const res = await devAccount().signAndSendTransaction({
            receiverId,
            actions: calls.map((c) => actions.functionCall(c.method, c.args, c.gas ?? 30n * TGAS, c.deposit ?? 0n)),
          });
          return res.transaction.hash;
        } catch (e) {
          throw new Error(describeFailure(e));
        }
      }
      if (!selector) throw new Error('wallet not ready');
      const wallet = await selector.wallet();
      const outcome = await wallet.signAndSendTransaction({
        receiverId,
        actions: calls.map((c) => actionCreators.functionCall(c.method, c.args, c.gas ?? 30n * TGAS, c.deposit ?? 0n)),
      });
      if (!outcome) return null;
      const failure = (outcome.status as { Failure?: unknown }).Failure;
      if (failure) throw new Error(describeFailure(JSON.stringify(failure)));
      return outcome.transaction_outcome?.id ?? outcome.transaction?.hash ?? null;
    },
    [dev, devAccount, selector],
  );

  const addKey = useCallback(
    async (publicKey: string, receiverId: string, methodNames: string[], allowance: bigint) => {
      if (dev) {
        const res = await devAccount().addFunctionCallAccessKey({ publicKey, contractId: receiverId, methodNames, allowance });
        return res.transaction.hash;
      }
      if (!selector || !accountId) throw new Error('wallet not ready');
      const wallet = await selector.wallet();
      const outcome = await wallet.signAndSendTransaction({
        receiverId: accountId,
        actions: [
          actionCreators.addKey(
            PublicKey.fromString(publicKey) as never,
            actionCreators.functionCallAccessKey(receiverId, methodNames, allowance),
          ),
        ],
      });
      if (!outcome) return null;
      const failure = (outcome.status as { Failure?: unknown }).Failure;
      if (failure) throw new Error(describeFailure(JSON.stringify(failure)));
      return outcome.transaction_outcome?.id ?? null;
    },
    [dev, devAccount, selector, accountId],
  );

  const value: Ctx = { cfg, provider, view, ready, dev, accountId, options, signIn, signOut, call, addKey };
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useDues(): Ctx {
  const v = useContext(WalletContext);
  if (!v) throw new Error('useDues outside Providers');
  return v;
}
