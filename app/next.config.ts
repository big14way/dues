import { createRequire } from 'node:module';
import path from 'node:path';
import type { NextConfig } from 'next';

const require = createRequire(import.meta.url);

// Static export: plain HTML + JS that reads the Dues contract over RPC, signs with the wallet or a
// browser session key, and calls the API under /api (relayer, watcher) for gasless writes.
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },
  transpilePackages: ['@dues/core', '@dues/widget'],
  webpack(cfg, { isServer }) {
    // near-api-js 6 can reach a file-system keystore it never uses in a browser.
    if (!isServer) cfg.resolve.fallback = { ...cfg.resolve.fallback, fs: false };
    // The Meteor wallet SDK still imports `utils` from near-api-js 6; Dues uses 7.4 for
    // meta-transactions. Resolve near-api-js to 6.5.1 for the SDK's own files only.
    cfg.module.rules.push({
      test: /[\\/]@meteorwallet[\\/]sdk[\\/]/,
      resolve: { alias: { 'near-api-js$': path.dirname(require.resolve('near-api-js-6/package.json')) } },
    });
    return cfg;
  },
};

export default config;
