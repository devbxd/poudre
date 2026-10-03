#!/bin/sh
# Restarts only the local API (port 8787) without touching other node processes
PID=$(netstat -ano | grep ":8787 " | grep LISTENING | awk '{print $5}' | head -1)
[ -n "$PID" ] && taskkill //F //PID $PID >/dev/null 2>&1
(node --env-file-if-exists=.env server/dev.js > /tmp/api.log 2>&1 &)
sleep 3
