import { callLLM } from "../llm";
import type { TractatusStatement } from "./tractatusTree";

export type FreshTreeStatement = TractatusStatement;
export type FreshTreeSource = { node: string; url: string };
type TierCandidate = FreshTreeStatement & { parent: string; url?: string };

export const DEFAULT_FRESH_INSTRUCTIONS = "Under each node, add 1 or 2 child nodes. Each must be a concrete example or fact that illustrates or supports its parent. It must be FRESH: do not use any example, name, case, or illustration from the source text. Prefer real, accurate, current scientific or factual examples; everyday examples are allowed; do not invent fake facts. One sentence per node. No commentary.";

function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) throw new Error("Fresh Tree generation cancelled.");
}

/** Parse numbered prose defensively and discard every level deeper than requested. */
export function parseTreeLines(raw: string, maximumParts: number): FreshTreeStatement[] {
  const result: FreshTreeStatement[] = [];
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    const match = /^\s*(\d+(?:\.\d+)+)\s+(.+?)\s*$/.exec(line.replace(/^[-*]\s*/, ""));
    if (!match) continue;
    const parts = match[1].split(".");
    if (parts.length > maximumParts || parts.length < 2 || seen.has(match[1])) continue;
    if (parts.length === 2 && parts[1] !== "0" && !result.some((item) => item.number === `${parts[0]}.0`)) continue;
    seen.add(match[1]);
    const depth = parts.length === 2 ? (parts[1] === "0" ? 0 : 1) : parts.length - 1;
    result.push({ number: match[1], text: match[2].trim(), depth });
  }
  return result;
}

export async function generateFreshTree(source: string, signal: AbortSignal): Promise<FreshTreeStatement[]> {
  assertNotAborted(signal);
  const required = "Produce only top-level theses (1.0, 2.0 ...) and their direct sub-claims (1.1, 1.2 ...). Do not produce any deeper level. Use only concepts, claims, and examples that appear in the text supplied below. Do not add material from any other source.";
  const raw = await callLLM("openai", `Build a plain numbered tree. ${required}\nEvery thesis must have at least one direct sub-claim. Output numbered lines only, with one sentence per line. Do not use Markdown.\n\n<source>\n${source}\n</source>`, signal);
  assertNotAborted(signal);
  const statements = parseTreeLines(raw, 2);
  const roots = statements.filter((item) => item.number.endsWith(".0"));
  if (!roots.length || roots.some((root) => !statements.some((item) => item.number.startsWith(`${root.number.slice(0, -1)}`) && item.number !== root.number))) {
    throw new Error("The model did not return a valid two-tier tree.");
  }
  return statements;
}

function responseText(data: any): string {
  if (typeof data?.output_text === "string") return data.output_text;
  return (data?.output || []).flatMap((item: any) => item?.content || [])
    .filter((item: any) => item?.type === "output_text" && typeof item.text === "string")
    .map((item: any) => item.text).join("\n");
}

async function research(prompt: string, signal: AbortSignal): Promise<{ text: string; searched: boolean }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { text: await callLLM("openai", prompt, signal), searched: false };
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-4o", tools: [{ type: "web_search_preview" }], input: prompt }),
    });
    if (!response.ok) throw new Error(`web search returned ${response.status}`);
    const text = responseText(await response.json());
    if (!text.trim()) throw new Error("web search returned no text");
    return { text, searched: true };
  } catch (error) {
    if (signal.aborted) throw error;
    return { text: await callLLM("openai", prompt, signal), searched: false };
  }
}

const REPUTABLE_HOSTS = [
  "bbc.com", "cell.com", "doi.org", "jamanetwork.com", "nationalgeographic.com", "nature.com",
  "ncbi.nlm.nih.gov", "newscientist.com", "noaa.gov", "nasa.gov", "pnas.org", "sciencemag.org",
  "scientificamerican.com", "science.org", "springer.com", "thelancet.com", "who.int", "wiley.com",
];

function isReputableSource(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return hostname.endsWith(".gov") || hostname.endsWith(".edu") || hostname.endsWith(".ac.uk") ||
      REPUTABLE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function words(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
}

/** Percentage of the proposed node's words that already occur in another line. */
export function wordOverlap(proposed: string, comparison: string): number {
  const proposedWords = words(proposed);
  if (!proposedWords.size) return 1;
  const comparisonWords = words(comparison);
  let shared = 0;
  proposedWords.forEach((word) => { if (comparisonWords.has(word)) shared++; });
  return shared / proposedWords.size;
}

function duplicatesAny(candidate: TierCandidate, lines: Array<{ text: string }>): boolean {
  return lines.some((line) => wordOverlap(candidate.text, line.text) > 0.6);
}

function parseTier(raw: string, parents: FreshTreeStatement[], depth: number): TierCandidate[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`Tier ${depth} returned invalid structured output.`);
  const parsed = JSON.parse(raw.slice(start, end + 1));
  const statements: TierCandidate[] = [];
  for (const parent of parents) {
    const children = parsed[parent.number];
    if (!Array.isArray(children) || children.length < 1 || children.length > 2) throw new Error(`Tier ${depth} is missing children for ${parent.number}.`);
    children.forEach((child: any, index: number) => {
      if (typeof child?.text !== "string" || !child.text.trim()) throw new Error(`Tier ${depth} contains an invalid child for ${parent.number}.`);
      const number = `${parent.number}.${index + 1}`;
      statements.push({ number, parent: parent.number, text: child.text.trim(), depth: depth - 1,
        url: isReputableSource(child.url) ? child.url : undefined });
    });
  }
  return statements;
}

