// pnpm mcp:smoke  -  starts `pnpm mcp` over stdio like an AI client would, and calls each read tool
// against dues.testnet, NEAR Intents 1Click and NEAR mainnet RPC. With DUES_ACCOUNT_ID and
// DUES_SESSION_KEY set it also creates an invoice through the deployed relayer (SMOKE_CREATE=1).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'dues-smoke', version: '0' });
await client.connect(
  new StdioClientTransport({ command: 'pnpm', args: ['--silent', 'start'], cwd: new URL('..', import.meta.url).pathname, env: { ...process.env } as Record<string, string>, stderr: 'inherit' }),
);
const tools = (await client.listTools()).tools.map((t) => t.name);
console.log('tools:', tools.join(', '));
let failed = 0;
const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  if (r.isError) failed++;
  console.log(`\n> ${name} ${JSON.stringify(args)}${r.isError ? '  (error)' : ''}\n${r.content[0]!.text.split('\n').slice(0, 14).join('\n')}`);
};
await call('get_invoice', { id: 2 });
await call('list_invoices', { account: 'dues-freelancer.testnet' });
await call('payment_status', { deposit_address: '0x2f25C083AB2f358eFC836A2D6B11733DB1d5f29D' });
await call('payment_link', { to: 'godswillidolor.near', amount_usd: '2', memo: 'Order 1042' });
await call('checkout_quote', { to: 'dues-freelancer.testnet', amount_usd: '25', pay_chain: 'sol', pay_token: 'USDC' });
if (process.env.SMOKE_CREATE === '1' && tools.includes('create_invoice')) {
  await call('create_invoice', {
    title: process.env.SMOKE_TITLE ?? 'Invoice created by an AI agent over MCP',
    amount_usd: '5',
    due_date: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
    client: 'dues-client.testnet',
    items: [{ description: 'Copy edits, one round', amount_usd: '5' }],
  });
}
await client.close();
console.log(failed ? `\n${failed} call(s) failed` : '\nall calls answered');
process.exit(failed ? 1 : 0);
