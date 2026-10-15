#!/bin/sh
# Build Rush 10 and publish it to https://thesmithfam.org/rush10.
# Unchanged steps are skipped; pass --force to rebuild and redeploy everything.
set -eu
cd "$(dirname "$0")/.."
export PATH=/opt/node24/bin:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true

# The restart runs under the live board, so get any sudo password prompt out of the way now.
sudo -n true 2>/dev/null || sudo -v

# Install, typecheck, build, publish, and restart in parallel; nothing ships unless every check passes.
exec node deploy/deploy.mjs "$@"
