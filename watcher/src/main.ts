import path from 'node:path';
import { OneClick } from '@dues/core';
import { DuesView, accountWith, rpc } from '@dues/core/near';
import type { Account } from 'near-api-js';
import { loadConfig } from './config';
import { buildWatcherServer } from './http';
import { pullDueRetainers } from './scheduler';
import { FixtureSource, LiveSource, type StatusSource } from './sources';
import { Watcher } from './watcher';

const cfg = loadConfig();
const provider = rpc(cfg.rpcUrl);
const dues = new DuesView(cfg.contractId, provider);
const watcher = accountWith(cfg.watcherAccountId, provider, [cfg.watcherKey]);
const source: StatusSource = cfg.dry
  ? FixtureSource.fromFiles(
      path.join(cfg.fixturesDir, 'status-sequences.json'),
      path.join(cfg.fixturesDir, 'quote-dry.json'),
    )
  : new LiveSource(new OneClick({ jwt: cfg.oneClickJwt }));
const pullers = new Map<string, Account>(
  cfg.pullKeys.map(({ accountId, key }) => [accountId, accountWith(accountId, provider, [key])]),
);
const loop = new Watcher({
  dues,
  watcher,
  source,
  onEvent: (e) => console.log(new Date().toISOString(), JSON.stringify(e)),
});

const app = await buildWatcherServer({ dues, watcher, loop, source });
await app.listen({ port: cfg.port, host: cfg.host });
console.log(
  `watcher ${cfg.watcherAccountId} on ${cfg.network} (${source.kind} statuses) polling every ${cfg.pollMs} ms, http://${cfg.host}:${cfg.port}`,
);

let running = false;
setInterval(async () => {
  if (running) return;
  running = true;
  try {
    await loop.tick();
    await pullDueRetainers({ dues, watcher, pullers, onEvent: (e) => console.log(JSON.stringify(e)) });
  } catch (e) {
    console.error('tick failed:', (e as Error).message);
  } finally {
    running = false;
  }
}, cfg.pollMs);
