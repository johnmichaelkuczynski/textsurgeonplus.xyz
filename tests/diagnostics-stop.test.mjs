// Run with a running Preview: node --import tsx tests/diagnostics-stop.test.mjs
// All paid providers are intercepted; this test never sends a paid request.
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { chromium } from "playwright";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function browserExecutable() {
  const candidates = [
    process.env.CHROMIUM_BIN,
    chromium.executablePath(),
    "/usr/bin/chromium",
  ];
  if (existsSync("/nix/store")) {
    const nixBrowsers = readdirSync("/nix/store")
      .map((entry) => ({ entry, version: Number(/^[^-]+-chromium-(\d+)/.exec(entry)?.[1] || 0) }))
      .filter(({ version }) => version > 0)
      .sort((a, b) => b.version - a.version);
    for (const { entry } of nixBrowsers) {
      candidates.push(join("/nix/store", entry, "bin/chromium"));
    }
  }
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function mockResponse(path) {
  if (path === "/api/analyze/stream") {
    return {
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ content: '{"ok":true}' })}\n\ndata: {"done":true}\n\n`,
    };
  }
  if (path === "/api/tts") {
    return { contentType: "audio/mpeg", body: Buffer.alloc(256, 42) };
  }
  const payloads = {
    "/api/corpus/authors": [],
    "/api/corpus/stats": { totalAuthors: 0, totalWorks: 0, totalWords: 0, authors: [] },
    "/api/positions": { positions: [], count: 0 },
    "/api/history": { history: [] },
    "/api/stylometrics/authors": { authors: [] },
    "/api/gptzero/detect": { predictedClass: "human", documentClassification: "human" },
    "/api/parse-file": { text: "Diagnostic style sample uses clear and measured prose." },
    "/api/parse-style-sample": { text: "Diagnostic style sample uses clear and measured prose." },
  };
  return { contentType: "application/json", body: JSON.stringify(payloads[path] ?? {}) };
}

async function assertServerCancelsUpstream() {
  const realFetch = globalThis.fetch;
  // Only this isolated process receives dummy credentials and a fake corpus address.
  for (const key of ["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "GPTZERO_API_KEY", "ARISTOTLE_API_KEY"]) {
    process.env[key] = "mock-only";
  }
  process.env.GENIUS_101_API_BASE_URL = "https://mock-corpus.invalid/";
  process.env.GENIUS_101_SEARCH_PATH = "/search";
  process.env.GENIUS_101_AUTH_HEADER = "x-api-key";

  const upstream = [];
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    if (address.startsWith("http://127.0.0.1:")) return realFetch(url, options);
    const request = { address, aborted: false };
    upstream.push(request);
    return new Promise((_resolve, reject) => {
      const abort = () => {
        request.aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
    });
  };

  const app = express();
  app.use(express.json());
  const { registerRoutes } = await import("../server/routes.ts");
  const server = await registerRoutes(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cases = [
    ["analysis", "/api/analyze/stream", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Diagnostic source.", provider: "openai", functionType: "quotes" }),
    }],
    ["corpus", "/api/thinker-chat/corpus-status?thinker=Aristotle&test=true", {}],
    ["audio", "/api/tts", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Diagnostic audio.", mode: "single" }),
    }],
    ["GPTZero", "/api/gptzero/detect", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "A diagnostic paragraph about community archives and reading historical documents across multiple editions.",
        visitorId: "mock-visitor-123",
      }),
    }],
  ];

  try {
    for (const [name, path, options] of cases) {
      const controller = new AbortController();
      const before = upstream.length;
      void realFetch(`${base}${path}`, { ...options, signal: controller.signal }).catch(() => {});
      const deadline = Date.now() + 6000;
      while (upstream.length === before && Date.now() < deadline) await pause(20);
      assert.equal(upstream.length, before + 1, `${name}: upstream request did not start`);
      controller.abort();
      const abortDeadline = Date.now() + 3000;
      while (!upstream[before].aborted && Date.now() < abortDeadline) await pause(20);
      assert.equal(upstream[before].aborted, true, `${name}: upstream work continued after disconnect`);
      console.log(`${name}: upstream canceled`);
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = realFetch;
  }
}

async function assertBrowserStopsChecks() {
  const origin = process.env.DIAGNOSTICS_TEST_URL ||
    (process.env.REPLIT_DEV_DOMAIN && `https://${process.env.REPLIT_DEV_DOMAIN}`);
  assert.ok(origin, "Set DIAGNOSTICS_TEST_URL or run inside a Replit Preview environment");
  const executablePath = browserExecutable();
  assert.ok(executablePath, "Install Chromium or set CHROMIUM_BIN");
  const browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox"] });
  const groups = [
    ["analysis", "Check main-page functions", "/api/analyze/stream", 1],
    ["read-only", "Check read-only functions", "/api/corpus/authors", 1],
    ["corpus", "Check each author key", "/api/thinker-chat/corpus-status", 4],
    ["GPTZero", "Run all diagnostics", "/api/gptzero/detect", 1],
    ["audio", "Run all diagnostics", "/api/tts", 1],
  ];
  try {
    for (const [name, button, delayedPath, expectedCount] of groups) {
      const page = await browser.newPage();
      const started = [];
      let canceled = 0;
      page.on("requestfailed", (request) => {
        if (new URL(request.url()).pathname === delayedPath) canceled++;
      });
      await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        started.push(path);
        if (path === delayedPath) await pause(1250);
        try {
          await route.fulfill(mockResponse(path));
        } catch {
          // Browser aborts the held route when the user presses Stop.
        }
      });
      try {
        await page.goto(`${origin}/humanizer-workshop/diagnostics`, { waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: button, exact: true }).click();
        const deadline = Date.now() + 15000;
        while (started.filter((path) => path === delayedPath).length < expectedCount &&
          Date.now() < deadline) await pause(30);
        assert.equal(started.filter((path) => path === delayedPath).length, expectedCount,
          `${name}: delayed request did not start`);
        const passedBadge = page.locator("span").filter({ hasText: /^\d+ passed$/ }).first();
        const passedBefore = Number((await passedBadge.textContent()).split(" ")[0]);
        const countAtStop = started.length;
        await page.getByRole("dialog").getByRole("button", { name: "Stop all diagnostics now" }).click();
        await pause(1550); // The mocked provider finishes after Stop.
        const passedAfter = Number((await passedBadge.textContent()).split(" ")[0]);
        assert.equal(started.length, countAtStop, `${name}: a new check started after Stop`);
        assert.equal(passedAfter, passedBefore, `${name}: a stopped check became a pass`);
        assert.ok(canceled >= expectedCount, `${name}: browser request was not canceled`);
        assert.match(await page.getByRole("dialog").innerText(),
          /Stopped by user\. No further results will be accepted\./);
        console.log(`${name}: no later checks or passes`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}

await assertServerCancelsUpstream();
await assertBrowserStopsChecks();