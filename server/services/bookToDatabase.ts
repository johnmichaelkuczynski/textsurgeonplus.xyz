import { callLLM } from "../llm";
import { nanoid } from "nanoid";

export interface BookDatabaseProgress {
  stage: string;
  message: string;
  current?: number;
  total?: number;
}

export interface BookPosition {
  id: string;
  claim: string;
  type: "core" | "supporting" | "doctrinal";
  section?: string;
  confidence: number;
}

export interface BookQuote {
  id: string;
  text: string;
  signalStrength: number;
  whyHighSignal: string;
  section?: string;
}

export interface BookArgument {
  id: string;
  premises: string[];
  conclusion: string;
  section?: string;
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
  qualitativeAssessment: string;
}

export interface BookDatabaseResult {
  meta: {
    title?: string;
    author?: string;
    wordCount: number;
    processedAt: string;
    provider: string;
  };
  positions: BookPosition[];
  quotes: BookQuote[];
  arguments: BookArgument[];
  conceptClusters: ConceptCluster[];
  intelligence: BookIntelligence;
  stylometricThumbprint: {
    signaturePhrases: string[];
    abstractionLevel: string;
    sentenceRhythmNotes: string;
    notableStylisticTraits: string[];
  };
}

async function callLLMWithJSON(provider: string, prompt: string): Promise<any> {
  const content = await callLLM(provider, prompt + "\n\nRespond with valid JSON only. No markdown fences, no extra text.");
  try {
    return JSON.parse(content);
  } catch {
    const fence = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fence) return JSON.parse(fence[1]);
    const obj = content.match(/\{[\s\S]*\}/);
    if (obj) return JSON.parse(obj[0]);
    throw new Error("Failed to parse LLM response as JSON");
  }
}

const EXTRACTION_PROMPT = (text: string, author: string, sectionLabel?: string) => `
You are a rigorous philosophical analyst extracting ONLY genuine intellectual commitments from an author's text.

AUTHOR: ${author}
${sectionLabel ? `SECTION: ${sectionLabel}` : ""}

=== ABSOLUTE RULES ===

A POSITION is a substantive claim the author is genuinely committing to as true.

NEVER extract as a position:
- Questions of any kind ("What's the explanation?", "But why posit…?")
- Imperatives ("Consider…", "Let me explain…", "Note that…")
- Transitional sentences ("In what follows…", "As I said…")
- Pure examples or illustrations (describing what happens in an experiment or scenario)
- Rhetorical restatements ("The answer is clear", "As we have seen…")
- Sentence fragments
- Statements that merely describe what someone else said or believes (without endorsement)
- Near-duplicates of another extracted claim

A POSITION must:
- Be a declarative claim in the author's committed voice
- Express a genuine intellectual commitment
- Be self-contained and intelligible without surrounding context
- Pass this test: "Is the author asserting this as true, and would it surprise a reader to learn it is central to the author's view?"

CONFIDENCE CALIBRATION (mandatory):
- 90-100: Crystal-clear thesis statement, central to the whole work, stated explicitly
- 75-89: Well-supported, clearly endorsed, important claim
- 60-74: Present but less foregrounded; supported claim
- Below 60: Use sparingly; requires strong justification
- Do NOT give 100 to more than 1-2 items
- Do NOT give 80+ to weak or marginal material

TYPE:
- core: Central doctrinal commitments; the author's main theses (use sparingly — 2-4 per short essay)
- supporting: Claims that directly back a core position
- doctrinal: Explicit theoretical principles used as axioms (use sparingly)

TARGET COUNT: For a ~2000-word text, aim for 8-18 positions. For a full book, scale proportionally. Prefer fewer, sharper positions over many weak ones. When in doubt, exclude.

QUOTES: Extract only verbatim passages of genuine intellectual density — where the author's argument is most concentrated. Aim for 8-20 for a short essay. Skip rhetorical, transitional, or merely illustrative passages. Each quote must be a real passage from the text, word for word.

ARGUMENTS: Formal premise-conclusion reconstructions only. Skip if the structure is unclear. Premises must be genuine reasons, not illustrations.

=== TEXT TO ANALYZE ===
${text}

Return JSON in exactly this shape (nothing else):
{
  "positions": [
    {
      "claim": "Clean, self-contained declarative sentence in author's voice. Rewrite raw fragments into proper sentences.",
      "type": "core|supporting|doctrinal",
      "section": "optional section name",
      "confidence": 85
    }
  ],
  "quotes": [
    {
      "text": "Verbatim passage from the text",
      "signalStrength": 8,
      "whyHighSignal": "Brief reason this passage is high-value",
      "section": "optional"
    }
  ],
  "arguments": [
    {
      "premises": ["Premise 1", "Premise 2"],
      "conclusion": "Conclusion",
      "section": "optional"
    }
  ]
}
`;

