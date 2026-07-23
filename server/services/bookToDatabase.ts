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

=== THE SINGLE MOST IMPORTANT DISTINCTION ===

There are two completely different kinds of sentences:

TYPE A — PROMISSORY / META-LEVEL: The author announces what they will argue, plan to show, aim to demonstrate, or intend to examine. These are NOT positions. They are bureaucratic scaffolding.

TYPE B — DELIVERED / OBJECT-LEVEL: The author actually states their claim as true. This is what you extract.

EXAMPLES:

NOT a position (promissory):
- "I will argue that X is true."
- "I aim to show that Y is the case."
- "I argue in this chapter that..."
- "I conclude that Z." (used as a structural marker, not delivering Z itself)
- "In section 3, I demonstrate that..."
- "This thesis examines the question of..."
- "I engage with the views of X, Y, and Z."
- "I aim to show that transcendental empiricism is an attractive alternative."
- "I argue that (1) Gaskin's critiques are faulty and (2) Gaskin's minimalist empiricism is dubious." [This is an announcement of what the text will prove — not the proof itself.]

IS a position (delivered):
- "Neurosis is the condition that results when a person dissociates from their own aggression."
- "Tolerating ambiguity prevents the onset of neurosis."
- "McDowell's linguistic idealism is internally inconsistent because..."

=== ABSOLUTE RULES ===

