import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApi } from '../src/router';

describe('/api/mcp', () => {
  it('serves the read-only Dues tools over streamable HTTP, with no keys on the server', async () => {
    const api = await createApi({ network: 'testnet', contractId: 'dues.testnet', rpcUrl: 'http://127.0.0.1:1', siteUrl: 'https://sendues.vercel.app' });
    const http = createServer((req, res) => api.handle(req, res));
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    try {
      const client = new Client({ name: 'test', version: '0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`)));
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(['checkout_quote', 'get_invoice', 'invoices_csv', 'list_invoices', 'payment_link', 'payment_status']);
      const r = (await client.callTool({ name: 'payment_link', arguments: { to: 'someone.testnet', amount_usd: '5' } })) as {
        content: { text: string }[];
        isError?: boolean;
      };
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toMatch(/testnet account/);
      await client.close();

      const bad = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
      expect(bad.status).toBe(400);
    } finally {
      http.close();
      await api.close();
    }
  });
});
