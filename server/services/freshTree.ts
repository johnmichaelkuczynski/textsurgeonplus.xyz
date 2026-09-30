import { callLLM } from "../llm";
import type { TractatusStatement } from "./tractatusTree";

export type FreshTreeStatement = TractatusStatement;
export type FreshTreeSource = { node: string; url: string };

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

function parseTier(raw: string, parents: FreshTreeStatement[], depth: number, verified: boolean) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`Tier ${depth} returned invalid structured output.`);
  const parsed = JSON.parse(raw.slice(start, end + 1));
  const statements: FreshTreeStatement[] = [];
  const sources: FreshTreeSource[] = [];
  for (const parent of parents) {
    const children = parsed[parent.number];
    if (!Array.isArray(children) || children.length < 1 || children.length > 2) throw new Error(`Tier ${depth} is missing children for ${parent.number}.`);
    children.forEach((child: any, index: number) => {
      if (typeof child?.text !== "string" || !child.text.trim()) throw new Error(`Tier ${depth} contains an invalid child for ${parent.number}.`);
      const number = `${parent.number}.${index + 1}`;
      const hasSource = verified && typeof child.url === "string" && /^https?:\/\//.test(child.url);
      statements.push({ number, text: `${child.text.trim()}${hasSource ? "" : " [unverified]"}`, depth: depth - 1 });
      if (hasSource) sources.push({ node: number, url: child.url });
    });
  }
  return { statements, sources };
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
    const prompt = `Add exactly one new tier beneath the listed parent nodes. Follow the user's instructions. Return ONLY a JSON object keyed by every exact parent number. Each value is an array of 1 or 2 objects shaped {"text":"one sentence","url":"direct supporting source URL"}. Include every parent exactly once. Do not put links in text. Use web research for accurate, current factual claims.\n\nUSER INSTRUCTIONS:\n${instructions.trim() || DEFAULT_FRESH_INSTRUCTIONS}\n\nFULL EXISTING TREE (do not alter it):\n${existing.map((item) => `${item.number} ${item.text}`).join("\n")}\n\nPARENTS FOR THIS CALL:\n${group.map((item) => `${item.number} ${item.text}`).join("\n")}\n\nSOURCE TEXT (reference and freshness exclusion list):\n<source>\n${source}\n</source>`;
    const answer = await research(prompt, signal);
    const additions = parseTier(answer.text, group, nextDepth, answer.searched);
    onThesis(additions.statements, additions.sources);
  }
}