NEVER extract as a position:
- Promissory statements ("I will argue", "I aim to show", "I conclude that" as structural marker, "I plan to demonstrate", "I hope to establish")
- Agenda-announcing sentences ("This paper examines...", "The thesis consists of...", "In what follows I...")
- Survey sentences ("I engage with X, Y, and Z", "I consider objections from...")
- Pure critique without positive alternative ("X is wrong", "X fails" — only if no replacement view is offered)
- Questions of any kind
- Imperatives or instructions
- Transitional sentences
- Pure examples or illustrations
- Sentence fragments
- Descriptions of what someone else believes (without author's endorsement)
- Near-duplicates of another extracted claim

A POSITION must:
- Be a declarative claim the author is asserting as TRUE right now in this text
- Deliver actual intellectual content, not merely announce it
- Be self-contained and intelligible without surrounding context
- Pass this test: "Is the author delivering this claim here, or promising to deliver it later?"

CONFIDENCE CALIBRATION:
- 90-100: Crystal-clear thesis statement, central, stated explicitly AND the actual content is here
- 75-89: Well-supported, clearly endorsed important claim
- 60-74: Present but less foregrounded
- Below 60: Use sparingly
- Do NOT give 90+ to promissory statements even if they sound important

TYPE:
- core: The author's main positive theses (use sparingly — 2-4 per short essay)
- supporting: Claims that directly back a core position
- doctrinal: Explicit theoretical principles used as axioms (use sparingly)

TARGET COUNT: For a ~250-word abstract that mainly announces what will be argued: expect 1-4 genuine positions. For a ~250-word essay that actually delivers its arguments: expect 5-12 positions.

QUOTES: Verbatim passages of genuine intellectual density where the argument is actually present, not just announced. Do NOT mark promissory statements as high-signal quotes.

ARGUMENTS: Formal premise-conclusion reconstructions only. Premises must be real reasons present in the text, not just announced.

=== TEXT TO ANALYZE ===
${text}

Return JSON:
{
  "positions": [
    {
      "claim": "Clean declarative sentence in author's committed voice.",
      "type": "core|supporting|doctrinal",
      "section": "optional section name",
      "confidence": 85
    }
  ],
  "quotes": [
    {
      "text": "Verbatim passage from the text",
      "signalStrength": 8,
      "whyHighSignal": "Brief reason this passage delivers intellectual content",
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

=== YOUR MOST CRITICAL TASK: ELIMINATE PROMISSORY STATEMENTS ===

The previous extraction step sometimes fails to catch these. You must catch them now.

Promissory/meta statements that must be REMOVED — they are not intellectual positions:
- Any sentence containing "I will argue", "I aim to show", "I plan to demonstrate", "I hope to establish", "I intend to show"
- Any sentence containing "I argue that" when used as an announcement (e.g., "I argue that X is the case" = fine IF the claim is actually X; but "I argue in this paper that..." = remove)
- "I conclude that..." used as a structural marker at the end of an abstract or section
- "This thesis examines...", "This chapter investigates...", "In what follows..."
- "I engage with X, Y, Z", "I consider objections from..."
- Pure critique without positive alternative: "X's view is wrong/flawed/inadequate" — REMOVE unless a replacement view is explicitly given

CRITICAL DISTINCTION:
- "Neurosis results from dissociation from one's own aggression." → KEEP (delivers a claim)
- "I argue that Gaskin's critiques are faulty." → REMOVE (announces that the text will argue this; the actual argument is elsewhere)
- "Gaskin's critiques of McDowell are internally inconsistent for the following reasons: [reasons given]." → KEEP (delivers the claim)

=== OTHER CLEANING TASKS ===
1. REMOVE: questions, imperatives, examples, transitions, fragments
2. MERGE: near-duplicates into one clean statement
3. REWRITE: messy claims into clean, self-contained declarative sentences
4. RECALIBRATE: confidence — promissory statements that slipped through should be removed, not just lowered
5. RECLASSIFY: type if needed. Very few "core" items.

RAW POSITIONS:
${JSON.stringify(rawPositions, null, 2)}

RAW QUOTES:
${JSON.stringify(rawQuotes, null, 2)}

Note: If this text is primarily an abstract or introduction that announces what will be argued rather than delivering arguments, the cleaned list may be very short (1-5 items). That is correct. Do not pad it.

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

const SYNTHESIS_PROMPT = (positions: BookPosition[], quotes: BookQuote[], arguments_: BookArgument[], wordCount: number, author: string, rawText: string) => `
You are building the final synthesis for a Book Database.

AUTHOR: ${author}
WORD COUNT: ${wordCount}
POSITIONS EXTRACTED (${positions.length}):
${positions.map(p => `[${p.id}] (${p.type}, ${p.confidence}%) ${p.claim}`).join("\n")}

QUOTES (${quotes.length}):
${quotes.map(q => `[${q.id}] "${q.text.substring(0, 120)}..." (signal: ${q.signalStrength})`).join("\n")}

FIRST 600 WORDS OF ACTUAL TEXT (for context-sensitive scoring):
${rawText.split(/\s+/).slice(0, 600).join(" ")}

=== INTELLIGENCE SCORING: CRITICAL INSTRUCTIONS ===

You must distinguish between TWO fundamentally different text types:

TEXT TYPE A — "Delivering" texts: The text itself contains the actual arguments, theses, and reasoning. Dense original argumentation. Few words, many genuine intellectual commitments.
→ Example score range: 65-90

TEXT TYPE B — "Announcing" texts: The text (often an abstract, introduction, or dissertation summary) describes what the work will argue, examines, or demonstrates. The actual arguments are elsewhere. High word count relative to actual claims delivered.
→ Example score range: 30-55

TEXT TYPE C — "Survey/Critique" texts: The text primarily maps and criticizes existing views without offering substantive positive alternatives of its own.
→ Example score range: 40-60

=== SCORING RUBRIC ===

claimDensity: Genuine delivered intellectual commitments per 1000 words.
- Count only positions that deliver actual content — not positions that merely announce what will be argued
- An abstract that announces 7 theses to be proved elsewhere has effective claimDensity of 0-3, not 27
- A tight essay that delivers 3 dense arguments in 250 words has claimDensity of 10-15
- A full philosophy book with original content might score 4-10

conceptualCompression: How much original intellectual yield is packed into the space.
- 80-100: Extraordinary — nearly every sentence advances the argument; Wittgenstein-level compression
- 65-80: High — tight philosophical essay with genuine original moves
- 50-65: Moderate — some padding/repetition; clear argument but not maximally dense
- 35-50: Low — significant proportion is scaffolding, survey, or meta-commentary
- Below 35: Mostly filler, narrative, or structure-announcing

redundancyScore: Proportion of text that repeats the same ideas in slightly different words (0 = no repetition, 100 = constant repetition).

fillerRatio: Proportion of text that is NOT genuine intellectual argument — includes: promissory statements, transitions, examples, scaffolding, survey remarks, meta-commentary.
- A text primarily composed of "I will argue...", "I aim to show..." sentences: fillerRatio 0.55-0.80
- A tight philosophical essay delivering its actual arguments: fillerRatio 0.10-0.30
- An academic abstract announcing 5 chapters: fillerRatio 0.60-0.80

overallScore: Integer 0-100. Computed as follows:
- Base: a tight, dense, DELIVERING essay with genuine original theses = 70-85
- Adjust DOWN heavily for: primarily announcing/promissory language (-20 to -30), no positive contribution only critique (-10 to -15), abstract/intro genre (-15 to -25), high filler (-5 to -15)
- Adjust UP for: extraordinary compression, genuine novel framework, rigorous formal argument present in the text

CALIBRATION EXAMPLES FOR THIS SCORING SYSTEM:
- Freud-level dense analytical paragraph (250 words, 3 real arguments delivered): score ~75-85, claimDensity ~12-14
- Dissertation abstract (250 words, announces 5 things it will argue): score ~35-50, claimDensity ~1-3
- Good academic journal article (5000 words, solid but padded): score ~55-70, claimDensity ~3-6

qualitativeAssessment: Sharp, honest 2-3 sentence judgment. Explicitly identify whether this text DELIVERS arguments or merely ANNOUNCES them. Name what is genuinely strong and what fails. Be critical where warranted. This assessment should make clear the nature of the text to someone who hasn't read it.

=== OTHER TASKS ===
1. Build 3-6 CONCEPT CLUSTERS grouping related positions and quotes. Use exact IDs. Descriptions must be specific.
2. STYLOMETRIC THUMBPRINT:
   - signaturePhrases: 4-8 distinctive phrases/constructions from the actual text
   - abstractionLevel: "highly abstract" | "moderately abstract" | "mixed abstract/concrete" | "primarily concrete"
   - sentenceRhythmNotes: honest description of actual rhythm
   - notableStylisticTraits: 3-5 real observations

Return JSON:
{
  "conceptClusters": [
    {
      "id": "c1",
      "label": "Short theme label",
      "description": "Specific description",
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
- Premises must be reasons actually given in this text — not just announced for later
- If the text says "I will argue that X because Y and Z" but doesn't actually give Y and Z, do NOT extract this as an argument
- Conclusion must follow from the premises
- If an argument is weak or unclear, skip it
- Aim for 1-4 clean arguments for a short essay; 0 is acceptable if none are present

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
    start = end - 100;
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
    try {
      const extracted = await callLLMWithJSON(effectiveProvider, EXTRACTION_PROMPT(text, effectiveAuthor));
      allRawPositions = extracted.positions || [];
      allRawQuotes = extracted.quotes || [];
    } catch (err) {
      console.error("[bookToDatabase] Extraction failed:", err);
    }
  } else {
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

  // Phase 2: Cleaning pass
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
    console.error("[bookToDatabase] Cleaning pass failed:", err);
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

  // Phase 4: Synthesis
  onProgress({ stage: "synthesis", message: "Scoring and synthesizing…", current: 4, total: 4 });

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
    const synthesis = await callLLMWithJSON(effectiveProvider, SYNTHESIS_PROMPT(positions, quotes, bookArguments, wordCount, effectiveAuthor, text));

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
        overallScore: typeof intel.overallScore === "number" ? Math.max(0, Math.min(100, Math.round(intel.overallScore))) : 0,
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
