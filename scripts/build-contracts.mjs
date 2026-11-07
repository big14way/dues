// Builds both contracts with cargo-near (needed for near-sdk 5.x wasm builds) and refreshes
// contracts/prebuilt. Without Rust and cargo-near it uses contracts/prebuilt instead, so the
// demo and the sandbox run with Node alone. contracts/prebuilt/dues.wasm is byte-for-byte the
// code deployed on dues.testnet (see contracts/prebuilt/README.md for the hashes).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const crates = [
  { dir: 'dues', name: 'dues' },
  { dir: 'mock-usdc', name: 'mock_usdc' },
];
const built = (name) => path.join(root, 'contracts', 'target', 'near', name, `${name}.wasm`);
const prebuilt = (name) => path.join(root, 'contracts', 'prebuilt', `${name}.wasm`);
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const probe = spawnSync('cargo', ['near', '--version'], { encoding: 'utf8' });
if (probe.status !== 0 || process.env.DUES_PREBUILT === '1') {
  for (const { name } of crates) {
    if (!existsSync(prebuilt(name))) {
      console.error(
        `contracts/prebuilt/${name}.wasm is missing and cargo-near is not installed.\n` +
          'Install it with: cargo install --locked cargo-near\n' +
          'and add the wasm target: rustup target add wasm32-unknown-unknown',
      );
      process.exit(1);
    }
    mkdirSync(path.dirname(built(name)), { recursive: true });
    copyFileSync(prebuilt(name), built(name));
  }
  console.log(`${probe.status !== 0 ? 'cargo-near not found: ' : ''}using the prebuilt contracts in contracts/prebuilt`);
  console.log(`  dues.wasm sha256 ${sha(prebuilt('dues'))} (same code as dues.testnet)`);
  process.exit(0);
}

for (const { dir, name } of crates) {
  const cwd = path.join(root, 'contracts', dir);
  console.log(`building contracts/${dir} ...`);
  const r = spawnSync('cargo', ['near', 'build', 'non-reproducible-wasm', '--locked'], {
    cwd,
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(r.stderr);
    process.exit(r.status ?? 1);
  }
  copyFileSync(built(name), prebuilt(name));
}
console.log('contracts built: contracts/target/near/{dues,mock_usdc}/*.wasm (copied to contracts/prebuilt)');
