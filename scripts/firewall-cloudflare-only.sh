#!/bin/bash
# Web ports (80, 443) open only to Cloudflare: nobody can reach the shop around Cloudflare's protection by using the
# server's IP address. SSH (22) stays open. Ranges from https://www.cloudflare.com/ips/ (run again if they change).
set -euo pipefail
V4="173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22"
V6="2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32"
ufw allow 22/tcp >/dev/null
for r in $V4 $V6; do ufw allow proto tcp from "$r" to any port 80,443 comment cloudflare >/dev/null; done
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw --force enable >/dev/null
ufw status | head -5
echo "rules: $(ufw status | grep -c cloudflare)"
