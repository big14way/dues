// pnpm mcp  -  Dues MCP server over stdio, for Claude Code, Claude Desktop or any MCP client.
//   claude mcp add dues -- pnpm --silent --dir /path/to/dues mcp
// Env (all optional): DUES_NETWORK (testnet), DUES_CONTRACT (dues.testnet), NEAR_RPC_URL,
// DUES_SITE (https://sendues.vercel.app), DUES_API_BASE (<site>/api).
// DUES_ACCOUNT_ID + DUES_SESSION_KEY add create_invoice and cancel_invoice: the key must be a
// function-call key on that account limited to create_invoice and cancel on the Dues contract.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_RPC, type NetworkId } from '@dues/core';
import { createDuesMcp } from './server';

const env = process.env;
const network = (env.DUES_NETWORK ?? 'testnet') as NetworkId;
const contractId = env.DUES_CONTRACT || (network === 'testnet' ? 'dues.testnet' : '');
if (!contractId) {
  console.error('Set DUES_CONTRACT: there is no default Dues contract on mainnet.');
  process.exit(1);
}
const siteUrl = env.DUES_SITE ?? 'https://sendues.vercel.app';
const agent = env.DUES_ACCOUNT_ID && env.DUES_SESSION_KEY ? { accountId: env.DUES_ACCOUNT_ID, key: env.DUES_SESSION_KEY } : undefined;

const server = createDuesMcp({
  network,
  contractId,
  rpcUrl: env.NEAR_RPC_URL ?? (network === 'testnet' ? 'https://test.rpc.fastnear.com' : DEFAULT_RPC.mainnet),
  siteUrl,
  apiBase: env.DUES_API_BASE ?? `${siteUrl}/api`,
  agent,
});
await server.connect(new StdioServerTransport());
console.error(`dues mcp: ${contractId} on ${network}${agent ? `, writing as ${agent.accountId}` : ', read-only'}`);
