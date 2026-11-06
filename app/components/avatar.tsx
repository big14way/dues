// Generated identity tile for a NEAR account: colour and initials from a hash of the id.
const HUES = [152, 168, 200, 222, 262, 292, 330, 18, 38, 96];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function initials(account: string): string {
  const name = account.replace(/\.(near|testnet|sandbox)$/, '').split(/[.\-_]/).filter(Boolean);
  const a = name[0]?.[0] ?? '?';
  const b = name.length > 1 ? (name[1]?.[0] ?? '') : (name[0]?.[1] ?? '');
  return (a + b).toUpperCase();
}

export function Avatar({ account, size = 32 }: { account: string; size?: number }) {
  const hue = HUES[hash(account) % HUES.length]!;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue} 46% 38%)` }}
      aria-hidden
    >
      {initials(account)}
    </span>
  );
}
