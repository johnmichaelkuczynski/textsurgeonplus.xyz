import { callLLM } from "../llm";
import { coverageFor, partitionBookText, type BookCoverage, type BookSourcePart } from "./bookDatabaseCoverage";
import { assessWholeBook, crossSegmentRepetition } from "./bookDatabaseAssessment";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CleanedNode {
  source?: BookSourcePart;
  id: string;
  number: string;
  claim: string;
  type: "core" | "supporting" | "doctrinal";
  depth: number;
  parentId?: string | null;
}

export interface BookPosition {
  source?: BookSourcePart;
  id: string;
  claim: string;
  type: "core" | "supporting" | "doctrinal";
  level: number;
  parentId?: string | null;
  confidence: number;
}

export interface BookQuote {
  source?: BookSourcePart;
  id: string;
  text: string;
  signalStrength: number;
  whyHighSignal: string;
  relatedPositionIds: string[];
}

export interface BookArgument {
  source?: BookSourcePart;
  id: string;
  premises: string[];
  conclusion: string;
  relatedPositionIds: string[];
}

export interface ConceptCluster {
  source?: BookSourcePart;
  id: string;
  label: string;
  description: string;
  relatedPositionIds: string[];
  relatedQuoteIds: string[];
}

export interface BookIntelligence {
  overallScore: number;
  claimDensity: number;
  conceptualCompression: number;
  redundancyScore: number;
  fillerRatio: number;
  fractalScore: number;
  qualitativeAssessment: string;
}

export interface StylometricThumbprint {
  signaturePhrases: string[];
  abstractionLevel: string;
  sentenceRhythmNotes: string;
  notableStylisticTraits: string[];
}

export interface BookDatabase {
  meta: {
    title?: string;
    author?: string;
    wordCount: number;
    processedAt: string;
    provider: string;
    coverage?: BookCoverage;
  };
  cleanedTree: CleanedNode[];
  positions: BookPosition[];
  quotes: BookQuote[];
  arguments: BookArgument[];
  conceptClusters: ConceptCluster[];
  intelligence: BookIntelligence;
  stylometricThumbprint: StylometricThumbprint;
}

// ── Helper: call LLM + parse JSON ────────────────────────────────────────────

async function callLLMJSON(provider: string, prompt: string, model: typeof callLLM, signal?: AbortSignal): Promise<any> {
  const raw = await model(provider, prompt, signal);
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = Math.min(
    candidate.indexOf('{') === -1 ? Infinity : candidate.indexOf('{'),
    candidate.indexOf('[') === -1 ? Infinity : candidate.indexOf('[')
  );
  const lastBrace = candidate.lastIndexOf('}');
  const lastBracket = candidate.lastIndexOf(']');
  const end = Math.max(lastBrace, lastBracket) + 1;
  if (start === Infinity || end <= 0) throw new Error("No JSON found in LLM response");
  return JSON.parse(candidate.slice(start, end));
}

// Prefer Anthropic for cleaning/discrimination stages when key is available
function cleaningProvider(userProvider: string): string {
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : userProvider;
}

// ── Stage A: Generate raw Tractatus Tree 2.0 ─────────────────────────────────

async function generateRawTree(text: string, provider: string, wordCount: number, model: typeof callLLM, signal?: AbortSignal): Promise<string> {
  const topLevelCount = wordCount < 150 ? 1 : Math.max(3, Math.min(10, Math.ceil(wordCount / 400)));
  const prompt = `Convert this text into a Tractatus-style hierarchical numbered proposition tree.

TEXT:
"""
${text}
"""

CRITICAL RULES:
0. Use ONLY the quoted TEXT for substance. If this is one chapter of a larger book, do not import ideas from other chapters, web results, prior runs, or general knowledge of the book.
1. Only declarative propositions — no promissory or structural statements
2. REJECT: "I will argue", "This paper examines", "The study is divided", "Chapter X discusses"
3. ACCEPT: "X causes Y", "The central claim is Z", "Determinism entails P", "Language acquisition requires Q"
4. Level 1 = the strongest, most central theses (produce at least ${topLevelCount} top-level nodes)
5. Deeper levels = genuine conceptual expansion, not repetition
6. Use at least 3 levels of depth where the source supports it, ideally 4-5 for rich texts; never invent content or padding to force depth in a short segment.
7. Every proposition must stand alone as a meaningful claim
8. Read the ENTIRE supplied segment, including its middle and end. Represent every substantive argument and distinct theme; do not analyze only the opening.

FORMAT:
1.0 [Central thesis]
1.1 [Direct elaboration]
1.1.1 [Specific specification]
1.2 [Second elaboration of 1.0]
2.0 [Second major thesis]
...

Generate the tree now:`;

  return model(provider, prompt, signal);
}

