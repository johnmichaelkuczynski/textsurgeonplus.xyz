import { chromium } from 'playwright';

const EXEC = '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium';
const URL = 'http://localhost:5000/';
const W = 1920, H = 1080;
const T0 = Date.now();
const log = (m) => console.log(`[${((Date.now()-T0)/1000).toFixed(1)}s] ${m}`);

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', `--window-size=${W},${H}`] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: 'promo/raw', size: { width: W, height: H } } });
await ctx.addInitScript(() => {
  function addCursor() {
    if (document.getElementById('__fakecur')) return;
    const c = document.createElement('div');
    c.id = '__fakecur';
    c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;will-change:transform;';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 3l14 7-6 1.5L9.5 18 5 3z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    document.addEventListener('mousemove', (e) => { c.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addCursor); else addCursor();
});
const page = await ctx.newPage();
async function glideToSel(sel) { const el = page.locator(sel).first(); await el.scrollIntoViewIfNeeded().catch(()=>{}); const b = await el.boundingBox(); await page.mouse.move(b.x+b.width/2, b.y+b.height/2, { steps: 25 }); await page.waitForTimeout(250); return el; }
async function clickSel(sel) { const el = await glideToSel(sel); await page.waitForTimeout(150); await el.click(); }
async function typeInto(sel, txt, delay=24) { await glideToSel(sel); const el = page.locator(sel).first(); await el.click(); await el.type(txt, { delay }); }

try {
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(700);
  await clickSel('[data-testid="button-login"]');
  await page.waitForTimeout(400);
  await typeInto('[data-testid="input-username"]', 'demo', 55);
  await clickSel('[data-testid="button-submit-login"]');
  await page.waitForTimeout(1300);
  log('logged in');

  await clickSel('[data-testid="button-long-answer"]');
  await page.waitForTimeout(900);
  await typeInto('[data-testid="textarea-long-answer-prompt"]', 'Explain the relationship between coherence and intelligence in human reasoning.', 24);
  await page.waitForTimeout(500);
  try { await clickSel('[data-testid="select-long-answer-provider"]'); await page.waitForTimeout(300); await page.click('text=OpenAI (GPT-4o)'); await page.waitForTimeout(300); } catch (e) { log('prov skip'); }
  try { await page.fill('[data-testid="input-long-answer-words"]', '2000'); } catch {}
  await page.waitForTimeout(400);
  await clickSel('[data-testid="button-start-long-answer"]');
  log('long answer started');
  await page.waitForTimeout(50000);
  log('captured');
} catch (e) { log('ERR: ' + e.message); }
finally { const vid = page.video(); await ctx.close(); if (vid) console.log('VIDEO_PATH=' + await vid.path()); await browser.close(); log('done'); }
