import { describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ConfigError, optionsFromEnv } from '../src/env';

describe('api configuration', () => {
  it('runs read-only on testnet with no env at all: recorded contract, no relayer, no watcher', () => {
    const o = optionsFromEnv({});
    expect(o.network).toBe('testnet');
    expect(o.contractId).toBe('dues.testnet');
    expect(o.relayer).toBeUndefined();
    expect(o.watcher).toBeUndefined();
  });

  it('never guesses a mainnet contract', () => {
    expect(() => optionsFromEnv({ NEAR_NETWORK: 'mainnet' })).toThrow(ConfigError);
    expect(optionsFromEnv({ NEAR_NETWORK: 'mainnet', DUES_CONTRACT: 'x.near' }).contractId).toBe('x.near');
  });

  it('a misconfigured deployment answers 503 with a reason instead of crashing', async () => {
    const saved = { ...process.env };
    process.env.NEAR_NETWORK = 'mainnet';
    delete process.env.DUES_CONTRACT;
    try {
      const { default: handler } = await import('../src/serverless');
      const out: { status?: number; body?: string } = {};
      const res = {
        statusCode: 200,
        setHeader() {},
        end(body: string) {
          out.status = this.statusCode;
          out.body = body;
        },
      } as unknown as ServerResponse;
      await handler({ url: '/api/health', method: 'GET', headers: {} } as IncomingMessage, res);
      expect(out.status).toBe(503);
      expect(JSON.parse(out.body!).error).toMatch(/DUES_CONTRACT/);
    } finally {
      process.env = saved;
    }
  });
});
