// Builds both contracts with cargo-near (needed for near-sdk 5.x wasm builds).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const probe = spawnSync('cargo', ['near', '--version'], { encoding: 'utf8' });
if (probe.status !== 0) {
  console.error(
    'cargo-near is required to build the contracts.\n' +
      'Install it with: cargo install --locked cargo-near\n' +
      'and add the wasm target: rustup target add wasm32-unknown-unknown',
  );
  process.exit(1);
}
for (const crate of ['dues', 'mock-usdc']) {
  const cwd = path.join(root, 'contracts', crate);
  console.log(`building contracts/${crate} ...`);
  const r = spawnSync('cargo', ['near', 'build', 'non-reproducible-wasm', '--locked'], {
    cwd,
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(r.stderr);
    process.exit(r.status ?? 1);
  }
}
console.log('contracts built: contracts/target/near/{dues,mock_usdc}/*.wasm');
