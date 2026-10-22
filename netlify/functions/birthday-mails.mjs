// Every morning: "Happy Birthday" e-mails with a one-use 20% code (server/birthday.js).
// Runs hourly and sends at 8:00 Beirut time whatever the season (summer UTC+3, winter UTC+2); a customer gets one
// e-mail a year whatever happens (the year is recorded before sending).
import { sendBirthdayEmails } from '../../server/birthday.js';

export default async () => {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Beirut' }).format(new Date()));
  if (hour !== 8) return new Response('not 8:00 in Beirut');
  const r = await sendBirthdayEmails();
  console.log('birthday e-mails', JSON.stringify(r));
  return new Response(JSON.stringify(r));
};

export const config = { schedule: '0 * * * *' };
