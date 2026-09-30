import { callLLM } from "../llm";
import { buildTractatusTree, type TractatusStatement } from "./tractatusTree";

export type FreshTreeStatement = TractatusStatement;

const onlySource = "Use only concepts, claims, and examples that appear in the text supplied below. Do not add material from any other source.";
const freshRules = `Each third-tier line must be a concrete example or fact that illustrates or supports its parent claim.
It must be FRESH: do not use any example, name, case, or illustration that appears in the source text below. The source text is provided only so you can avoid repeating it.
Prefer real, accurate, current scientific or factual examples. Everyday examples are allowed. Do not invent fake facts.
One sentence per line. No commentary.`;
const fourthRules = freshRules.replace("third-tier", "fourth-tier");

function parseMappedExamples(
  raw: string, parents: FreshTreeStatement[], depth: number, maxPerParent: number,
): FreshTreeStatement[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`Tier-${depth + 1} examples were not structured by parent claim.`);
  const parsed = JSON.parse(raw.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      Object.keys(parsed).length !== parents.length ||
      Object.keys(parsed).some((key) => !parents.some((parent) => parent.number === key))) {
    throw new Error(`Tier-${depth + 1} examples did not match the parent claims.`);
  }
  return parents.flatMap((parent) => {
    const value = parsed[parent.number];
    const lines = typeof value === "string" ? [value] : value;
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > maxPerParent ||
        lines.some((line) => typeof line !== "string" || !line.trim())) {
      throw new Error(`Missing or invalid detail for ${parent.number}.`);
    }
    return lines.map((line: string, index: number) => ({
      number: `${parent.number}.${index + 1}`, text: line.trim(), depth,
    }));
  });
}

