// Bundles <dues-checkout> into one self-registering file: dist/widget.js
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist', 'widget.js');
await build({
  entryPoints: [path.join(here, 'src', 'widget.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  outfile: out,
});
// The app serves the same file at /widget.js for the embed snippet.
const appPublic = path.join(here, '..', '..', 'app', 'public');
mkdirSync(appPublic, { recursive: true });
copyFileSync(out, path.join(appPublic, 'widget.js'));
console.log(`dist/widget.js ${(statSync(out).size / 1024).toFixed(1)} KB (copied to app/public/widget.js)`);
