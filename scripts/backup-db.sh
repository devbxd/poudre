#!/bin/bash
# Nightly copy of the shop's database (orders, customers, products, stock…) into data/backups. About 2 MB each: the
# disk holds years of them, old ones can be cleared by hand.
# Run by the poudre-backup systemd timer. Restore one: pg_restore --clean --no-owner -d "$DATABASE_URL" <file>
set -euo pipefail
cd /opt/poudre
set -a; . /etc/poudre.env; set +a
mkdir -p data/backups
file="data/backups/poudre-$(date +%Y%m%d-%H%M).dump"
/usr/lib/postgresql/18/bin/pg_dump -Fc --no-owner --no-acl -d "$DATABASE_URL" -f "$file.part"
mv "$file.part" "$file"
echo "backup $file $(du -h "$file" | cut -f1)"
