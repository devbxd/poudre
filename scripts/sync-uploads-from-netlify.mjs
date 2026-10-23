// Copies onto this server the photos uploaded from the dashboard while the site still ran on Netlify
// (originals only: the smaller sizes are made again on demand). Safe to run again: skips files already here.
// Usage on the server: node --env-file=/etc/poudre.env scripts/sync-uploads-from-netlify.mjs
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { query } from '../server/db.js';

const NETLIFY = 'https://poudree.netlify.app'; // the Netlify address keeps working after the domain moves
const rows = await query(`select url, sizes from media where url like '/wp-content/uploads/%' and created_at > '2026-10-12'`);
let got = 0, had = 0, failed = 0;
for (const { url } of rows) {
  const file = `data/blobs/uploads/${decodeURIComponent(url.replace('/wp-content/uploads/', ''))}`;
  if (existsSync(file)) { had++; continue; }
  const res = await fetch(NETLIFY + url).catch(() => null);
  if (!res?.ok) { failed++; console.log('FAILED', url, res?.status); continue; }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  got++;
}
console.log(`photos: ${got} copied, ${had} already here, ${failed} failed`);
process.exit(0);
