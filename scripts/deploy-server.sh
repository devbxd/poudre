#!/usr/bin/env bash
# Sends the current code to our server (Google Cloud VM) and restarts the site — free and unlimited.
# Usage (from the project folder):  bash scripts/deploy-server.sh
# The photos (data/blobs) and the catalogue copy (data/snapshot) on the server are kept as they are.
set -euo pipefail
cd "$(dirname "$0")/.."
SERVER=poudre@35.211.76.231
KEY=data/oracle_key
SSH="ssh -i $KEY -o BatchMode=yes"

echo "1/4 build"
npm run build >/dev/null

echo "2/4 package"
tar --exclude=node_modules -czf data/deploy.tgz package.json package-lock.json server site db dist scripts netlify/functions

echo "3/4 upload"
scp -i "$KEY" -q data/deploy.tgz "$SERVER:/opt/poudre/deploy.tgz"
rm data/deploy.tgz

echo "4/4 install and restart"
$SSH "$SERVER" 'set -e
cd /opt/poudre
old=$(sha1sum package-lock.json | cut -d" " -f1)
tar -xzf deploy.tgz && rm deploy.tgz
if [ "$old" != "$(sha1sum package-lock.json | cut -d" " -f1)" ]; then npm ci --omit=dev --no-audit --no-fund >/dev/null; fi
sudo systemctl restart poudre
for i in $(seq 1 30); do curl -sf -m 5 http://127.0.0.1:3000/api/health >/dev/null && break; sleep 1; done
curl -sf -m 5 http://127.0.0.1:3000/api/health >/dev/null && echo "site back up"'
echo "deployed $(git rev-parse --short HEAD 2>/dev/null || true)"
