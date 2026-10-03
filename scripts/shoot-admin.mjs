// Screenshots of dashboard pages for visual checks: node scripts/shoot-admin.mjs [path...]
import { chromium } from 'playwright';
const base = 'http://localhost:8787/admin';
const paths = process.argv.slice(2).length ? process.argv.slice(2) : ['/', '/orders', '/products', '/stock', '/categories', '/pos'];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()}: ${m.text()}`));
await page.goto(base + '/');
if (await page.locator('input[autocomplete=username]').count()) {
  await page.fill('input[autocomplete=username]', 'jeanclaude');
  await page.fill('input[type=password]', process.env.OWNER_PASSWORD || 'RzEnRGoa');
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(1500);
}
for (const p of paths) {
  await page.goto(base + p);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  const name = p.replace(/[^a-z0-9]+/gi, '_') || 'home';
  await page.screenshot({ path: `data/shots/admin${name}.png`, fullPage: false });
  console.log('shot', p);
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
