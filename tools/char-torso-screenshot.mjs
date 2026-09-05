import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:8877';
const chars = [
  { key: 'guest',    out: 'public/ui/char-guest-torso.png',    label: 'poo-poo-head' },
  { key: 'nostrich', out: 'public/ui/char-nostrich-torso.png', label: 'nostrich' },
];

mkdirSync('public/ui', { recursive: true });

const browser = await chromium.launch();
for (const c of chars) {
  const page = await browser.newPage({ viewport: { width: 320, height: 400 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`${BASE}/tools/char-torso-render#${c.key}`, { waitUntil: 'load' });
  // Wait for the render to signal done, or the title to change.
  await page.waitForFunction(() => window.__renderDone === true, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200); // let the 2nd frame settle

  const title = await page.title();
  if (title === 'ERROR') {
    console.error(`${c.key}: RENDER ERROR`, errors);
  }
  await page.screenshot({ path: c.out });
  console.log(`${c.label} -> ${c.out} (title=${title}, errors=${errors.length})`);
  await page.close();
}
await browser.close();