// ── Stage B: Aggressive Cleaning Pass ────────────────────────────────────────

function parseRawFallback(rawTree: string): CleanedNode[] {
  const lines = rawTree.split('\n').filter(l => l.trim());
  const nodes: CleanedNode[] = [];
  let idx = 0;
  const idMap: Record<string, string> = {};

  for (const line of lines) {
    const match = line.match(/^[•\-\*]?\s*(\d+(?:\.\d+)*)\s*[\.:\-]?\s*(.+)$/);
    if (!match) continue;
    const numStr = match[1];
    const parts = numStr.split('.');
    const depth = parts.length - 1 - (parts[parts.length - 1] === '0' ? 1 : 0);
    const parentNum = parts.slice(0, -1).join('.');
    const id = `n${++idx}`;
    idMap[numStr] = id;

    nodes.push({
      id,
      number: numStr,
      claim: match[2].trim(),
      type: depth === 0 ? "core" : "supporting",
      depth: Math.max(0, depth),
      parentId: idMap[parentNum] || null,
    });
  }
  return nodes;
}

async function runCleaningPass(rawTree: string, userProvider: string, model: typeof callLLM, signal?: AbortSignal): Promise<CleanedNode[]> {
  const cp = cleaningProvider(userProvider);

  const prompt = `You are an aggressive intellectual editor. Transform this raw Tractatus tree into a high-signal intellectual skeleton.

RAW TREE:
"""
${rawTree}
"""

DELETION RULES (enforce without mercy):
- DELETE structural announcements: "The dissertation is divided", "This paper has X parts", "Chapter X covers"
- DELETE promissory statements: "I will argue", "I will show", "This section will examine", "The author proceeds to"
- DELETE near-duplicates: keep the clearest version only
- DELETE rhetorical questions, transitional filler, meta-commentary
- DELETE vague contribution claims: "This study contributes to", "The literature is enriched by"

REWRITING RULES:
- Do not add new ideas, claims, examples, or references. This pass may only edit or remove nodes already present in RAW TREE.
- Rewrite every surviving node as a clean, self-contained declarative claim
- Remove hedges where the text clearly asserts
- Ensure each claim stands alone without context

CLASSIFICATION:
- "core": central doctrinal commitment (aim for 20-35% of total nodes)
- "supporting": direct evidence or elaboration for a core claim
- "doctrinal": explicit theoretical principle or definition (use sparingly)

STRUCTURE:
- Preserve the numeric hierarchy where it reflects genuine logical dependence
- Prefer fewer stronger nodes over many weak ones
- Apply the SAME editing criteria to the ENTIRE raw tree. Do not keep only its opening or discard a distinct later argument merely because it is later.

Return ONLY valid JSON — no markdown, no commentary:
{
  "nodes": [
    {"id": "n1", "number": "1.0", "claim": "...", "type": "core", "depth": 0, "parentId": null},
    {"id": "n2", "number": "1.1", "claim": "...", "type": "supporting", "depth": 1, "parentId": "n1"}
  ]
}`;

  const result = await callLLMJSON(cp, prompt, model, signal);
  if (!Array.isArray(result?.nodes) || !result.nodes.length) {
    throw new Error("Cleaning returned no intellectual claims; this segment was not completed.");
  }
  return result.nodes;
}

// ── Stage C: Assemble Book Database ──────────────────────────────────────────

