// Server version of netlify/functions/keep-warm.mjs (run every 4 minutes by a systemd timer)
import handler from '../netlify/functions/keep-warm.mjs';
console.log(await (await handler()).text());
process.exit(0);
