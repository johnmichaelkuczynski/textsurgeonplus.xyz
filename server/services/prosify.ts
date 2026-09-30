import { callLLM } from "../llm";

export const PROSIFY_RULES = `Convert this Tractatus tree into prose.
1. Include every node. Omit nothing.
2. Add nothing: no new claims, examples, facts, qualifications, or commentary.
3. Follow the tree's order: each thesis (1.0, 2.0 ...) begins a new paragraph; its sub-claims and their children follow in order.
4. Add only the minimal connective words needed to make the numbered lines read as an argument (e.g. because, so, therefore, for example, thus, but).
5. No introductions, no transitions between paragraphs, no summaries, no conclusions, no rhetorical flourishes, no restatement.
6. Do not include node numbers in the prose.
7. Keep each node's wording as close to the original as grammar allows.
8. Be as concise as possible. The prose must not be substantially longer than the tree.`;

export type ProsifyUnit = { chapter?: string; thesis: string; tree: string; nodeNumbers: string[] };

export function splitProsifyTree(input: string): ProsifyUnit[] {
  const units: ProsifyUnit[] = [];
  let chapter: string | undefined;
  let current: ProsifyUnit | undefined;
  let inSources = false;
  for (const raw of input.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^CHAPTER\s+[^:]+:/i.test(line)) {
      chapter = line;
      current = undefined;
      inSources = false;
      continue;
    }
    if (/^Sources$/i.test(line)) { inSources = true; current = undefined; continue; }
    if (inSources) continue;
    const match = /^(\d+(?:\.\d+)+)\s+(.+)$/.exec(line);
    if (!match) continue;
    const root = match[1].split(".")[0];
    if (!current || current.thesis !== root || current.chapter !== chapter) {
      current = { chapter, thesis: root, tree: "", nodeNumbers: [] };
      units.push(current);
    }
    current.tree += `${current.tree ? "\n" : ""}${match[1]} ${match[2]}`;
    current.nodeNumbers.push(match[1]);
  }
  return units;
}

const STOP_WORDS = new Set("a an and are as at be because been being but by for from had has have he her hers him his i if in into is it its of on or our she so than that the their them then there these they this those to was were will with would you your therefore thus example".split(" "));

function normalizedWords(value: string): Set<string> {
  const tokens = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return new Set(tokens.filter((word) => word.length > 2 && !STOP_WORDS.has(word)).map((word) =>
    word.replace(/(ing|edly|edly|ed|es|s)$/i, "")));
}

export function missingNodes(tree: string, prose: string): string[] {
  const proseWords = normalizedWords(prose);
  const missing: string[] = [];
  for (const line of tree.split("\n")) {
    const match = /^(\d+(?:\.\d+)+)\s+(.+)$/.exec(line.trim());
    if (!match) continue;
    const keywords = [...normalizedWords(match[2])];
    if (keywords.some((word) => !proseWords.has(word))) missing.push(match[1]);
  }
  return missing;
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function cleanProse(value: string): string {
  const prose = value.trim();
  if (!prose || /<html[\s>]/i.test(prose) || /^```|^\s*[\[{]/.test(prose)) {
    throw new Error("The model returned a non-prose response.");
  }
  return prose;
}

function stripNodeNumbers(prose: string, nodeNumbers: string): string {
  const numbers = nodeNumbers.split("\n").map((line) => line.split(/\s+/, 1)[0]).filter(Boolean);
  return numbers.reduce((text, number) => text.replace(
    new RegExp(`(^|\\s)${number.replace(/\./g, "\\.")}(?=\\s)`, "g"), "$1"), prose).replace(/\s{2,}/g, " ").trim();
}

function promptFor(tree: string, instructions: string, extra = ""): string {
  const special = instructions.trim() ? `\n\nThe user's special instructions follow. Where they conflict with the rules above, the user's instructions take precedence:\n${instructions.trim()}` : "";
  return `${PROSIFY_RULES}${special}${extra ? `\n\n${extra}` : ""}\n\nTREE:\n${tree}\n\nReturn only the prose paragraph. No heading, node numbers, notes, or commentary.`;
}

export async function prosifyUnit(unit: ProsifyUnit, instructions: string, signal: AbortSignal) {
  signal.throwIfAborted();
  let prose = cleanProse(await callLLM("openai", promptFor(unit.tree, instructions), signal));
  if (instructions.trim()) return { prose, missing: [] as string[] };
  prose = stripNodeNumbers(prose, unit.tree);

  let missing = missingNodes(unit.tree, prose);
  if (missing.length) {
    prose = stripNodeNumbers(cleanProse(await callLLM("openai", promptFor(unit.tree, "",
      `The previous attempt omitted nodes ${missing.join(", ")}. Regenerate once and include every node while adding nothing.`), signal)), unit.tree);
    missing = missingNodes(unit.tree, prose);
  }
  if (wordCount(prose) > wordCount(unit.tree) * 1.3) {
    prose = stripNodeNumbers(cleanProse(await callLLM("openai", promptFor(unit.tree, "",
      "Shorter. Remove every word not required for grammar or the logical connection. Include every node."), signal)), unit.tree);
    missing = missingNodes(unit.tree, prose);
  }
  return { prose, missing };
}