async function assembleDatabase(
  cleanedNodes: CleanedNode[],
  text: string,
  userProvider: string,
  wordCount: number,
  model: typeof callLLM,
  signal?: AbortSignal,
): Promise<Omit<BookDatabase, 'meta' | 'cleanedTree'>> {
  const cp = cleaningProvider(userProvider);
  const treeText = cleanedNodes
    .map(n => `${'  '.repeat(n.depth)}${n.number} [${n.type.toUpperCase()}] ${n.claim}`)
    .join('\n');

  const coreCount = cleanedNodes.filter(n => n.type === 'core').length;
  const totalCount = cleanedNodes.length;
  const rawClaimDensity = totalCount > 0 ? (totalCount / (wordCount / 1000)) : 2;

  const prompt = `You are a philosophical analyst producing a structured Book Database from a cleaned intellectual skeleton.

CLEANED TREE (${totalCount} nodes, ${coreCount} core):
"""
${treeText}
"""

COMPLETE ORIGINAL TEXT FOR THIS SEGMENT (not a prefix sample):
"""
${text}
"""

Word count: ${wordCount}
Raw claim density: ${rawClaimDensity.toFixed(1)} claims per 1000 words

INTELLIGENCE CALIBRATION (calibrate overallScore against these benchmarks):
- Dense original philosophy (Freud micro-paper, Chomsky argument, Wittgenstein): 72-88
- Good scholarly analysis with genuine argument: 58-72  
- Academic scaffolding / dissertation abstract with mainly structural content: 42-60
- Pure description / journalism: 30-48

fractalScore = how much GENUINE new conceptual content appears at depth 2+ vs simply restating Level 1 nodes.
redundancyScore = fraction of nodes that restate earlier nodes (0-100, higher = worse).
claimDensity = your calibrated estimate of real intellectual claims per 1000 words (not raw node count).

QUOTES: Extract 3-8 high-signal verbatim passages from the original text. Quality over quantity. Skip if no high-signal passages exist.
ARGUMENTS: Derive 2-6 formal arguments from parent-child relations in the tree. No near-duplicates.
POSITIONS: Derive directly from the cleaned nodes. Map 1:1 where possible.
CONCEPT CLUSTERS: 2-5 thematic groupings. Only if genuine clusters exist.
Apply every analysis to the ENTIRE supplied segment and tree, not just the opening. Quote only passages actually present in this segment. References must use IDs returned in this response.

Return ONLY valid JSON (no markdown fences, no commentary):
{
  "positions": [
    {"id": "p1", "claim": "...", "type": "core", "level": 0, "parentId": null, "confidence": 85}
  ],
  "quotes": [
    {"id": "q1", "text": "verbatim passage", "signalStrength": 8, "whyHighSignal": "...", "relatedPositionIds": ["p1"]}
  ],
  "arguments": [
    {"id": "a1", "premises": ["...", "..."], "conclusion": "...", "relatedPositionIds": ["p1"]}
  ],
  "conceptClusters": [
    {"id": "c1", "label": "...", "description": "...", "relatedPositionIds": ["p1"], "relatedQuoteIds": ["q1"]}
  ],
  "intelligence": {
    "overallScore": 70,
    "claimDensity": 3.8,
    "conceptualCompression": 65,
    "redundancyScore": 20,
    "fillerRatio": 0.15,
    "fractalScore": 58,
    "qualitativeAssessment": "One sharp, specific paragraph assessing the intellectual quality of this text."
  },
  "stylometricThumbprint": {
    "signaturePhrases": ["phrase1", "phrase2", "phrase3"],
    "abstractionLevel": "High — ...",
    "sentenceRhythmNotes": "...",
    "notableStylisticTraits": ["trait1", "trait2", "trait3"]
  }
}`;

  try {
    const result = await callLLMJSON(cp, prompt, model, signal);
    validateDerived(result);
    return {
      positions: Array.isArray(result.positions) ? result.positions : [],
      quotes: Array.isArray(result.quotes) ? result.quotes : [],
      arguments: Array.isArray(result.arguments) ? result.arguments : [],
      conceptClusters: Array.isArray(result.conceptClusters) ? result.conceptClusters : [],
      intelligence: result.intelligence,
      stylometricThumbprint: result.stylometricThumbprint,
    };
  } catch (err) {
    throw new Error(`Database assembly failed: ${err}`);
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

const intelligenceKeys = [
  "overallScore", "claimDensity", "conceptualCompression", "redundancyScore", "fillerRatio", "fractalScore",
] as const;

function validateDerived(result: any): void {
  for (const name of ["positions", "quotes", "arguments", "conceptClusters"]) {
    if (!Array.isArray(result?.[name])) throw new Error(`Missing ${name} analysis.`);
  }
  if (!result.positions.length) throw new Error("No positions were returned for this segment.");
  const nonempty = (value: unknown) => typeof value === "string" && Boolean(value.trim());
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(nonempty);
  for (const position of result.positions) {
    if (!nonempty(position.claim) || !["core", "supporting", "doctrinal"].includes(position.type) ||
        !Number.isInteger(position.level) || position.level < 0 || !Number.isFinite(position.confidence)) {
      throw new Error("Invalid position fields.");
    }
  }
  for (const quote of result.quotes) {
    if (!nonempty(quote.text) || !Number.isFinite(quote.signalStrength) ||
        !nonempty(quote.whyHighSignal) || !strings(quote.relatedPositionIds)) throw new Error("Invalid quotation fields.");
  }
  for (const argument of result.arguments) {
    if (!strings(argument.premises) || !argument.premises.length || !nonempty(argument.conclusion) ||
        !strings(argument.relatedPositionIds)) throw new Error("Invalid argument fields.");
  }
  for (const cluster of result.conceptClusters) {
    if (!nonempty(cluster.label) || !nonempty(cluster.description) || !strings(cluster.relatedPositionIds) ||
        !strings(cluster.relatedQuoteIds)) throw new Error("Invalid concept-cluster fields.");
  }
  validateAssessment(result);
}

function validateAssessment(result: any): void {
  for (const key of intelligenceKeys) {
    if (!Number.isFinite(result.intelligence?.[key])) throw new Error(`Invalid intelligence metric: ${key}.`);
  }
  if (typeof result.intelligence.qualitativeAssessment !== "string") throw new Error("Missing intelligence assessment.");
  const style = result.stylometricThumbprint;
  if (!style || !Array.isArray(style.signaturePhrases) || !Array.isArray(style.notableStylisticTraits) ||
      !style.signaturePhrases.every((phrase: unknown) => typeof phrase === "string") ||
      !style.notableStylisticTraits.every((trait: unknown) => typeof trait === "string") ||
      typeof style.abstractionLevel !== "string" || typeof style.sentenceRhythmNotes !== "string") {
    throw new Error("Missing stylometric analysis.");
  }
}

function normalizeNodes(nodes: CleanedNode[], part: BookSourcePart, nextRoot: () => number): CleanedNode[] {
  const numbers = new Set<string>();
  const roots = new Map<string, string>();
  const prepared = nodes.map((node) => {
    const number = /^\d+$/.test(String(node.number)) ? `${node.number}.0` : String(node.number);
    if (!/^\d+(?:\.\d+)+$/.test(number) || numbers.has(number) ||
        typeof node.claim !== "string" || !node.claim.trim() ||
        !["core", "supporting", "doctrinal"].includes(node.type)) {
      throw new Error("Cleaning returned an invalid or duplicate tree node.");
    }
    numbers.add(number);
    const root = number.split(".")[0];
    if (!roots.has(root)) roots.set(root, String(nextRoot()));
    return { ...node, number };
  });
  const ids = new Map(prepared.map((node, index) => [node.number, `s${part.partIndex + 1}-n${index + 1}`]));
  const parentNumbers = new Map<string, string | null>();
  const children = new Map<string, string[]>();
  for (const node of prepared) {
    const parts = node.number.split(".");
    const isRoot = parts.length === 2 && parts[1] === "0";
    let parentNumber = parts.length === 2 ? `${parts[0]}.0` : parts.slice(0, -1).join(".");
    while (!isRoot && !ids.has(parentNumber) && parentNumber.includes(".")) {
      const parentParts = parentNumber.split(".");
      parentNumber = parentParts.length <= 2 ? `${parentParts[0]}.0` : parentParts.slice(0, -1).join(".");
      if (parentParts.length <= 2) break;
    }
    if (!isRoot && !ids.has(parentNumber)) throw new Error(`Tree node ${node.number} has no surviving parent.`);
    parentNumbers.set(node.number, isRoot ? null : parentNumber);
    if (!isRoot) children.set(parentNumber, [...(children.get(parentNumber) ?? []), node.number]);
  }
  const hierarchy = new Map<string, { number: string; depth: number }>();
  const place = (number: string): { number: string; depth: number } => {
    const cached = hierarchy.get(number);
    if (cached) return cached;
    const parent = parentNumbers.get(number);
    const parentLocation = parent ? place(parent) : null;
    const location = parentLocation ? {
      number: `${parentLocation.depth === 0 ? parentLocation.number.split(".")[0] : parentLocation.number}.${children.get(parent!)!.indexOf(number) + 1}`,
      depth: parentLocation.depth + 1,
    } : { number: `${roots.get(number.split(".")[0])}.0`, depth: 0 };
    hierarchy.set(number, location);
    return location;
  };
  return prepared.map((node) => {
    const parent = parentNumbers.get(node.number);
    const location = place(node.number);
    return {
      id: ids.get(node.number)!, number: location.number,
      claim: node.claim.trim(), type: node.type,
      depth: location.depth,
      parentId: parent ? ids.get(parent)! : null, source: part,
    };
  });
}

function prefixDerived(derived: Omit<BookDatabase, "meta" | "cleanedTree">, source: BookSourcePart, text: string) {
  const prefix = `s${source.partIndex + 1}-`;
  const makeIds = (items: { id: string }[], kind: string) => {
    const map = new Map<string, string>();
    for (const [index, item] of Array.from(items.entries())) {
      if (typeof item.id !== "string" || map.has(item.id)) throw new Error(`Invalid or duplicate ${kind} ID.`);
      map.set(item.id, `${prefix}${kind}${index + 1}`);
    }
    return map;
  };
  const positionIds = makeIds(derived.positions, "p");
  const quoteIds = makeIds(derived.quotes, "q");
  const argumentIds = makeIds(derived.arguments, "a");
  const clusterIds = makeIds(derived.conceptClusters, "c");
  const references = (ids: string[], map: Map<string, string>) => {
    if (!Array.isArray(ids) || ids.some((id) => !map.has(id))) throw new Error("Database contains a broken cross-reference.");
    return ids.map((id) => map.get(id)!);
  };
  const normalizedText = text.replace(/\s+/g, " ");
  const positionsById = new Map(derived.positions.map((position) => [position.id, position]));
  const positionDepths = new Map<string, number>();
  const positionDepth = (id: string, visiting = new Set<string>()): number => {
    if (positionDepths.has(id)) return positionDepths.get(id)!;
    if (visiting.has(id)) throw new Error("Positions contain a cyclic parent relationship.");
    visiting.add(id);
    const position = positionsById.get(id);
    if (!position) throw new Error("Positions contain a missing parent.");
    const depth = position.parentId ? positionDepth(position.parentId, visiting) + 1 : 0;
    visiting.delete(id);
    positionDepths.set(id, depth);
    return depth;
  };
  return {
    positions: derived.positions.map((position) => {
      if (typeof position.claim !== "string" || !position.claim.trim()) throw new Error("Invalid position.");
      return {
        ...position, id: positionIds.get(position.id)!, level: positionDepth(position.id),
        parentId: position.parentId ? references([position.parentId], positionIds)[0] : null, source,
      };
    }),
    quotes: derived.quotes.map((quote) => {
      if (typeof quote.text !== "string" || !quote.text.trim() ||
          !normalizedText.includes(quote.text.replace(/\s+/g, " ").trim())) {
        throw new Error("A purported verbatim quotation is not present in its source segment.");
      }
      return { ...quote, id: quoteIds.get(quote.id)!, relatedPositionIds: references(quote.relatedPositionIds, positionIds), source };
    }),
    arguments: derived.arguments.map((argument) => ({
      ...argument, id: argumentIds.get(argument.id)!, relatedPositionIds: references(argument.relatedPositionIds, positionIds), source,
    })),
    conceptClusters: derived.conceptClusters.map((cluster) => ({
      ...cluster, id: clusterIds.get(cluster.id)!,
      relatedPositionIds: references(cluster.relatedPositionIds, positionIds),
      relatedQuoteIds: references(cluster.relatedQuoteIds, quoteIds), source,
    })),
    intelligence: derived.intelligence, stylometricThumbprint: derived.stylometricThumbprint,
  };
}

export async function generateBookDatabase2(
  text: string,
  provider: string,
  meta: { title?: string; author?: string },
  onProgress: (p: { stage: string; message: string; current: number; total: number }) => void,
  options: { signal?: AbortSignal; model?: typeof callLLM } = {},
): Promise<BookDatabase> {
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount < 50) throw new Error("Text too short for Book Database 2.0 (minimum 50 words)");

  const parts = partitionBookText(text);
  const model: typeof callLLM = options.model ?? ((provider, prompt, signal) => callLLM(provider, prompt, signal, { rejectTruncated: true }));
  const signal = options.signal;
  const total = parts.length * 3 + (parts.length > 1 ? 1 : 0);
  const results: { nodes: CleanedNode[]; derived: ReturnType<typeof prefixDerived>; weight: number; label: string }[] = [];
  let root = 0;
  let processedParts = 0;
  for (const part of parts) {
    signal?.throwIfAborted();
    const { text: segment, wordCount: segmentWords, ...source } = part;
    const chapterParts = parts.filter((item) => item.chapterIndex === part.chapterIndex);
    const partNumber = chapterParts.findIndex((item) => item.partIndex === part.partIndex) + 1;
    const label = `${part.chapterTitle} — part ${partNumber} of ${chapterParts.length}`;
    const current = part.partIndex * 3;
    if (!segmentWords) {
      processedParts++;
      onProgress({ stage: "coverage", message: `${label}: whitespace-only segment covered.`, current: current + 3, total });
      continue;
    }
    try {
      onProgress({ stage: "tree", message: `${label}: generating tree (${part.partIndex + 1}/${parts.length} text segments)…`, current, total });
      const rawTree = await generateRawTree(segment, provider, segmentWords, model, signal);
      if (!parseRawFallback(rawTree).length) throw new Error("No numbered tree was returned.");
      signal?.throwIfAborted();
      onProgress({ stage: "cleaning", message: `${label}: cleaning the complete segment tree…`, current: current + 1, total });
      const localNodes = await runCleaningPass(rawTree, provider, model, signal);
      const nodes = normalizeNodes(localNodes, source, () => ++root);
      signal?.throwIfAborted();
      onProgress({ stage: "database", message: `${label}: extracting positions, quotes, arguments, clusters, intelligence and style…`, current: current + 2, total });
      const derived = prefixDerived(await assembleDatabase(nodes, segment, provider, segmentWords, model, signal), source, segment);
      results.push({ nodes, derived, weight: segmentWords || 1, label });
      processedParts++;
      onProgress({ stage: "coverage", message: `${label} completed — ${part.partIndex + 1} of ${parts.length} segments analyzed.`, current: current + 3, total });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)} Full-text analysis is incomplete; no segment was silently skipped.`);
    }
  }
  const coverage = coverageFor(text, parts, processedParts);
  if (coverage.processedCharacters !== text.length || coverage.processedParts !== coverage.totalParts) {
    throw new Error("Full-text analysis is incomplete.");
  }
  const weight = results.reduce((sum, result) => sum + result.weight, 0);
  let intelligence = Object.fromEntries(intelligenceKeys.map((key) => [
    key, results.reduce((sum, result) => sum + result.derived.intelligence[key] * result.weight, 0) / weight,
  ])) as unknown as BookIntelligence;
  intelligence.qualitativeAssessment = results.length === 1 ? results[0].derived.intelligence.qualitativeAssessment :
    `Scores are word-weighted aggregates of all ${results.length} source segments.\n\n` +
    results.map((result) => `${result.label}\n${result.derived.intelligence.qualitativeAssessment}`).join("\n\n");
  const unique = (values: string[]) => Array.from(new Set(values));
  let stylometricThumbprint: StylometricThumbprint = {
    signaturePhrases: unique(results.flatMap((result) => result.derived.stylometricThumbprint.signaturePhrases)),
    abstractionLevel: unique(results.map((result) => result.derived.stylometricThumbprint.abstractionLevel)).join("; "),
    sentenceRhythmNotes: results.map((result) => `${result.label}: ${result.derived.stylometricThumbprint.sentenceRhythmNotes}`).join("\n\n"),
    notableStylisticTraits: unique(results.flatMap((result) => result.derived.stylometricThumbprint.notableStylisticTraits)),
  };
  if (results.length > 1) {
    const reconciled = await assessWholeBook(
      results.map((result) => ({
        label: result.label, wordCount: result.weight,
        intelligence: result.derived.intelligence, stylometricThumbprint: result.derived.stylometricThumbprint,
        themes: result.nodes.filter((node) => node.depth === 0).map((node) => node.claim),
      })),
      crossSegmentRepetition(results.flatMap((result) => result.nodes)),
      (prompt) => callLLMJSON(cleaningProvider(provider), prompt, model, signal),
      validateAssessment,
      (message) => onProgress({ stage: "reconciliation", message, current: parts.length * 3, total }),
    );
    intelligence = reconciled.intelligence;
    stylometricThumbprint = reconciled.stylometricThumbprint;
    coverage.assessment = "whole-text-reconciled";
  }
  onProgress({ stage: "done", message: `Complete: all ${parts.length} segments and ${coverage.chapters.length} sections analyzed.`, current: total, total });

  return {
    meta: {
      title: meta.title || undefined,
      author: meta.author || undefined,
      wordCount,
      processedAt: new Date().toISOString(),
      provider,
      coverage,
    },
    cleanedTree: results.flatMap((result) => result.nodes),
    positions: results.flatMap((result) => result.derived.positions),
    quotes: results.flatMap((result) => result.derived.quotes),
    arguments: results.flatMap((result) => result.derived.arguments),
    conceptClusters: results.flatMap((result) => result.derived.conceptClusters),
    intelligence, stylometricThumbprint,
  };
}
