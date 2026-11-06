// Terminal output for the demos. Colours switch off with NO_COLOR or when piped.
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);

export const bold = wrap('1');
export const dim = wrap('2');
export const green = wrap('32');
export const red = wrap('31');
export const yellow = wrap('33');
export const cyan = wrap('36');

export function banner(title: string) {
  const line = '='.repeat(Math.max(60, title.length + 4));
  console.log(`\n${bold(line)}\n${bold(`  ${title}`)}\n${bold(line)}`);
}

export function scene(title: string) {
  console.log(`\n${bold(cyan(`-- ${title}`))}`);
}

export function step(text: string) {
  console.log(`${bold('>')} ${text}`);
}

export function info(text: string) {
  console.log(`  ${dim(text)}`);
}

export function ok(text: string) {
  console.log(`  ${green('ok')}   ${text}`);
}

export function fail(text: string) {
  console.log(`  ${red('FAIL')} ${text}`);
}

export function tx(label: string, hash: string | undefined) {
  console.log(`  ${dim('tx')}   ${label.padEnd(34)} ${hash ?? dim('(none)')}`);
}
