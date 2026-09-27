import express from "express";
import { mkdir, writeFile } from "node:fs/promises";
import { registerRoutes } from "../server/routes";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] || char).replace(/ +(?=\r?\n|$)/g, (spaces) => "&#32;".repeat(spaces.length));
}

async function main() {
  // An isolated, ephemeral server exercises the actual registered routes without
  // restarting or modifying the application's running preview workflow.
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = await registerRoutes(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not open diagnostic server.");
  const base = `http://127.0.0.1:${address.port}`;
  const records: Array<{ prompt: string; appliedInstruction: string; output: string; status: string; words: number; drafts: Array<{ text: string; words: number; issues: string[]; provider: string }> }> = [];
  try {
    const fixtureResponse = await fetch(`${base}/api/humanizer/diagnostic-prompts`);
    if (!fixtureResponse.ok) throw new Error(`Diagnostic files unavailable: HTTP ${fixtureResponse.status}`);
    const fixture = await fixtureResponse.json() as { prompts: string[] };
    for (const [index, prompt] of fixture.prompts.slice(0, 10).entries()) {
      let output = "";
      let status = "";
      let words = 0;
      let appliedInstruction = "";
      let drafts: Array<{ text: string; words: number; issues: string[]; provider: string }> = [];
      try {
        const response = await fetch(`${base}/api/humanizer/diagnostic-rewrite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(360_000),
          body: JSON.stringify({ promptIndex: index }),
        });
        if (!response.headers.get("content-type")?.includes("application/json")) {
          throw new Error(`Non-JSON response (HTTP ${response.status})`);
        }
        const body = await response.json() as { text?: string; error?: string; provider?: string; issues?: string[]; drafts?: typeof drafts; appliedInstruction?: string };
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error || "Rewrite failed"}`);
        output = body.text?.trim() || "";
        if (!output) throw new Error("No transformed text was returned.");
        if (!Array.isArray(body.issues) || !Array.isArray(body.drafts)) throw new Error("Missing server checks and draft evidence.");
        drafts = body.drafts;
        appliedInstruction = body.appliedInstruction || "";
        words = output.split(/\s+/).length;
        status = body.issues.length
          ? `FAIL: ${body.issues.join(" ")}`
          : `PASS: ${body.provider || "unknown"} returned ${words} words; automated checks passed`;
      } catch (error: any) {
        status = `FAIL: ${error?.message || String(error)}`;
      }
      records.push({ prompt, appliedInstruction, output, status, words, drafts });
      console.log(`Prompt ${index + 1}/10: ${status}`);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await mkdir("reports", { recursive: true });
    const rows = records.map((record, index) => `
      <section><h2>Prompt ${index + 1}: ${escapeHtml(record.status)}</h2>
       <p><strong>Instruction:</strong> ${escapeHtml(record.prompt)}</p>
       <p><strong>Applied style instruction:</strong> ${escapeHtml(record.appliedInstruction || "(unavailable)")}</p>
       <h3>Final output (${record.words} words)</h3><pre>${escapeHtml(record.output || "(No output)")}</pre>
       ${record.drafts.map((draft, attempt) => `<details><summary>Draft ${attempt + 1}: ${draft.words} words · ${escapeHtml(draft.provider)} · ${escapeHtml(draft.issues.join(" ") || "Checks passed")}</summary><pre>${escapeHtml(draft.text)}</pre></details>`).join("\n")}
       </section>`).join("\n");
    const report = `<!doctype html><html lang="en"><meta charset="utf-8">
      <title>Humanizer diagnostic — ten rewrite prompts</title>
      <style>body{font:16px/1.6 system-ui;max-width:900px;margin:40px auto;padding:0 20px;color:#17212d}
      section{border:1px solid #bdc9d4;border-radius:10px;padding:20px;margin:24px 0}
      pre{white-space:pre-wrap;font:16px/1.6 Georgia,serif}</style>
      <h1>Humanizer diagnostic — ten rewrite prompts</h1>
      <p>Box A: supplied document-overhaul text. Box D: supplied natural-law style sample.
      Each request asked for approximately 600 words. A pass requires 480–720 words and at least
       two central Box A terms and no detected style-sample subject terms; automated checks cannot prove substantive fidelity, so inspect each full result and all correction drafts.</p>
      <p>${records.filter((r) => r.status.startsWith("PASS")).length}/${records.length} passed.</p>
      ${rows}</html>`;
    await writeFile("reports/humanizer-diagnostic.html", report);
    console.log("Saved full evidence to reports/humanizer-diagnostic.html");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});