const CLEANING_PROMPT = (rawPositions: any[], rawQuotes: any[], wordCount: number, author: string) => `
You are performing a strict quality-control pass on extracted intellectual positions and quotes.

AUTHOR: ${author}
WORD COUNT OF SOURCE TEXT: ${wordCount}

=== YOUR TASK ===

You will receive raw extractions. Your job:
1. REMOVE: any non-claims (questions, imperatives, examples, transitions, rhetorical filler, fragments)
2. MERGE: near-duplicates into one clean statement (keep the best phrasing)
3. REWRITE: any remaining messy claims into clean, self-contained declarative sentences
4. RECALIBRATE: confidence scores — be strict. Most should be 70-90. Reserve 90+ for the clearest theses.
5. RECLASSIFY: type if needed. There should be very few "core" items.

After cleaning, the positions list should contain ONLY genuine intellectual commitments.
If in doubt, exclude.

RAW POSITIONS:
${JSON.stringify(rawPositions, null, 2)}

RAW QUOTES:
${JSON.stringify(rawQuotes, null, 2)}

Now produce cleaned versions. Assign sequential IDs: p1, p2, ... and q1, q2, ...

Return JSON:
{
  "positions": [
    { "id": "p1", "claim": "...", "type": "core|supporting|doctrinal", "section": "...", "confidence": 85 }
  ],
  "quotes": [
    { "id": "q1", "text": "...", "signalStrength": 8, "whyHighSignal": "...", "section": "..." }
  ]
}
`;

const SYNTHESIS_PROMPT = (positions: BookPosition[], quotes: BookQuote[], arguments_: BookArgument[], wordCount: number, author: string) => `
You are building the final synthesis for a Book Database.

AUTHOR: ${author}
WORD COUNT: ${wordCount}

POSITIONS (${positions.length}):
${positions.map(p => `[${p.id}] (${p.type}, ${p.confidence}%) ${p.claim}`).join("\n")}

QUOTES (${quotes.length}):
${quotes.map(q => `[${q.id}] "${q.text.substring(0, 100)}..." (signal: ${q.signalStrength})`).join("\n")}

Tasks:
1. Build 4-8 CONCEPT CLUSTERS that group thematically related positions and quotes. Use the exact IDs above. Descriptions must be specific, not generic.
2. Compute INTELLIGENCE METRICS based on what you actually see:
   - claimDensity: genuine positions per 1000 words (use position count ÷ wordCount × 1000)
   - conceptualCompression: 0-100. How densely packed is real intellectual content? A very tight philosophical essay might score 70-85.
   - redundancyScore: 0-100. Higher means more repetition/padding in the original text.
   - fillerRatio: 0.0-1.0. Proportion of text that is exposition/rhetoric vs. genuine argument.
   - overallScore: weighted score (40% claimDensity normalized, 30% conceptualCompression, 30% (100-redundancyScore)). A dense philosophical essay should score 70-85, popular science 40-60, pure narrative lower.
   - qualitativeAssessment: Sharp, specific 2-3 sentence judgment. Name what the text does well and what it fails at. Be critical where warranted.
3. STYLOMETRIC THUMBPRINT (light — no generic psychologizing):
   - signaturePhrases: 5-10 distinctive phrases or constructions that appear in the actual text
   - abstractionLevel: one of: "highly abstract", "moderately abstract", "mixed abstract/concrete", "primarily concrete"
   - sentenceRhythmNotes: honest description of the actual rhythm (e.g., "long, clause-heavy sentences with frequent qualification")
   - notableStylisticTraits: 3-6 real observations about this specific author's style

Return JSON:
{
  "conceptClusters": [
    {
      "id": "c1",
      "label": "Short theme label",
      "description": "Specific description of what this cluster covers",
      "relatedPositionIds": ["p1", "p2"],
      "relatedQuoteIds": ["q1"]
    }
  ],
  "intelligence": {
    "overallScore": 78,
    "claimDensity": 7.2,
    "conceptualCompression": 72,
    "redundancyScore": 25,
    "fillerRatio": 0.35,
    "qualitativeAssessment": "..."
  },
  "stylometricThumbprint": {
    "signaturePhrases": ["..."],
    "abstractionLevel": "highly abstract",
    "sentenceRhythmNotes": "...",
    "notableStylisticTraits": ["..."]
  }
}
`;

