import { chromium } from 'playwright';
const EXEC = '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium';
const W = 1920, H = 1080;

const base = `
  *{margin:0;padding:0;box-sizing:border-box;font-family:'DejaVu Sans',sans-serif;}
  body{width:${W}px;height:${H}px;overflow:hidden;background:#0b0a1f;}
  .stage{position:relative;width:100%;height:100%;
    background:radial-gradient(1200px 800px at 30% 20%, #3b1d8f 0%, transparent 60%),
               radial-gradient(1000px 900px at 80% 90%, #5b21b6 0%, transparent 55%),
               linear-gradient(135deg,#0d0b24 0%,#171041 50%,#0d0b24 100%);
    display:flex;flex-direction:column;align-items:center;justify-content:center;}
  .logo{display:flex;align-items:center;gap:28px;}
  .glyph{width:120px;height:120px;border-radius:28px;
    background:linear-gradient(135deg,#7c3aed,#4f46e5);
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 20px 60px rgba(124,58,237,.55);}
  .glyph svg{width:64px;height:64px;}
  .brand{font-size:104px;font-weight:800;letter-spacing:-2px;color:#fff;line-height:1;}
  .brand .lite{font-weight:300;color:#c4b5fd;}
  .tag{margin-top:40px;font-size:40px;color:#cbbff5;font-weight:300;letter-spacing:.5px;}
  .pill{margin-top:54px;font-size:28px;color:#fff;border:2px solid rgba(196,181,253,.5);
    padding:18px 46px;border-radius:999px;background:rgba(124,58,237,.18);font-weight:600;letter-spacing:1px;}
  .sub{margin-top:30px;font-size:30px;color:#a99fd6;font-weight:300;}
`;
const scissors = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="6" r="3" stroke="#fff" stroke-width="2"/><circle cx="6" cy="18" r="3" stroke="#fff" stroke-width="2"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const title = `<!doctype html><html><head><style>${base}</style></head><body><div class="stage">
  <div class="logo"><div class="glyph">${scissors}</div><div class="brand">TEXT <span class="lite">SURGEON</span></div></div>
  <div class="tag">The AI workbench for serious reading</div>
</div></body></html>`;

const outro = `<!doctype html><html><head><style>${base}</style></head><body><div class="stage">
  <div class="logo"><div class="glyph">${scissors}</div><div class="brand">TEXT <span class="lite">SURGEON</span></div></div>
  <div class="pill">ANALYZE ANYTHING · NO WORD LIMIT</div>
  <div class="sub">Quotes · Arguments · Summaries · Rewrites · Long-form answers</div>
</div></body></html>`;

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
for (const [name, html] of [['title', title], ['outro', outro]]) {
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `promo/assets/${name}.png` });
  console.log('saved', name);
}
await browser.close();