function parseSourceTiers(raw: string, source: string): FreshTreeStatement[] {
  const statements: FreshTreeStatement[] = [];
  const normalize = (value: string) => value.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ");
  const original = normalize(source);
  for (const line of raw.split("\n")) {
    if (!line.trim() || /^```/.test(line.trim())) continue;
    const match = /^\s*(\d+)\.(0|[1-9]\d*)\s+(.+?)\s+\|\|\s+["“]?(.+?)["”]?\s*$/.exec(line);
    if (!match) throw new Error(`Source-only tree returned an invalid line: ${line.slice(0, 120)}`);
    const excerpt = match[4].replace(/["”]+$/, "").trim();
    if (!excerpt || !original.includes(normalize(excerpt))) {
      throw new Error(`Source-only proposition ${match[1]}.${match[2]} lacks a matching source excerpt.`);
    }
    statements.push({ number: `${match[1]}.${match[2]}`, text: match[3].trim(), depth: match[2] === "0" ? 0 : 1 });
  }
  const roots = new Set(statements.filter((s) => s.depth === 0).map((s) => s.number.split(".")[0]));
  const children = statements.filter((s) => s.depth === 1);
  if (!roots.size || !children.length || children.some((s) => !roots.has(s.number.split(".")[0])) ||
      new Set(statements.map((s) => s.number)).size !== statements.length) {
    throw new Error("Source-only tree must contain unique top theses with supporting sub-claims.");
  }
  return statements;
}

function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) throw new Error("Fresh Tree generation cancelled.");
}

export async function generateFreshTree(
  source: string,
  signal: AbortSignal,
  onThesis: (statements: FreshTreeStatement[]) => void,
): Promise<FreshTreeStatement[]> {
  assertNotAborted(signal);
  const prompt = `Build a Tractatus tree from this text with EXACTLY TWO TIERS: 1.0, 2.0 ... top theses and 1.1, 1.2, 2.1 ... sub-claims. Never write 1.1.1 or deeper. Give every top thesis at least one sub-claim. For each line append " || " and a contiguous character-for-character quote copied from the input supporting that particular claim; even a short quote is acceptable. Do not paraphrase or invent quotes. No other text.
${onlySource}
<source>
${source}
</source>`;
  let first = await callLLM("openai", prompt, signal);
  assertNotAborted(signal);
  let sourceTiers: FreshTreeStatement[];
  try {
    sourceTiers = parseSourceTiers(first, source);
  } catch {
    assertNotAborted(signal);
    first = await callLLM("openai", `${prompt}\nIMPORTANT: For EVERY line, copy the supporting excerpt exactly from the text between the source tags. Reject any candidate quote that does not occur verbatim.`, signal);
    assertNotAborted(signal);
    sourceTiers = parseSourceTiers(first, source);
  }
  if (buildTractatusTree(sourceTiers).maxDepth !== 1) {
    throw new Error("Source-only tree did not contain exactly two tiers.");
  }
  for (const root of sourceTiers.filter((s) => s.depth === 0)) {
    const prefix = `${root.number.split(".")[0]}.`;
    if (sourceTiers.some((s) => s.depth === 1 && s.number.startsWith(prefix))) continue;
    assertNotAborted(signal);
    const missing = await callLLM("openai", `Write exactly one source-grounded direct sub-claim for this top thesis, on one line beginning ${prefix}1, followed by " || " and an exact supporting quote from the source. No additional text.
${onlySource}
Top thesis: ${root.number} ${root.text}
<source>
${source}
</source>`, signal);
    assertNotAborted(signal);
    const match = new RegExp(`^\\s*${prefix.replace(".", "\\.")}1\\s+(.+?)\\s+\\|\\|\\s+["“]?(.+?)["”]?\\s*$`, "m").exec(missing);
    const excerpt = match?.[2]?.replace(/["”]+$/, "").trim();
    if (!match || !excerpt || !source.toLowerCase().replace(/\s+/g, " ").includes(excerpt.toLowerCase().replace(/\s+/g, " "))) {
      throw new Error(`Could not ground a sub-claim beneath ${root.number} in the supplied text.`);
    }
    sourceTiers.push({ number: `${prefix}1`, text: match[1].trim(), depth: 1 });
  }
  const result: FreshTreeStatement[] = [];
  const roots = sourceTiers.filter((s) => s.depth === 0);
  for (const root of roots) {
    assertNotAborted(signal);
    const children = sourceTiers.filter((s) => s.depth === 1 && s.number.startsWith(`${root.number.split(".")[0]}.`));
    if (!children.length) throw new Error(`No sub-claims for ${root.number}.`);
    const second = await callLLM("openai", `For each sub-claim below, write 1 or 2 concrete third-tier examples. Return ONLY a JSON object: each exact sub-claim number is a key, and its value is an array of 1 or 2 one-sentence strings. Include every listed key exactly once. Do not add prose, a numbered list, or Markdown. Do not paraphrase the source as an example: give a genuinely different supporting case or observation instead.
${freshRules}
Claims:
${children.map((s) => `${s.number} ${s.text}`).join("\n")}
Source text (exclusion reference ONLY):
<source>
${source}
</source>`, signal);
    assertNotAborted(signal);
    const additions = parseMappedExamples(second, children, 2, 2);
    const thesis = [root, ...children.flatMap((child) =>
      [child, ...additions.filter((s) => s.number.startsWith(`${child.number}.`))])];
    result.push(...thesis);
    onThesis(thesis);
  }
  return result;
}

export async function addFourthTier(
  source: string,
  statements: FreshTreeStatement[],
  signal: AbortSignal,
  onThesis: (additions: FreshTreeStatement[]) => void,
): Promise<FreshTreeStatement[]> {
  const thirds = statements.filter((s) => s.depth === 2);
  if (!thirds.length || statements.some((s) => s.depth === 3)) throw new Error("A completed three-tier tree is required.");
  const result: FreshTreeStatement[] = [];
  for (const root of statements.filter((s) => s.depth === 0)) {
    assertNotAborted(signal);
    const group = thirds.filter((s) => s.number.startsWith(`${root.number.split(".")[0]}.`));
    const response = await callLLM("openai", `Write exactly ONE new fourth-tier supporting detail for each third-tier line below. Return ONLY a JSON object: each exact third-tier number is a key and its value is an array containing exactly one one-sentence string. Include every listed key exactly once. Do not add prose, a numbered list, or Markdown. Each detail must be concrete, accurate, and fresh, not mentioned in the source or earlier lines. Do not invent facts.
${fourthRules}
Third-tier lines:
${group.map((s) => `${s.number} ${s.text}`).join("\n")}
Source text (exclusion reference ONLY):
<source>
${source}
</source>`, signal);
    assertNotAborted(signal);
    const additions = parseMappedExamples(response, group, 3, 1);
    result.push(...additions);
    onThesis(additions);
  }
  return result;
}
