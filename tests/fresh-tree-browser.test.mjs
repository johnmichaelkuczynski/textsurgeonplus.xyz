import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright";
import {
  chapters, baseTree, thesisTier, applyTier, finishedTree,
  treeEvent, chapterComplete, outputFor,
} from "./browser/fresh-tree-fixtures.mjs";

const KEY = "fresh-tree-checkpoint-v1";
let vite, browser, origin;
const runs = [], stops = [], unexpected = [];
const errors = [];

function browserExecutable() {
  if (process.env.CHROMIUM_BIN) {
    assert.ok(existsSync(process.env.CHROMIUM_BIN), "CHROMIUM_BIN does not exist");
    return process.env.CHROMIUM_BIN;
  }
  const nix = existsSync("/nix/store") ? readdirSync("/nix/store")
    .map((entry) => ({ entry, version: Number(/^[^-]+-(?:ungoogled-)?chromium-(\d+)/.exec(entry)?.[1] || 0) }))
    .filter(({ version }) => version > 0).sort((a, b) => b.version - a.version)
    .map(({ entry }) => join("/nix/store", entry, "bin/chromium")) : [];
  const path = [chromium.executablePath(), ...nix, "/usr/bin/chromium"].find(existsSync);
  assert.ok(path, "Install Playwright Chromium or set CHROMIUM_BIN; browser coverage was NOT run");
  return path;
}

function send(run, events, end = false) {
  assert.ok(run && !run.response.destroyed, "SSE connection must still be open");
  for (const event of events) run.response.write(`data: ${JSON.stringify(event)}\n\n`);
  if (end) run.response.end();
}

before(async () => {
  // Private ephemeral server: no production routes, credentials, or paid calls.
  vite = await createServer({
    configFile: false, root: resolve("."), logLevel: "error",
    css: { postcss: { plugins: [] } }, // Match the app's Tailwind v4 Vite configuration.
    resolve: { alias: { "@": resolve("client/src") } },
    plugins: [react(), tailwindcss(), {
      name: "fresh-tree-mock-sse",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/api/")) return next();
          try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const data = body ? JSON.parse(body) : {};
            if (req.url === "/api/fresh-tree") {
              res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
              res.flushHeaders();
              runs.push({ data, response: res });
              return; // Tests release individual events at observed UI checkpoints.
            }
            res.setHeader("Content-Type", "application/json");
            if (req.url === "/api/fresh-tree/chapters") return res.end(JSON.stringify({ chapters }));
            if (req.url === "/api/fresh-tree/stop") {
              stops.push(data);
              const run = runs.find((r) => r.data.runId === data.runId);
              assert.ok(run, "STOP must identify the active run");
              send(run, [{ type: "stopped" }, { type: "complete" }], true);
              return res.end(JSON.stringify({ stopped: true }));
            }
            unexpected.push(req.url);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: "Unexpected API: " + req.url }));
          } catch (error) {
            errors.push(String(error));
            res.destroy(error);
          }
        });
      },
    }],
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
  });
  await vite.listen();
  origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({
    headless: true, executablePath: browserExecutable(), args: ["--no-sandbox"],
  });
});

after(async () => {
  await browser?.close();
  await vite?.close();
  assert.deepEqual(unexpected, [], "No unmocked API requests are allowed");
  assert.deepEqual(errors, [], "No mock SSE server failures are allowed");
});

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, acceptDownloads: true });
  page.on("pageerror", (error) => errors.push(String(error)));
  // Fail closed: the isolated harness must never reach any external provider.
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    unexpected.push(route.request().url());
    return route.abort();
  });
  await page.goto(`${origin}/tests/browser/fresh-tree.html`);
  await page.getByRole("button", { name: "Open Fresh Tree", exact: true }).click();
  await page.getByTestId("fresh-tree-dialog").waitFor();
  return page;
}

async function saved(page) {
  return page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), KEY);
}

async function assertTrees(page, trees) {
  // Wait on application state, not time or guessed provider latency.
  await page.waitForFunction(({ key, trees }) => {
    const checkpoint = JSON.parse(sessionStorage.getItem(key) || "null");
    return JSON.stringify(checkpoint?.trees) === JSON.stringify(trees);
  }, { key: KEY, trees });
  assert.deepEqual((await saved(page)).trees, trees);
  assert.equal(await page.getByTestId("fresh-tree-results").locator("pre").textContent(), outputFor(trees));
}