const ARGUMENTS_PROMPT = (text: string, author: string) => `
You are reconstructing formal arguments from a text.

AUTHOR: ${author}

Rules:
- Only extract arguments where there is a clear inferential structure: genuine premises that support a conclusion
- Do NOT extract argument-shaped passages that are really just explanations or illustrations
- Premises must be real reasons, not examples
- Conclusion must follow from the premises
- If an argument is weak or unclear, skip it
- Aim for 2-6 clean arguments for a short essay

TEXT:
${text.substring(0, 8000)}

Return JSON:
{
  "arguments": [
    {
      "premises": ["Genuine reason 1", "Genuine reason 2"],
      "conclusion": "What follows from these reasons",
      "section": "optional section label"
    }
  ]
}
`;

function splitIntoChunks(text: string, maxWords: number = 1500): string[] {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + maxWords, words.length);
    chunks.push(words.slice(start, end).join(" "));
    start = end - 100; // 100-word overlap
    if (start >= words.length - 50) break;
  }
  return chunks;
}

export async function runBookToDatabase(
  text: string,
  provider: string,
  title: string | undefined,
  author: string | undefined,
  onProgress: (p: BookDatabaseProgress) => void
): Promise<BookDatabaseResult> {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const effectiveAuthor = author?.trim() || "the author";
  const effectiveProvider = provider || "anthropic";

  // Phase 1: Extract
  onProgress({ stage: "extracting", message: "Extracting positions and quotes…", current: 1, total: 4 });

  let allRawPositions: any[] = [];
  let allRawQuotes: any[] = [];

  if (wordCount <= 4000) {
    // Short text: single extraction call
    try {
      const extracted = await callLLMWithJSON(effectiveProvider, EXTRACTION_PROMPT(text, effectiveAuthor));
      allRawPositions = extracted.positions || [];
      allRawQuotes = extracted.quotes || [];
    } catch (err) {
      console.error("[bookToDatabase] Extraction failed:", err);
    }
  } else {
    // Long text: split into chunks and extract per chunk
    const chunks = splitIntoChunks(text, 2000);
    for (let i = 0; i < chunks.length; i++) {
      onProgress({ stage: "extracting", message: `Extracting chunk ${i + 1} of ${chunks.length}…`, current: i + 1, total: chunks.length });
      try {
        const extracted = await callLLMWithJSON(effectiveProvider, EXTRACTION_PROMPT(chunks[i], effectiveAuthor, `Section ${i + 1}`));
        allRawPositions.push(...(extracted.positions || []).map((p: any) => ({ ...p, section: p.section || `Section ${i + 1}` })));
        allRawQuotes.push(...(extracted.quotes || []).map((q: any) => ({ ...q, section: q.section || `Section ${i + 1}` })));
      } catch (err) {
        console.error(`[bookToDatabase] Chunk ${i + 1} extraction failed:`, err);
      }
    }
  }

  // Phase 2: Cleaning pass — deduplicate, filter, recalibrate
  onProgress({ stage: "cleaning", message: "Filtering and cleaning extractions…", current: 2, total: 4 });

  let positions: BookPosition[] = [];
  let quotes: BookQuote[] = [];

  try {
    const cleaned = await callLLMWithJSON(effectiveProvider, CLEANING_PROMPT(allRawPositions, allRawQuotes, wordCount, effectiveAuthor));
    positions = (cleaned.positions || []).map((p: any, i: number) => ({
      id: p.id || `p${i + 1}`,
      claim: p.claim || "",
      type: (["core", "supporting", "doctrinal"].includes(p.type) ? p.type : "supporting") as "core" | "supporting" | "doctrinal",
      section: p.section || undefined,
      confidence: typeof p.confidence === "number" ? Math.max(0, Math.min(100, p.confidence)) : 75,
    })).filter((p: BookPosition) => p.claim.length > 10);

    quotes = (cleaned.quotes || []).map((q: any, i: number) => ({
      id: q.id || `q${i + 1}`,
      text: q.text || "",
      signalStrength: typeof q.signalStrength === "number" ? Math.max(1, Math.min(10, q.signalStrength)) : 7,
      whyHighSignal: q.whyHighSignal || "",
      section: q.section || undefined,
    })).filter((q: BookQuote) => q.text.length > 10);
  } catch (err) {
    console.error("[bookToDatabase] Cleaning pass failed, using raw with basic IDs:", err);
    positions = allRawPositions.slice(0, 20).map((p: any, i: number) => ({
      id: `p${i + 1}`,
      claim: p.claim || "",
      type: (["core", "supporting", "doctrinal"].includes(p.type) ? p.type : "supporting") as "core" | "supporting" | "doctrinal",
      section: p.section,
      confidence: typeof p.confidence === "number" ? p.confidence : 75,
    }));
    quotes = allRawQuotes.slice(0, 15).map((q: any, i: number) => ({
      id: `q${i + 1}`,
      text: q.text || "",
      signalStrength: typeof q.signalStrength === "number" ? q.signalStrength : 7,
      whyHighSignal: q.whyHighSignal || "",
      section: q.section,
    }));
  }

  // Phase 3: Arguments
  onProgress({ stage: "arguments", message: "Reconstructing formal arguments…", current: 3, total: 4 });

  let bookArguments: BookArgument[] = [];
  try {
    const argResult = await callLLMWithJSON(effectiveProvider, ARGUMENTS_PROMPT(text, effectiveAuthor));
    bookArguments = (argResult.arguments || []).map((a: any, i: number) => ({
      id: `a${i + 1}`,
      premises: Array.isArray(a.premises) ? a.premises.filter((p: any) => typeof p === "string" && p.length > 5) : [],
      conclusion: a.conclusion || "",
      section: a.section || undefined,
    })).filter((a: BookArgument) => a.premises.length > 0 && a.conclusion.length > 10);
  } catch (err) {
    console.error("[bookToDatabase] Arguments extraction failed:", err);
  }

  // Phase 4: Synthesis — clusters + intelligence + stylometrics
  onProgress({ stage: "synthesis", message: "Building concept clusters and intelligence metrics…", current: 4, total: 4 });

  let conceptClusters: ConceptCluster[] = [];
  let intelligence: BookIntelligence = {
    overallScore: 0,
    claimDensity: 0,
    conceptualCompression: 0,
    redundancyScore: 50,
    fillerRatio: 0.5,
    qualitativeAssessment: "",
  };
  let stylometricThumbprint = {
    signaturePhrases: [] as string[],
    abstractionLevel: "unknown",
    sentenceRhythmNotes: "",
    notableStylisticTraits: [] as string[],
  };

  try {
    const synthesis = await callLLMWithJSON(effectiveProvider, SYNTHESIS_PROMPT(positions, quotes, bookArguments, wordCount, effectiveAuthor));

    conceptClusters = (synthesis.conceptClusters || []).map((c: any, i: number) => ({
      id: c.id || `c${i + 1}`,
      label: c.label || "Unnamed cluster",
      description: c.description || "",
      relatedPositionIds: Array.isArray(c.relatedPositionIds) ? c.relatedPositionIds : [],
      relatedQuoteIds: Array.isArray(c.relatedQuoteIds) ? c.relatedQuoteIds : [],
    }));

    if (synthesis.intelligence) {
      const intel = synthesis.intelligence;
      intelligence = {
        overallScore: typeof intel.overallScore === "number" ? Math.max(0, Math.min(100, intel.overallScore)) : 0,
        claimDensity: typeof intel.claimDensity === "number" ? Math.round(intel.claimDensity * 10) / 10 : 0,
        conceptualCompression: typeof intel.conceptualCompression === "number" ? Math.max(0, Math.min(100, intel.conceptualCompression)) : 0,
        redundancyScore: typeof intel.redundancyScore === "number" ? Math.max(0, Math.min(100, intel.redundancyScore)) : 50,
        fillerRatio: typeof intel.fillerRatio === "number" ? Math.max(0, Math.min(1, intel.fillerRatio)) : 0.5,
        qualitativeAssessment: intel.qualitativeAssessment || "",
      };
    }

    if (synthesis.stylometricThumbprint) {
      const st = synthesis.stylometricThumbprint;
      stylometricThumbprint = {
        signaturePhrases: Array.isArray(st.signaturePhrases) ? st.signaturePhrases : [],
        abstractionLevel: st.abstractionLevel || "unknown",
        sentenceRhythmNotes: st.sentenceRhythmNotes || "",
        notableStylisticTraits: Array.isArray(st.notableStylisticTraits) ? st.notableStylisticTraits : [],
      };
    }
  } catch (err) {
    console.error("[bookToDatabase] Synthesis failed:", err);
    // Fallback intelligence computation
    const claimDensity = wordCount > 0 ? Math.round((positions.length / wordCount) * 1000 * 10) / 10 : 0;
    intelligence = {
      overallScore: Math.min(100, Math.round(claimDensity * 8)),
      claimDensity,
      conceptualCompression: 50,
      redundancyScore: 40,
      fillerRatio: 0.45,
      qualitativeAssessment: "Synthesis step failed — metrics are approximate.",
    };
  }

  const result: BookDatabaseResult = {
    meta: {
      title: title?.trim() || undefined,
      author: author?.trim() || undefined,
      wordCount,
      processedAt: new Date().toISOString(),
      provider: effectiveProvider,
    },
    positions,
    quotes,
    arguments: bookArguments,
    conceptClusters,
    intelligence,
    stylometricThumbprint,
  };

  const coreCount = positions.filter(p => p.type === "core").length;
  onProgress({ stage: "complete", message: `Done: ${positions.length} positions (${coreCount} core), ${quotes.length} quotes, ${bookArguments.length} arguments` });

  return result;
}