async function reviewAndDeduplicate(candidates: TierCandidate[], existing: FreshTreeStatement[], researchResult: string,
  source: string, signal: AbortSignal): Promise<TierCandidate[]> {
  const duplicateNumbers = candidates.filter((candidate, index) =>
    duplicatesAny(candidate, [...existing, ...candidates.slice(0, index)])).map((candidate) => candidate.number);
  const prompt = `Review proposed child nodes. Return ONLY a JSON object keyed by every exact node number, shaped {"1.1.1":{"text":"one sentence","directSupport":true}}.
- directSupport is true only when the node directly supports its IMMEDIATE parent's specific claim; otherwise false.
- For these code-detected duplicates, regenerate the text ONCE: ${duplicateNumbers.join(", ") || "none"}.
- A regenerated node must use a concrete fact already present in the WEB RESEARCH RESULT and must retain the candidate's meaning and source; do not introduce an unsupported fact.
- Leave every nonduplicate node's text exactly unchanged.
- Every node must add specific new information: a named study, experiment, case, number, mechanism, place, or person.
- A restatement or paraphrase of its parent or any tree line is forbidden. Never say merely "a study found"; name the study, researchers, or case.

PARENTS AND PROPOSED CHILDREN:
${candidates.map((item) => `${item.parent} ${existing.find((line) => line.number === item.parent)?.text}\n${item.number} ${item.text}`).join("\n")}

FULL EXISTING TREE:
${existing.map((item) => `${item.number} ${item.text}`).join("\n")}

WEB RESEARCH RESULT (the only factual material allowed for rewrites):
${researchResult}

SOURCE TEXT (freshness exclusion list):
${source}`;
  const reviewedRaw = await callLLM("openai", prompt, signal);
  const start = reviewedRaw.indexOf("{");
  const end = reviewedRaw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Fresh-tier review returned invalid structured output.");
  const reviewed = JSON.parse(reviewedRaw.slice(start, end + 1));
  const accepted: TierCandidate[] = [];
  for (const candidate of candidates) {
    const result = reviewed[candidate.number];
    if (!result || result.directSupport !== true || typeof result.text !== "string" || !result.text.trim()) continue;
    const wasDuplicate = duplicateNumbers.includes(candidate.number);
    const updated = { ...candidate, text: wasDuplicate ? result.text.trim() : candidate.text };
    // This is the required post-regeneration code gate. A second duplicate is dropped, not retried.
    if (duplicatesAny(updated, [...existing, ...accepted])) continue;
    accepted.push(updated);
  }
  return accepted;
}

export async function addNextTier(source: string, existing: FreshTreeStatement[], instructions: string, signal: AbortSignal,
  onThesis: (statements: FreshTreeStatement[], sources: FreshTreeSource[]) => void) {
  const deepest = Math.max(...existing.map((item) => item.depth));
  const nextDepth = deepest + 2;
  const parents = existing.filter((item) => item.depth === deepest);
  if (!parents.length) throw new Error("The existing tree has no deepest-tier nodes.");
  for (const root of existing.filter((item) => item.number.endsWith(".0"))) {
    assertNotAborted(signal);
    const prefix = root.number.split(".")[0] + ".";
    const group = parents.filter((item) => item.number.startsWith(prefix));
    if (!group.length) continue;
    const prompt = `Search exactly once for this top-level thesis. Build focused search queries from EACH immediate parent's complete, specific claim—not generic topic words—then add exactly one new tier. Follow the user's instructions. Return ONLY a JSON object keyed by every exact parent number. Each value is an array of 1 or 2 objects shaped {"text":"one sentence","url":"direct supporting source URL"}. Include every parent exactly once. Do not put links in text.

Every node must add NEW, SPECIFIC information beyond its parent: a named study, experiment, case, number, mechanism, place, or person. It must directly support its IMMEDIATE parent's specific claim. A restatement or paraphrase of its parent or any other tree line is forbidden. "Current" means scientifically up to date and not superseded, not merely recent; classic and recent findings are allowed. Never write "a study found": name the study, researchers, or case. Prefer vivid, memorable, concrete cases over generic summaries.

Use only primary or reputable sources: journals, universities, government agencies, or major science outlets. Never use career sites, content farms, or pop-psychology explainer sites. Confirm that each source's date and content match the node's claim.

USER INSTRUCTIONS:
${instructions.trim() || DEFAULT_FRESH_INSTRUCTIONS}

FULL EXISTING TREE (do not alter it):
${existing.map((item) => `${item.number} ${item.text}`).join("\n")}

PARENTS FOR THIS CALL:
${group.map((item) => `${item.number} ${item.text}`).join("\n")}

SOURCE TEXT (reference and freshness exclusion list):
<source>
${source}
</source>`;
    const answer = await research(prompt, signal);
    const parsed = parseTier(answer.text, group, nextDepth);
    const accepted = await reviewAndDeduplicate(parsed, existing, answer.text, source, signal);
    const statements = accepted.map(({ parent: _parent, url, ...statement }) => ({ ...statement,
      text: `${statement.text}${answer.searched && url ? "" : " [unverified]"}` }));
    const sources = answer.searched ? accepted.filter((item) => item.url).map((item) => ({ node: item.number, url: item.url! })) : [];
    onThesis(statements, sources);
  }
}
