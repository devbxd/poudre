// Captures the current WordPress site: raw HTML + full-page screenshots (desktop & mobile)
// Usage: node scripts/capture-original.mjs [name ...]   (base defaults to the live site)
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.env.CAPTURE_BASE || 'https://poudrebeauty.com';
const OUT = process.env.CAPTURE_OUT || 'data/original';
const urls = JSON.parse(await readFile('data/site-urls.json', 'utf8'));
const only = process.argv.slice(2);
const browser = await chromium.launch();
const sizes = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844, isMobile: true, hasTouch: true } };

for (const [name, path] of Object.entries(urls)) {
  if (only.length && !only.includes(name)) continue;
  const raw = await fetch(BASE + path, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  await writeFile(`${OUT}/html/${name}.html`, await raw.text());
  for (const [device, vp] of Object.entries(sizes)) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 });
    } catch { /* keep whatever loaded */ }
    // close popups so the page itself is visible, scroll to trigger lazy images
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/shots/${name}-${device}.png`, fullPage: true });
    await ctx.close();
  }
  console.log('captured', name, raw.status);
}
await browser.close();
