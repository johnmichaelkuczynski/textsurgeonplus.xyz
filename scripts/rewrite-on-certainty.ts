import { readFile, mkdir, writeFile, rename, readdir } from "node:fs/promises";
import { join } from "node:path";
import { callLLM } from "../server/llm";

const sourcePath = "attached_assets/0_ON_CERTAINTY_BY_WITTGENSTEIN_1790542245825.txt";
const stylePath = "attached_assets/0_Theoretical_Knowledge___Inductive_Inference_1790542268948.txt";
const outputDir = "outputs/on-certainty-rewrite";
const count = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const targetWords = 45_000;
const domain = process.env.REPLIT_DEV_DOMAIN;
if (!domain) throw new Error("The development-domain address is unavailable.");
const url = `https://${domain}/api/humanizer/rewrite`;
const source = await readFile(sourcePath, "utf8");
const style = await readFile(stylePath, "utf8");
const sourceWords = count(source);
const ratio = targetWords / sourceWords;
const segmentLength = Math.floor(style.length / 4);
const styleSample = [
  style.slice(1_000, 4_000),
  style.slice(segmentLength, segmentLength + 3_000),
  style.slice(segmentLength * 2, segmentLength * 2 + 3_000),
  style.slice(segmentLength * 3, segmentLength * 3 + 3_000),
].join("\n\n[STYLE EXCERPT]\n\n");

// Group entire paragraphs to retain the work's numbered entries and their order.
const paragraphs = source.split(/(?<=\n)\s*\n/).filter((p) => p.trim());
const chunks: string[] = [];
let current: string[] = [];
let words = 0;
for (const paragraph of paragraphs) {
  const next = count(paragraph);
  if (words + next > 1_300 && current.length) {
    chunks.push(current.join("\n\n"));
    current = [];
    words = 0;
  }
  current.push(paragraph.trim());
  words += next;
}
if (current.length) chunks.push(current.join("\n\n"));
if (count(chunks.join("\n\n")) !== sourceWords) throw new Error("The source lost words while splitting.");
await mkdir(outputDir, { recursive: true });
const publishLive = async (completed: number, finished: boolean) => {
  const sections = await Promise.all(Array.from({ length: completed }, (_, index) =>
    readFile(join(outputDir, `part-${String(index + 1).padStart(3, "0")}.txt`), "utf8")
  ));
  const text = sections.map((section) => section.trim()).join("\n\n");
  const textPath = join(outputDir, "live-output.txt");
  await writeFile(`${textPath}.tmp`, text + "\n");
  await rename(`${textPath}.tmp`, textPath);
  const statusPath = join(outputDir, "live-status.txt");
  await writeFile(`${statusPath}.tmp`, JSON.stringify({
    completed, total: chunks.length, words: count(text), finished,
    updatedAt: new Date().toISOString(),
  }));
  await rename(`${statusPath}.tmp`, statusPath);
};
const guidePath = join(outputDir, "style-guide.txt");
let styleGuide = "";
try {
  styleGuide = await readFile(guidePath, "utf8");
} catch {
  styleGuide = await callLLM("anthropic", `Analyze only the writing style of this sample. In no more than 150 words describe its syntax, rhythm, tone, explanatory structure, and rhetorical devices. Do not include the author's name, examples, factual claims, title, or topic-specific concepts. Return only reusable directions.\n\n${styleSample}`);
  await writeFile(guidePath, styleGuide);
}

