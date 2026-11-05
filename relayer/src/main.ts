import { accountWith, rpc } from '@dues/core/near';
import { loadConfig } from './config';
import { defaultPolicy } from './policy';
import { buildServer } from './server';

const cfg = loadConfig();
const provider = rpc(cfg.rpcUrl);
const relayer = accountWith(cfg.relayerAccountId, provider, cfg.relayerKeys);
const app = await buildServer({
  relayer,
  provider,
  policy: defaultPolicy(cfg.contractId),
  corsOrigin: cfg.corsOrigin,
  logger: true,
});
await app.listen({ port: cfg.port, host: cfg.host });
console.log(
  `relayer ${cfg.relayerAccountId} (${cfg.relayerKeys.length} key${cfg.relayerKeys.length > 1 ? 's' : ''}) ` +
    `sponsors ${cfg.contractId} on ${cfg.network} at http://${cfg.host}:${cfg.port}/relay`,
);
