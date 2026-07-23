import { callLLM } from "../llm";
import { generateOutline } from "./outlineService";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CleanedNode {
  id: string;
  number: string;
  claim: string;
  type: "core" | "supporting" | "doctrinal";
  depth: number;
  parentId?: string | null;
}

export interface BookPosition {
  id: string;
  claim: string;
  type: "core" | "supporting" | "doctrinal";
  level: number;
  parentId?: string | null;
  confidence: number;
}

export interface BookQuote {
  id: string;
  text: string;
  signalStrength: number;
  whyHighSignal: string;
  relatedPositionIds: string[];
}

export interface BookArgument {
  id: string;
  premises: string[];
  conclusion: string;
  relatedPositionIds: string[];
}

export interface ConceptCluster {
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

async function callLLMJSON(provider: string, prompt: string): Promise<any> {
  const raw = await callLLM(provider, prompt);
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

async function generateRawTree(text: string, provider: string, wordCount: number): Promise<string> {
  if (wordCount > 3000) {
    // Sectioned approach for long texts
    let outline: any;
    try {
      outline = await generateOutline(text.slice(0, 30000));
    } catch {
      outline = { sections: [{ title: "Full Text", keyThemes: [], description: "" }] };
    }

    const sections = outline.sections.slice(0, 10);
    const chunkSize = Math.ceil(text.length / Math.max(sections.length, 1));
    const trees: string[] = [];

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const chunk = text.slice(i * chunkSize, (i + 1) * chunkSize);
      if (chunk.trim().length < 100) continue;

      const prompt = `Convert this text section to a Tractatus-style hierarchical proposition tree.

SECTION: "${section.title}"

TEXT:
"""
${chunk.slice(0, 6000)}
"""

STRICT RULES:
- Only declarative propositions (claims, theses, facts)
- NEVER: "I will examine", "This section discusses", "The paper is divided"
- Number format: ${i + 1}.1, ${i + 1}.1.1, ${i + 1}.1.2, ${i + 1}.2, etc.
- Minimum 3 levels of depth
- Each proposition self-contained

Output numbered propositions only, no commentary:`;

      try {
        trees.push(await callLLM(provider, prompt));
      } catch { /* skip failed sections */ }
    }

    return trees.join('\n\n');
  }

  // Short text: single pass
  const topLevelCount = Math.max(3, Math.min(10, Math.ceil(wordCount / 400)));
  const prompt = `Convert this text into a Tractatus-style hierarchical numbered proposition tree.

TEXT:
"""
${text.slice(0, 12000)}
"""

CRITICAL RULES:
1. Only declarative propositions — no promissory or structural statements
2. REJECT: "I will argue", "This paper examines", "The study is divided", "Chapter X discusses"
3. ACCEPT: "X causes Y", "The central claim is Z", "Determinism entails P", "Language acquisition requires Q"
4. Level 1 = the strongest, most central theses (produce at least ${topLevelCount} top-level nodes)
5. Deeper levels = genuine conceptual expansion, not repetition
6. Minimum 3 levels of depth, ideally 4-5 for rich texts
7. Every proposition must stand alone as a meaningful claim

FORMAT:
1.0 [Central thesis]
1.1 [Direct elaboration]
1.1.1 [Specific specification]
1.2 [Second elaboration of 1.0]
2.0 [Second major thesis]
...

Generate the tree now:`;

  return callLLM(provider, prompt);
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

async function runCleaningPass(rawTree: string, userProvider: string): Promise<CleanedNode[]> {
  const cp = cleaningProvider(userProvider);

  const prompt = `You are an aggressive intellectual editor. Transform this raw Tractatus tree into a high-signal intellectual skeleton.

RAW TREE:
"""
${rawTree.slice(0, 10000)}
"""

DELETION RULES (enforce without mercy):
- DELETE structural announcements: "The dissertation is divided", "This paper has X parts", "Chapter X covers"
- DELETE promissory statements: "I will argue", "I will show", "This section will examine", "The author proceeds to"
- DELETE near-duplicates: keep the clearest version only
- DELETE rhetorical questions, transitional filler, meta-commentary
- DELETE vague contribution claims: "This study contributes to", "The literature is enriched by"

REWRITING RULES:
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

Return ONLY valid JSON — no markdown, no commentary:
{
  "nodes": [
    {"id": "n1", "number": "1.0", "claim": "...", "type": "core", "depth": 0, "parentId": null},
    {"id": "n2", "number": "1.1", "claim": "...", "type": "supporting", "depth": 1, "parentId": "n1"}
  ]
}`;

  try {
    const result = await callLLMJSON(cp, prompt);
    if (Array.isArray(result?.nodes) && result.nodes.length > 0) {
      return result.nodes;
    }
    return parseRawFallback(rawTree);
  } catch {
    return parseRawFallback(rawTree);
  }
}

// ── Stage C: Assemble Book Database ──────────────────────────────────────────

async function assembleDatabase(
  cleanedNodes: CleanedNode[],
  text: string,
  userProvider: string,
  wordCount: number
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
${treeText.slice(0, 6000)}
"""

ORIGINAL TEXT SAMPLE (first 1500 words):
"""
${text.split(/\s+/).slice(0, 1500).join(' ')}
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
    const result = await callLLMJSON(cp, prompt);
    return {
      positions: Array.isArray(result.positions) ? result.positions : [],
      quotes: Array.isArray(result.quotes) ? result.quotes : [],
      arguments: Array.isArray(result.arguments) ? result.arguments : [],
      conceptClusters: Array.isArray(result.conceptClusters) ? result.conceptClusters : [],
      intelligence: result.intelligence ?? {
        overallScore: 50, claimDensity: 2, conceptualCompression: 50,
        redundancyScore: 30, fillerRatio: 0.3, fractalScore: 40,
        qualitativeAssessment: "Analysis incomplete.",
      },
      stylometricThumbprint: result.stylometricThumbprint ?? {
        signaturePhrases: [], abstractionLevel: "Unknown",
        sentenceRhythmNotes: "", notableStylisticTraits: [],
      },
    };
  } catch (err) {
    throw new Error(`Database assembly failed: ${err}`);
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function generateBookDatabase2(
  text: string,
  provider: string,
  meta: { title?: string; author?: string },
  onProgress: (p: { stage: string; message: string; current: number; total: number }) => void
): Promise<BookDatabase> {
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount < 50) throw new Error("Text too short for Book Database 2.0 (minimum 50 words)");

  onProgress({ stage: "tree", message: "Generating Tractatus Tree 2.0…", current: 1, total: 4 });
  const rawTree = await generateRawTree(text, provider, wordCount);

  onProgress({ stage: "cleaning", message: "Aggressive cleaning pass…", current: 2, total: 4 });
  const cleanedNodes = await runCleaningPass(rawTree, provider);

  onProgress({ stage: "database", message: "Assembling Book Database…", current: 3, total: 4 });
  const derived = await assembleDatabase(cleanedNodes, text, provider, wordCount);

  onProgress({ stage: "done", message: "Complete.", current: 4, total: 4 });

  return {
    meta: {
      title: meta.title || undefined,
      author: meta.author || undefined,
      wordCount,
      processedAt: new Date().toISOString(),
      provider,
    },
    cleanedTree: cleanedNodes,
    ...derived,
  };
}
