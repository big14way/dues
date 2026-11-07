// One HTTP surface for the app: the relayer under /api/relayer, the watcher under /api/watcher,
// the retainer scheduler under /api/cron/pull, and a read-only MCP server for AI agents under
// /api/mcp (streamable HTTP, stateless). Used by `pnpm api`, `pnpm sandbox` and the
// Vercel function. A part without keys answers 503, so the site still works read-only.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import type { NetworkId } from '@dues/core';
import { DuesView, accountWith, rpc } from '@dues/core/near';
import { buildServer, defaultPolicy } from '@dues/relayer';
import { OneClick } from '@dues/core';
import { LiveSource, Watcher, buildWatcherServer, pullDueRetainers, type StatusSource, type WatcherEvent, type PullEvent } from '@dues/watcher';
import type { Account } from 'near-api-js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createDuesMcp } from '@dues/mcp';

export interface ApiOptions {
  network: NetworkId;
  rpcUrl: string;
  contractId: string;
  relayer?: { accountId: string; keys: string[] };
  watcher?: { accountId: string; key: string };
  /** Where 1Click statuses come from. Defaults to the live API. */
  source?: StatusSource;
  oneClickJwt?: string;
  /** No background loop (serverless): GET /status settles the address it is asked about. */
  settleOnRead?: boolean;
  /** Bearer token Vercel Cron sends; when set, /api/cron/pull requires it. */
  cronSecret?: string;
  /** Pull-only keys clients granted: account -> key. */
  pullKeys?: { accountId: string; key: string }[];
  corsOrigin?: string | boolean;
  /** Public site, for links in MCP answers. Defaults to https://<request host>. */
  siteUrl?: string;
  /** Sandbox only: extra routes such as moving the chain clock. */
  dev?: { advanceDays(days: number): Promise<void> };
  onEvent?: (e: WatcherEvent | PullEvent) => void;
}

export interface Api {
  handle(req: IncomingMessage, res: ServerResponse): void;
  loop?: Watcher;
  /** Runs the retainer scheduler once. */
  pull(): Promise<PullEvent[]>;
  close(): Promise<void>;
}

function send(res: ServerResponse, status: number, body: unknown, origin: string | boolean | undefined) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  if (origin !== false) res.setHeader('access-control-allow-origin', typeof origin === 'string' ? origin : '*');
  res.end(JSON.stringify(body));
}

export async function createApi(opts: ApiOptions): Promise<Api> {
  const provider = rpc(opts.rpcUrl);
  const dues = new DuesView(opts.contractId, provider);
  const corsOrigin = opts.corsOrigin ?? true;
  let relayerApp: FastifyInstance | undefined;
  let watcherApp: FastifyInstance | undefined;
  let loop: Watcher | undefined;
  let watcher: Account | undefined;

  if (opts.relayer) {
    const { usdc_id } = await dues.config();
    relayerApp = await buildServer({
      relayer: accountWith(opts.relayer.accountId, provider, opts.relayer.keys),
      provider,
      policy: defaultPolicy(opts.contractId),
      usdcId: usdc_id,
      corsOrigin,
    });
    await relayerApp.ready();
  }
  if (opts.watcher) {
    watcher = accountWith(opts.watcher.accountId, provider, [opts.watcher.key]);
    const source = opts.source ?? new LiveSource(new OneClick({ jwt: opts.oneClickJwt }));
    loop = new Watcher({ dues, watcher, source, onEvent: opts.onEvent });
    watcherApp = await buildWatcherServer({ dues, watcher, loop, source, corsOrigin, settleOnRead: opts.settleOnRead });
    await watcherApp.ready();
  }
  const pullers = new Map(
    (opts.pullKeys ?? []).map(({ accountId, key }) => [accountId, accountWith(accountId, provider, [key])] as const),
  );
  const pull = async (): Promise<PullEvent[]> =>
    watcher ? pullDueRetainers({ dues, watcher, pullers, onEvent: opts.onEvent }) : [];

  // Read-only MCP: no agent keys on the server, so only the read tools are offered.
  const serveMcp = async (req: IncomingMessage, res: ServerResponse) => {
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    const siteUrl = opts.siteUrl ?? (host ? `https://${String(host).split(',')[0]}` : 'https://sendues.vercel.app');
    const server = createDuesMcp({ network: opts.network, contractId: opts.contractId, rpcUrl: opts.rpcUrl, siteUrl });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-expose-headers', 'mcp-session-id, mcp-protocol-version');
    let body: unknown;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
      } catch {
        return send(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }, corsOrigin);
      }
    }
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };

  const forward = (app: FastifyInstance | undefined, name: string, req: IncomingMessage, res: ServerResponse, rest: string) => {
    if (!app) return send(res, 503, { error: `${name} is not configured on this deployment` }, corsOrigin);
    req.url = rest || '/';
    app.server.emit('request', req, res);
  };

  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const u = new URL(req.url ?? '/', 'http://local');
    // Vercel rewrites /api/<path> to /api/dues?path=<path>; plain servers keep /api/<path>.
    const routed = u.searchParams.get('path');
    if (routed !== null) {
      u.searchParams.delete('path');
      u.pathname = `/api/${routed}`;
    }
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const tail = (prefix: string) => `${path.slice(prefix.length) || '/'}${u.search}`;
    if (req.method === 'OPTIONS' && !path.startsWith('/api/relayer') && !path.startsWith('/api/watcher')) {
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', 'content-type, authorization, mcp-session-id, mcp-protocol-version, last-event-id');
      res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
      res.statusCode = 204;
      return res.end();
    }
    if (path.startsWith('/api/relayer')) return forward(relayerApp, 'the relayer', req, res, tail('/api/relayer'));
    if (path.startsWith('/api/watcher')) return forward(watcherApp, 'the watcher', req, res, tail('/api/watcher'));
    if (path === '/api/mcp') {
      void serveMcp(req, res).catch((e: Error) => {
        if (!res.headersSent) send(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: e.message }, id: null }, corsOrigin);
      });
      return;
    }
    if (path === '/api/health') {
      return send(
        res,
        200,
        {
          ok: true,
          network: opts.network,
          contract: opts.contractId,
          relayer: opts.relayer?.accountId ?? null,
          watcher: opts.watcher?.accountId ?? null,
          oneClick: loop ? (opts.source?.kind ?? 'live') : null,
        },
        corsOrigin,
      );
    }
    if (path === '/api/cron/pull') {
      if (opts.cronSecret && req.headers.authorization !== `Bearer ${opts.cronSecret}`) {
        return send(res, 401, { error: 'unauthorized' }, corsOrigin);
      }
      if (!watcher) return send(res, 503, { error: 'the watcher is not configured on this deployment' }, corsOrigin);
      void pull().then(
        (events) => send(res, 200, { ok: true, events }, corsOrigin),
        (e: Error) => send(res, 500, { error: e.message }, corsOrigin),
      );
      return;
    }
    if (path === '/api/dev/advance' && opts.dev && req.method === 'POST') {
      const days = Math.min(62, Math.max(1, Number(u.searchParams.get('days') ?? 1)));
      void opts.dev
        .advanceDays(days)
        .then(() => pull())
        .then(
          (events) => send(res, 200, { ok: true, days, events }, corsOrigin),
          (e: Error) => send(res, 500, { error: e.message }, corsOrigin),
        );
      return;
    }
    send(res, 404, { error: `no route ${path}` }, corsOrigin);
  };

  return {
    handle,
    loop,
    pull,
    close: async () => {
      await relayerApp?.close();
      await watcherApp?.close();
    },
  };
}