async function waitForRun(page, count) {
  // Response arrival means the held SSE connection has been established.
  await page.waitForFunction(() => !!document.querySelector('[data-testid="fresh-tree-stop"]'));
  const deadline = Date.now() + 10000;
  while (runs.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(runs.length, count);
  return runs.at(-1);
}

async function startBook(page, target = 3, selected = false) {
  await page.getByTestId(`fresh-tree-mode-${selected ? "C" : "B"}`).click();
  await page.getByTestId("fresh-tree-chapters").getByText(/Gamma/).waitFor();
  if (selected) for (const { index } of chapters) await page.getByTestId(`fresh-tree-chapter-${index}`).click();
  await page.getByTestId("fresh-tree-depth").fill(String(target));
  const count = runs.length + 1;
  await page.getByTestId("fresh-tree-generate").click();
  return waitForRun(page, count);
}

async function stop(page, run) {
  const count = stops.length;
  await page.getByTestId("fresh-tree-stop").click();
  await page.getByTestId("fresh-tree-generate").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector('[data-testid="fresh-tree-stop"]'));
  assert.equal(stops.length, count + 1);
  assert.deepEqual(stops.at(-1), { runId: run.data.runId });
}

async function reopenAndReload(page, checkpoint) {
  await page.getByTestId("fresh-tree-cancel").click();
  await page.getByRole("button", { name: "Open Fresh Tree", exact: true }).click();
  await assertTrees(page, checkpoint.trees);
  assert.deepEqual(await saved(page), checkpoint, "Closing/reopening must not rewrite any checkpoint");
  await page.reload();
  await page.getByRole("button", { name: "Open Fresh Tree", exact: true }).click();
  await assertTrees(page, checkpoint.trees);
  assert.deepEqual(await saved(page), checkpoint, "Same-tab reload must retain the exact saved run");
}

async function resume(page, checkpoint) {
  const count = runs.length + 1;
  assert.equal(await page.getByTestId("fresh-tree-resume").isEnabled(), true);
  await page.getByTestId("fresh-tree-resume").click();
  const run = await waitForRun(page, count);
  const input = JSON.parse(checkpoint.snapshot.inputKey);
  assert.deepEqual(run.data, {
    text: input.text, selection: "", mode: input.mode, indices: checkpoint.chosen,
    action: "resume", instructions: checkpoint.snapshot.instructions,
    depth: checkpoint.snapshot.target, addedInstructions: checkpoint.snapshot.addedInstructions,
    runId: run.data.runId, resumeAction: checkpoint.snapshot.action, trees: checkpoint.trees,
  }, "RESUME must send every exact node, source, and per-thesis checkpoint");
  assert.notEqual(run.data.runId, runs.at(-2).data.runId, "Resume uses a fresh request identity");
  await assertTrees(page, checkpoint.trees);
  return run;
}

test("stopped book retains complete, partial, and untouched chapters through guards/reopen/reload/resume", async () => {
  const page = await newPage();
  try {
    const run = await startBook(page, 3, true);
    const first = finishedTree(0);
    const partial = applyTier(baseTree(1), thesisTier(1, 1));
    send(run, [
      treeEvent(first), chapterComplete(first), treeEvent(baseTree(1)), thesisTier(1, 1),
      { type: "node-warning", message: "Fixture review warning retained." },
    ]);
    await assertTrees(page, [first, partial]);
    await stop(page, run);
    const checkpoint = await saved(page);
    assert.equal(checkpoint.snapshot.expectedUnits, 3);
    assert.equal(checkpoint.trees.some((t) => t.index === 2), false, "Untouched chapter must not be fabricated");
    assert.deepEqual(checkpoint.warnings, ["Fixture review warning retained."]);
    assert.match(await page.getByTestId("fresh-tree-resume-status").textContent(), /1 of 3 chapters finished/);
    await reopenAndReload(page, checkpoint);

    // Settings, mode, chapter-selection and source mismatches must disable
    // RESUME without replacing the saved original output or issuing a request.
    const count = runs.length;
    const blocked = async () => {
      assert.equal(await page.getByTestId("fresh-tree-resume").isDisabled(), true);
      assert.deepEqual(await saved(page), checkpoint);
      assert.equal(runs.length, count);
    };
    await page.getByTestId("fresh-tree-depth").fill("4"); await blocked();
    await page.getByTestId("fresh-tree-depth").fill("3");
    await page.getByTestId("fresh-tree-added-instructions").fill("Changed added-tier rules"); await blocked();
    await page.getByTestId("fresh-tree-added-instructions").fill("");
    await page.locator("#fresh-tree-instructions").fill("Changed fresh-node rules"); await blocked();
    await page.locator("#fresh-tree-instructions").fill(checkpoint.snapshot.instructions);
    await page.getByTestId("fresh-tree-chapter-2").click(); await blocked();
    await page.getByTestId("fresh-tree-chapter-2").click();
    await page.getByTestId("fresh-tree-mode-A").click(); await blocked();
    await page.getByTestId("fresh-tree-mode-C").click();
    await page.getByTestId("fresh-tree-chapters").getByText(/Gamma/).waitFor();
    await page.getByTestId("fresh-tree-cancel").click();
    await page.getByLabel("Book source").fill("Different source document");
    await page.getByRole("button", { name: "Open Fresh Tree", exact: true }).click(); await blocked();
    await page.getByTestId("fresh-tree-cancel").click();
    await page.getByLabel("Book source").fill(JSON.parse(checkpoint.snapshot.inputKey).text);
    await page.getByRole("button", { name: "Open Fresh Tree", exact: true }).click();

    const resumed = await resume(page, checkpoint);
    // Match the server's replay contract; even a replayed thesis delta must
    // not duplicate a node or its source in visible or saved output.
    send(resumed, [treeEvent(first), chapterComplete(first), treeEvent(partial), thesisTier(1, 1)]);
    await assertTrees(page, checkpoint.trees);
    const second = applyTier(partial, thesisTier(1, 2, true));
    const third = finishedTree(2);
    send(resumed, [
      thesisTier(1, 2, true), chapterComplete(second), treeEvent(baseTree(2)),
      thesisTier(2, 1), thesisTier(2, 2, true), chapterComplete(third), { type: "complete" },
    ], true);
    await assertTrees(page, [first, second, third]);
    await page.waitForFunction(() => !document.querySelector('[data-testid="fresh-tree-stop"]'));
    assert.equal(await page.getByTestId("fresh-tree-resume").count(), 0);
    assert.equal(await page.getByTestId("fresh-tree-next").isEnabled(), true);
    assert.deepEqual((await saved(page)).trees[0], first, "Finished chapter remains byte-for-byte unchanged");
    await reopenAndReload(page, await saved(page));
  } finally { await page.close(); }
});

