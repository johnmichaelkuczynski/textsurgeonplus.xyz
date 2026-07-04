import { chromium } from 'playwright';

const EXEC = '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium';
const URL = 'http://localhost:5000/';

const browser = await chromium.launch({
  executablePath: EXEC,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
console.log('TITLE:', await page.title());

const ids = [
  'button-login', 'input-username', 'button-submit-login',
  'input-text', 'select-llm', 'button-quotes', 'button-tractatus-tree',
  'button-long-answer', 'button-arguments', 'button-custom-analyzer',
];
for (const id of ids) {
  const el = page.locator(`[data-testid="${id}"]`);
  const count = await el.count();
  console.log(`${id}: ${count}`);
}
await page.screenshot({ path: 'promo/raw/probe_home.png', fullPage: false });
console.log('screenshot saved');
await browser.close();
