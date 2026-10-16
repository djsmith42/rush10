#!/bin/sh
# One-time server hardening for Rush 10. Run as root: sudo sh scripts/deploy/harden.sh
# Safe to rerun; every step checks before changing anything.
#
#  1. Run the API as a dedicated `rush10` account (no login, no sudo) in a systemd sandbox.
#  2. Apache: hide the version (ServerTokens Prod, ServerSignature Off), and cap request
#     bodies (16 KB, via LimitRequestBody plus a Content-Length rewrite) and backend wait
#     time (10s) on /rush10/api.
set -eu
cd "$(dirname "$0")"
[ "$(id -u)" = 0 ] || { echo "Run as root: sudo sh $0" >&2; exit 1; }

DATA=/var/lib/rush10
VHOST=/etc/apache2/sites-available/thesmithfam.org-le-ssl.conf
SECURITY=/etc/apache2/conf-available/security.conf
BACKUP=/root/rush10-harden-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP"
cp /etc/systemd/system/rush10.service "$VHOST" "$SECURITY" "$BACKUP/"
echo "Backups in $BACKUP"

# ── 1. Dedicated service account ─────────────────────────────────────────────
if ! getent passwd rush10 >/dev/null; then
  useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin rush10
  echo "Created system user rush10"
fi
# dave reads the database with ./dbdump through the rush10 group (takes effect at next login).
usermod -aG rush10 dave
chown -R rush10:rush10 "$DATA"
chmod 750 "$DATA"
find "$DATA" -type f -exec chmod 640 {} +

install -m 644 rush10.service /etc/systemd/system/rush10.service
systemctl daemon-reload
systemctl restart rush10
sleep 2
systemctl is-active --quiet rush10 || { journalctl -u rush10 -n 30 --no-pager; echo "rush10 failed to start; old unit is in $BACKUP" >&2; exit 1; }
curl -fsS -o /dev/null http://127.0.0.1:3010/api/rush10/rules || { echo "rush10 is up but not answering" >&2; exit 1; }
echo "rush10 running as $(ps -o user= -p "$(systemctl show -p MainPID --value rush10)")"

# ── 2. Apache ────────────────────────────────────────────────────────────────
sed -i -E 's/^ServerTokens .*/ServerTokens Prod/; s/^ServerSignature .*/ServerSignature Off/' "$SECURITY"

if ! grep -q 'ProxyPass /rush10/api http://127.0.0.1:3010/api timeout=10' "$VHOST"; then
  sed -i -E 's#^(\s*)ProxyPass /rush10/api http://127\.0\.0\.1:3010/api$#\1ProxyPass /rush10/api http://127.0.0.1:3010/api timeout=10#' "$VHOST"
fi
if ! grep -q 'LimitRequestBody 16384' "$VHOST"; then
  sed -i -E 's#^(\s*)ProxyPassReverse /rush10/api http://127\.0\.0\.1:3010/api$#&\n\1<Location /rush10/api>\n\1\tLimitRequestBody 16384\n\1</Location>#' "$VHOST"
fi

# LimitRequestBody is ignored for proxied requests Apache streams through, so also refuse
# oversized declared bodies before they reach Node (chunked bodies hit Express's 8 KB cap).
if ! grep -q 'rush10-body-limit' "$VHOST"; then
  sed -i -E '/LimitRequestBody 16384/{n;s#^(\s*)</Location>$#&\n\1\# rush10-body-limit: LimitRequestBody does not apply to streamed proxy bodies.\n\1RewriteCond %{REQUEST_URI} ^/rush10/api/\n\1RewriteCond expr "%{HTTP:Content-Length} -gt 16384"\n\1RewriteRule ^ - [R=413,L]#}' "$VHOST"
fi
if ! apache2ctl configtest; then
  cp "$BACKUP/$(basename "$VHOST")" "$VHOST"
  cp "$BACKUP/$(basename "$SECURITY")" "$SECURITY"
  echo "Apache config test failed; restored the originals and left Apache untouched." >&2
  exit 1
fi
systemctl reload apache2
echo "Apache reloaded"
echo "Done."
