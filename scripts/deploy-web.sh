#!/usr/bin/env bash
# pnpm deploy:web  -  builds the app as a static export plus one serverless function for /api,
# and deploys both to Vercel (project: getdues). Needs the Vercel CLI logged in (vercel login).
# The function reads its keys from the Vercel project's environment (see .env.example):
#   DUES_CONTRACT, NEAR_NETWORK, RELAYER_ACCOUNT_ID, RELAYER_PRIVATE_KEYS, WATCHER_ACCOUNT_ID,
#   WATCHER_PRIVATE_KEY, CRON_SECRET. Without keys the relayer and watcher answer 503 and the
#   site stays read-only. Stop `pnpm dev` first: next build and next dev share app/.next.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="${VERCEL_PROJECT:-getdues}"
STAGE=".dues/vercel"
pnpm build:widget
(cd app && rm -rf .next out && pnpm build)
mkdir -p "$STAGE"
rsync -a --delete --exclude .vercel --exclude .vercelignore --exclude ".env*" --exclude api --exclude vercel.json \
  --exclude dues-config.json app/out/ "$STAGE/"
printf '.env*\n.gitignore\n' > "$STAGE/.vercelignore"  # never upload CLI tokens
mkdir -p "$STAGE/api"
node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild api/src/serverless.ts --bundle --platform=node \
  --target=node20 --format=esm --outfile="$STAGE/api/dues.mjs" --log-level=warning \
  "--banner:js=import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"
cat > "$STAGE/vercel.json" <<'JSON'
{
  "rewrites": [{ "source": "/api/:path*", "destination": "/api/dues?path=:path*" }],
  "crons": [{ "path": "/api/cron/pull", "schedule": "5 0 * * *" }],
  "headers": [{ "source": "/widget.js", "headers": [{ "key": "Access-Control-Allow-Origin", "value": "*" }] }]
}
JSON
cd "$STAGE"
[ -d .vercel ] || vercel link --yes --project "$PROJECT"
vercel deploy --prod --yes
