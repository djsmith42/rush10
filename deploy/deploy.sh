#!/bin/sh
# Build Rush 10 and publish it to https://thesmithfam.org/rush10.
set -eu
cd "$(dirname "$0")/.."
export PATH=/opt/node24/bin:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true

# Install, typecheck, and build in parallel; nothing below runs unless all of it passes.
node deploy/build.mjs

# Publish the static files while the API restarts.
rsync -a --delete artifacts/rush-10/dist/public/ /home/vhosts/thesmithfam.org/rush10/ &
sudo systemctl restart rush10
wait $!
echo "Deployed. Logs: journalctl -u rush10 -f"
