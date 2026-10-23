// Server version of netlify/functions/birthday-mails.mjs (run every hour by a systemd timer; sends at 8:00 Beirut)
import handler from '../netlify/functions/birthday-mails.mjs';
console.log(await (await handler()).text());
process.exit(0);
