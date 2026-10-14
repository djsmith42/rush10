#!/bin/sh
# Build Rush 10 and publish it to https://thesmithfam.org/rush10.
set -eu
cd "$(dirname "$0")/.."
export PATH=/opt/node24/bin:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true

pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/api-server build
NODE_ENV=production PORT=5173 BASE_PATH=/rush10/ pnpm --filter @workspace/rush-10 build

rsync -a --delete artifacts/rush-10/dist/public/ /home/vhosts/thesmithfam.org/rush10/
sudo systemctl restart rush10
echo "Deployed. Logs: journalctl -u rush10 -f"
