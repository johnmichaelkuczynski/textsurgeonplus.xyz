import { chromium } from 'playwright';

const EXEC = '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium';
const URL = 'http://localhost:5000/';
const W = 1920, H = 1080;

const SAMPLE = `Knowledge is not the accumulation of facts but the disciplined organization of understanding. A person may memorize a thousand propositions and yet grasp nothing, while another, holding only a handful of principles, perceives the structure that binds them together. The difference lies not in quantity but in coherence. To understand is to see how one thing follows from another, how a conclusion rests upon its premises, and how a single idea can illuminate an entire field of inquiry. Genuine intelligence reveals itself in the capacity to compress: to take what is sprawling and render it lucid, to find the thread that runs through apparent chaos and to name it plainly. This is why the careful reader is rarer, and far more valuable, than the merely fast one. Speed consumes the page; comprehension transforms the mind. The task of analysis, then, is not to summarize what was said but to expose the architecture beneath it, the hidden scaffolding of argument upon which every serious claim must finally stand.`;

const log = (m) => console.log(`[${((Date.now()-T0)/1000).toFixed(1)}s] ${m}`);
const T0 = Date.now();

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', `--window-size=${W},${H}`] });
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: 'promo/raw', size: { width: W, height: H } },
});

// fake cursor that follows mouse events
await ctx.addInitScript(() => {
  function addCursor() {
    if (document.getElementById('__fakecur')) return;
    const c = document.createElement('div');
    c.id = '__fakecur';
    c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transition:transform 0.05s linear;will-change:transform;';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 3l14 7-6 1.5L9.5 18 5 3z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    document.addEventListener('mousemove', (e) => { c.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addCursor);
  else addCursor();
});

const page = await ctx.newPage();

async function glideToSel(sel) {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded().catch(()=>{});
  const box = await el.boundingBox();
  if (!box) throw new Error('no box for ' + sel);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 25 });
  await page.waitForTimeout(250);
  return el;
}
async function clickSel(sel) { const el = await glideToSel(sel); await page.waitForTimeout(150); await el.click(); }
async function typeInto(sel, txt, delay = 28) { await glideToSel(sel); const el = page.locator(sel).first(); await el.click(); await el.type(txt, { delay }); }

try {
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(800);
  await page.mouse.move(W/2, H/2, { steps: 5 });

  // login
  await clickSel('[data-testid="button-login"]');
  await page.waitForTimeout(500);
  await typeInto('[data-testid="input-username"]', 'demo', 60);
  await page.waitForTimeout(300);
  await clickSel('[data-testid="button-submit-login"]');
  await page.waitForTimeout(1500);
  log('logged in');

  // provider -> Zhi 2 (openai)
  try {
    await clickSel('[data-testid="select-llm"]');
    await page.waitForTimeout(400);
    await page.click('text=Zhi 2');
    await page.waitForTimeout(400);
    log('provider set');
  } catch (e) { log('provider select skip: ' + e.message); }

  // paste document
  await glideToSel('[data-testid="input-text"]');
  await page.fill('[data-testid="input-text"]', SAMPLE);
  await page.waitForTimeout(1800);
  log('text pasted');

  // SCENE 1: QUOTES
  try {
    await clickSel('[data-testid="button-quotes"]');
    await page.waitForTimeout(900);
    await typeInto('[data-testid="input-quote-author"]', 'John Searle', 55);
    await page.waitForTimeout(500);
    await clickSel('[data-testid="button-extract-quotes"]');
    log('quotes started');
    await page.waitForTimeout(42000);
    log('quotes captured');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
  } catch (e) { log('QUOTES scene error: ' + e.message); await page.keyboard.press('Escape').catch(()=>{}); }

  // SCENE 2: TRACTATUS TREE
  try {
    await clickSel('[data-testid="button-tractatus-tree"]');
    log('tractatus tree started');
    await page.waitForTimeout(42000);
    log('tractatus captured');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
  } catch (e) { log('TRACTATUS scene error: ' + e.message); await page.keyboard.press('Escape').catch(()=>{}); }

  // SCENE 3: LONG ANSWER
  try {
    await clickSel('[data-testid="button-long-answer"]');
    await page.waitForTimeout(800);
    await typeInto('[data-testid="textarea-long-answer-prompt"]', 'Explain the relationship between coherence and intelligence in human reasoning.', 22);
    await page.waitForTimeout(500);
    // set provider openai
    try { await clickSel('[data-testid="select-long-answer-provider"]'); await page.waitForTimeout(300); await page.click('text=OpenAI (GPT-4o)'); await page.waitForTimeout(300); } catch {}
    // set target words low
    try { await page.fill('[data-testid="input-long-answer-words"]', '2000'); } catch {}
    await page.waitForTimeout(400);
    await clickSel('[data-testid="button-start-long-answer"]');
    log('long answer started');
    await page.waitForTimeout(45000);
    log('long answer captured');
  } catch (e) { log('LONGANSWER scene error: ' + e.message); }

  await page.waitForTimeout(1000);
} catch (e) {
  log('FATAL: ' + e.message);
} finally {
  const vid = page.video();
  await ctx.close();
  if (vid) { const p = await vid.path(); console.log('VIDEO_PATH=' + p); }
  await browser.close();
  log('done');
}
