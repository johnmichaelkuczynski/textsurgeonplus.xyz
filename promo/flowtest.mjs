import { chromium } from 'playwright';

const EXEC = '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium';
const URL = 'http://localhost:5000/';

const SAMPLE = `Knowledge is not merely the accumulation of facts but the disciplined organization of understanding. A person may memorize a thousand propositions and yet grasp nothing, while another, holding only a handful of principles, sees the structure that binds them. The difference lies not in quantity but in coherence. To understand is to perceive how one thing follows from another, how a conclusion rests upon its premises, and how a single idea can illuminate an entire field. Genuine intelligence reveals itself in the capacity to compress: to take what is sprawling and render it lucid, to find the thread that runs through apparent chaos. This is why the careful reader is rarer than the fast one. Speed consumes; comprehension transforms.`;

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

// login
await page.click('[data-testid="button-login"]');
await page.fill('[data-testid="input-username"]', 'demo');
await page.click('[data-testid="button-submit-login"]');
await page.waitForTimeout(1500);
console.log('logged in');

// select provider openai (Zhi 2)
try {
  await page.click('[data-testid="select-llm"]');
  await page.waitForTimeout(400);
  await page.click('text=Zhi 2');
  await page.waitForTimeout(400);
  console.log('selected provider Zhi 2');
} catch (e) { console.log('provider select failed:', e.message); }

// type text
await page.fill('[data-testid="input-text"]', SAMPLE);
await page.waitForTimeout(500);
console.log('text entered');

// click quotes
await page.click('[data-testid="button-quotes"]');
console.log('clicked quotes, waiting for results...');

const start = Date.now();
let lastLen = 0, stableCount = 0, firstAt = null;
const resultsArea = page.locator('text=ANALYSIS RESULTS').locator('xpath=ancestor::div[1]');
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(2000);
  const body = await page.evaluate(() => document.body.innerText.length);
  if (firstAt === null && body > 2000) firstAt = Date.now() - start;
  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`t=${elapsed}s bodyTextLen=${body}`);
  if (body === lastLen) { stableCount++; } else { stableCount = 0; }
  lastLen = body;
  if (stableCount >= 4 && i > 6) { console.log('output stabilized'); break; }
}
await page.screenshot({ path: 'promo/raw/flowtest_result.png', fullPage: false });
console.log('first content at(ms):', firstAt);
console.log('done');
await browser.close();
