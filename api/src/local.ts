// pnpm api  -  the app's API on one port (default 3031): /api/relayer, /api/watcher, /api/cron/pull.
// Polls 1Click for open deposit addresses and runs the retainer scheduler every minute.
import { createServer } from 'node:http';
import { createApi } from './router';
import { optionsFromEnv } from './env';

const opts = optionsFromEnv();
const api = await createApi({ ...opts, onEvent: (e) => console.log(new Date().toISOString(), JSON.stringify(e)) });
const port = Number(process.env.API_PORT ?? 3031);
createServer(api.handle).listen(port, '127.0.0.1', () => {
  console.log(`dues api for ${opts.contractId} on ${opts.network}: http://127.0.0.1:${port}/api/health`);
  console.log(`  relayer ${opts.relayer?.accountId ?? '(not configured)'}  watcher ${opts.watcher?.accountId ?? '(not configured)'}`);
});
let busy = false;
setInterval(async () => {
  if (busy || !api.loop) return;
  busy = true;
  try {
    await api.loop.tick();
  } catch (e) {
    console.error('watcher tick failed:', (e as Error).message);
  } finally {
    busy = false;
  }
}, Number(process.env.WATCHER_POLL_MS ?? 5000));
setInterval(() => void api.pull().catch((e: Error) => console.error('pull failed:', e.message)), 60_000);
