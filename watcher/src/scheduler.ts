import { callWithHash, type DuesView } from '@dues/core/near';
import type { Account } from 'near-api-js';

export type PullEvent =
  | { type: 'pulled'; invoiceId: number; hash: string; period: number; by: string }
  | { type: 'pull_failed'; invoiceId: number; error: string };

/**
 * Runs `pull` for every retainer month that is due. Each client can grant a
 * function-call key limited to `pull` on the Dues contract; when we hold one
 * for the invoice's client the call is signed with it (the client's account
 * pays the gas from the key's allowance). Otherwise the watcher calls it,
 * since `pull` is open to anyone. The watcher then records the NEAR hash on
 * the invoice with `annotate_tx`.
 */
export async function pullDueRetainers(deps: {
  dues: DuesView;
  watcher: Account;
  pullers: Map<string, Account>;
  onEvent?: (e: PullEvent) => void;
}): Promise<PullEvent[]> {
  const events: PullEvent[] = [];
  const contractId = deps.dues.contractId;
  for (const inv of await deps.dues.dueRetainers()) {
    const signer = (inv.client && deps.pullers.get(inv.client)) || deps.watcher;
    try {
      const { hash } = await callWithHash(signer, contractId, 'pull', { id: inv.id }, { gasTera: 60 });
      const fresh = await deps.dues.invoice(inv.id);
      const index = fresh?.txs.findLastIndex((t) => t.kind === 'pull' && !t.hash) ?? -1;
      if (index >= 0) {
        await callWithHash(deps.watcher, contractId, 'annotate_tx', { id: inv.id, index, hash });
      }
      const e: PullEvent = {
        type: 'pulled',
        invoiceId: inv.id,
        hash,
        period: fresh?.txs[index]?.period ?? fresh?.periods_paid ?? 0,
        by: signer === deps.watcher ? 'watcher' : `${signer.accountId} (pull-only key)`,
      };
      events.push(e);
      deps.onEvent?.(e);
    } catch (err) {
      const e: PullEvent = { type: 'pull_failed', invoiceId: inv.id, error: (err as Error).message };
      events.push(e);
      deps.onEvent?.(e);
    }
  }
  return events;
}
