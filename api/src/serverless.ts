// Vercel function: GET/POST /api/* (rewritten to /api/dues?path=*). Env: see .env.example.
// Serverless has no background loop, so the watcher settles a deposit address when its
// status is read, and Vercel Cron calls /api/cron/pull once a day for retainers.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApi, type Api } from './router';
import { optionsFromEnv } from './env';

let ready: Promise<Api> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  ready ??= createApi({ ...optionsFromEnv(), settleOnRead: true });
  try {
    (await ready).handle(req, res);
  } catch (e) {
    ready = null;
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}