test("ADD NEXT TIER interrupted before any SSE model output keeps every chapter resumable", async () => {
  const page = await newPage();
  try {
    const initial = await startBook(page, 2);
    const base = chapters.map(({ index }) => baseTree(index, 2));
    send(initial, [...base.flatMap((tree) => [treeEvent(tree), chapterComplete(tree)]), { type: "complete" }], true);
    await assertTrees(page, base);
    await page.waitForFunction(() => !document.querySelector('[data-testid="fresh-tree-stop"]'));
    const count = runs.length + 1;
    await page.getByTestId("fresh-tree-next").click();
    const next = await waitForRun(page, count);
    assert.equal(next.data.action, "next");
    assert.deepEqual(next.data.trees, base, "Initial next request carries the original complete trees");
    const pending = base.map((tree) => ({
      ...tree, complete: false, progress: {
        ...tree.progress, targetDepth: 3, tiers: { "3": { completedTheses: [], complete: false } },
      },
    }));
    // No tree/tier/progress event has been released for this request.
    await assertTrees(page, pending);
    await stop(page, next);
    const checkpoint = await saved(page);
    assert.equal(checkpoint.snapshot.action, "next");
    await reopenAndReload(page, checkpoint);
    const resumed = await resume(page, checkpoint);
    const finished = chapters.map(({ index }) => finishedTree(index));
    send(resumed, finished.flatMap((tree, index) => [
      treeEvent(pending[index]), thesisTier(index, 1), thesisTier(index, 2, true), chapterComplete(tree),
    ]).concat({ type: "complete" }), true);
    await assertTrees(page, finished);
    await page.waitForFunction(() => !document.querySelector('[data-testid="fresh-tree-stop"]'));
    assert.equal(await page.getByTestId("fresh-tree-next").isEnabled(), true);
    assert.equal(await page.getByTestId("fresh-tree-resume").count(), 0);
  } finally { await page.close(); }
});

test("final thesis completion is retained before chapter-complete, including reviewed-away children", async () => {
  const page = await newPage();
  try {
    const run = await startBook(page);
    const first = finishedTree(0);
    const second = finishedTree(1);
    const partial = applyTier(baseTree(2), thesisTier(2, 1));
    send(run, [treeEvent(first), chapterComplete(first), treeEvent(second), chapterComplete(second),
      treeEvent(baseTree(2)), thesisTier(2, 1)]);
    await assertTrees(page, [first, second, partial]);
    // The final thesis passed review but all its children were dropped. Its
    // empty delta still completes the checkpoint, before chapter-complete.
    const last = applyTier(partial, thesisTier(2, 2, true, true));
    send(run, [thesisTier(2, 2, true, true)]);
    await assertTrees(page, [first, second, last]);
    await stop(page, run); // Never emit chapter-complete for the final chapter.
    const checkpoint = await saved(page);
    assert.deepEqual(last.progress.tiers["3"], { completedTheses: ["1.0", "2.0"], complete: true });
    assert.equal(last.statements.some((s) => s.number === "2.1.1"), false);
    assert.equal(last.complete, true);
    await reopenAndReload(page, checkpoint);
    assert.equal(await page.getByTestId("fresh-tree-resume").count(), 0, "Do not regenerate a final completed thesis");
    assert.equal(await page.getByTestId("fresh-tree-next").isEnabled(), true);
  } finally { await page.close(); }
});