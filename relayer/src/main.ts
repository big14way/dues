import { DuesView, accountWith, rpc } from '@dues/core/near';
import { loadConfig } from './config';
import { defaultPolicy } from './policy';
import { buildServer } from './server';

const cfg = loadConfig();
const provider = rpc(cfg.rpcUrl);
const relayer = accountWith(cfg.relayerAccountId, provider, cfg.relayerKeys);
const { usdc_id: usdcId } = await new DuesView(cfg.contractId, provider).config();
const app = await buildServer({
  usdcId,
  relayer,
  provider,
  policy: defaultPolicy(cfg.contractId),
  corsOrigin: cfg.corsOrigin,
  logger: true,
});
await app.listen({ port: cfg.port, host: cfg.host });
console.log(
  `relayer ${cfg.relayerAccountId} (${cfg.relayerKeys.length} key${cfg.relayerKeys.length > 1 ? 's' : ''}) ` +
    `sponsors ${cfg.contractId} (and USDC registration on ${usdcId}) on ${cfg.network} at http://${cfg.host}:${cfg.port}/relay`,
);