const done = await readdir(outputDir);
let completedWords = 0;
let previousEnding = "";
const providers = new Set<string>();
for (let i = 0; i < chunks.length; i++) {
  const partPath = join(outputDir, `part-${String(i + 1).padStart(3, "0")}.txt`);
  const recordPath = partPath.replace(/\.txt$/, ".json");
  const sourceChunk = chunks[i];
  const partTarget = Math.min(1_950, Math.max(100, Math.round(count(sourceChunk) * ratio)));
  let record: {
    text: string; mainText: string; supplements: string[];
    provider: string; issues: string[]; fallbackReason?: string;
  } | null = null;
  if (done.includes(recordPath.split("/").at(-1)!)) {
    const saved = JSON.parse(await readFile(recordPath, "utf8"));
    if (saved.sourceWords === count(sourceChunk) && saved.provider === "anthropic" && saved.mainText?.trim()) record = saved;
  }
  if (!record) {
    const instructions = [
      `Produce approximately ${partTarget} words, expanding only the supplied passage's reasoning where the passage supports it.`,
      `This is passage ${i + 1} of ${chunks.length} of one continuous rewrite of On Certainty. Work through the ENTIRE supplied passage in order, including its ending. Preserve its philosophical subject, distinctions, examples, questions, and the section numbers actually present. Do not invent or renumber sections. Do not write a new introduction or conclusion at the passage boundary.`,
      "Follow the supplied sample's explanatory prose style, not its subject, propositions, terminology, headings, or examples. Do not attribute the source to the style-sample author.",
      "Avoid filler and repetition. Clarify the existing thought through precise exposition, not invented historical claims or examples.",
      previousEnding ? `For continuity only, the preceding rewritten passage ended: ${previousEnding.slice(-250)}. Do not repeat it.` : "",
    ].filter(Boolean).join("\n");
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: sourceChunk, provider: "anthropic", instructions, styleSample,
            styleInstructions: "Follow the sample's calm, precise, analytical explanatory cadence, explicit distinctions, and logical development. Never import its claims or topic.",
          }),
          signal: AbortSignal.timeout(300_000),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.text?.trim()) throw new Error(`HTTP ${response.status}: ${payload?.error || "No rewritten text"}`);
        record = {
          text: payload.text.trim(), mainText: payload.text.trim(), supplements: [],
          provider: String(payload.provider || "unknown"),
          issues: Array.isArray(payload.issues) ? payload.issues : [],
          fallbackReason: payload.fallbackReason,
        };
        break;
      } catch (error: any) {
        console.error(`Part ${i + 1}/${chunks.length} attempt ${attempt} failed: ${error?.message || error}`);
        if (attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
      }
    }
  }
  // The live route can return much less than requested. Add grounded explanatory
  // prose rather than passing off a short draft as the requested long rewrite.
  while (count(record!.text) < Math.round(partTarget * 0.96) && record!.supplements.length < 3) {
    const missing = partTarget - count(record!.text);
    const requested = Math.min(600, Math.max(180, missing));
    const addition = await callLLM("anthropic", `Write approximately ${requested} words of ADDITIONAL prose to follow the existing rewrite of this passage from On Certainty. Continue with SOURCE material not yet developed in the rewrite, in the source's order. This prose must be part of the rewrite, not a review of it. Preserve the source's terminology; never invent a historical fact, a new example, a new doctrine, or material from the style sample. Do not repeat existing phrasing or cover already explained points. Do not start sentences with labels such as "Explanation:", "Summary:", "Distinction:", or "Logical structure:". No heading, preamble, section label, or word count. Return ONLY the added prose.

WRITING STYLE (never use its topic as material):
${styleGuide}

AUTHORITATIVE SOURCE PASSAGE:
${sourceChunk}

ALREADY WRITTEN PROSE — DO NOT REPEAT:
${record!.text}`);
    if (count(addition) < 70) throw new Error(`Supplement for part ${i + 1} was too short.`);
    record!.supplements.push(addition.trim());
    record!.text = [record!.mainText, ...record!.supplements].join("\n\n");
    await writeFile(`${recordPath}.tmp`, JSON.stringify({ ...record, sourceWords: count(sourceChunk), targetWords: partTarget }, null, 2));
    await rename(`${recordPath}.tmp`, recordPath);
    console.log(`Expanded ${i + 1}/${chunks.length}: ${count(record!.text)}/${partTarget} words`);
  }
  for (let compression = 0; compression < 1 && count(record!.text) > Math.round(partTarget * 1.25); compression++) {
    const revised = await callLLM("anthropic", `Condense the following rewrite of a passage from On Certainty to approximately ${Math.round(partTarget * 0.96)} words. Preserve the order and every distinct claim, source example, question, and philosophical distinction across the WHOLE source passage. Remove repetition and redundant explanations, never unique material. Follow the source's numbered progression without inventing new numbers. Write connected analytical prose in the provided draft's style; remove metacommentary labels such as "Explanation:", "Summary:", or "Logical structure:". Return only the COMPLETE condensed rewrite, with no commentary about its length.

AUTHORITATIVE SOURCE:
${sourceChunk}

DRAFT:
${record!.text}`);
    if (count(revised) < Math.round(partTarget * 0.70)) throw new Error(`Condensing part ${i + 1} omitted too much of the passage.`);
    record!.text = revised.trim();
    record!.mainText = revised.trim();
    record!.supplements = [];
    await writeFile(`${recordPath}.tmp`, JSON.stringify({ ...record, sourceWords: count(sourceChunk), targetWords: partTarget }, null, 2));
    await rename(`${recordPath}.tmp`, recordPath);
    console.log(`Condensed ${i + 1}/${chunks.length}: ${count(record!.text)}/${partTarget} words`);
  }
  if (count(record!.text) < Math.round(partTarget * 0.90)) {
    const missing = partTarget - count(record!.text);
    const addition = await callLLM("anthropic", `Write approximately ${Math.max(150, Math.round(missing * 0.7))} words continuing this rewrite of On Certainty. Elaborate source distinctions that the current draft has compressed or missed, using only the supplied source. Do not repeat what is already said. Continue as connected prose; no commentary, labels, new examples, or headings. Return only the additional prose.

SOURCE:
${sourceChunk}

EXISTING REWRITE:
${record!.text}`);
    record!.supplements.push(addition.trim());
    record!.text = [record!.mainText, ...record!.supplements].join("\n\n");
    console.log(`Restored ${i + 1}/${chunks.length}: ${count(record!.text)}/${partTarget} words`);
  }
  if (count(record!.text) < Math.round(partTarget * 0.82)) {
    throw new Error(`Part ${i + 1} remains too short (${count(record!.text)}/${partTarget} words); saved drafts can be resumed.`);
  }
  await writeFile(`${recordPath}.tmp`, JSON.stringify({ ...record, sourceWords: count(sourceChunk), targetWords: partTarget }, null, 2));
  await rename(`${recordPath}.tmp`, recordPath);
  await writeFile(partPath, record!.text + "\n");
  completedWords += count(record!.text);
  previousEnding = record!.text.slice(-300);
  providers.add(record!.provider);
  await publishLive(i + 1, false);
  console.log(`Completed ${i + 1}/${chunks.length}: ${count(record!.text)} words; total ${completedWords}; provider ${record!.provider}; issues ${record!.issues.length}${record!.fallbackReason ? "; fallback" : ""}`);
}

const finalText = (await Promise.all(chunks.map((_, i) =>
  readFile(join(outputDir, `part-${String(i + 1).padStart(3, "0")}.txt`), "utf8")
))).map((part) => part.trim()).join("\n\n");
await writeFile(join(outputDir, "On-Certainty-transformed.txt"), finalText + "\n");
await writeFile(join(outputDir, "manifest.json"), JSON.stringify({
  sourcePath, stylePath, sourceWords, targetWords, generatedWords: count(finalText),
  parts: chunks.length, providers: [...providers],
}, null, 2));
if (count(finalText) < 45_000) throw new Error(`Generated only ${count(finalText)} words; not delivering an undersized result.`);
await publishLive(chunks.length, true);
console.log(`FINAL: ${count(finalText)} words; ${chunks.length} parts; providers ${[...providers].join(", ")}`);