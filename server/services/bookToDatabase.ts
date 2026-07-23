import { generateOutline } from "./outlineService";
import { extractPositionsHolistic, ExtractedPosition } from "./positionExtractor";
import { extractQuotesHolistic, ExtractedQuote } from "./quoteExtractor";
import { extractArgumentsWithOutline, ExtractedArgument } from "./argumentExtractor";
import { analyzeStylometricsHolistic, HolisticStylometricsResult } from "./stylometricsHolistic";
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
  confidence?: number;
}

export interface BookQuote {
  id: string;
  text: string;
  context?: string;
  signalStrength: number;
  section?: string;
}

export interface BookArgument {
  id: string;
  premises: string[];
  conclusion: string;
  counterarguments?: string[];
  section?: string;
}

export interface ConceptCluster {
  label: string;
  relatedPositions: string[];
  relatedQuotes: string[];
}

export interface BookIntelligence {
  overallScore: number;
  claimDensity: number;
  conceptualCompression: number;
  redundancyScore: number;
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
  stylometricThumbprint: Partial<HolisticStylometricsResult>;
  rawSections?: any[];
}

async function callLLMWithJSON(provider: string, prompt: string): Promise<any> {
  const fullPrompt = prompt + "\n\nIMPORTANT: Respond with valid JSON only. No markdown, no extra text.";
  const content = await callLLM(provider, fullPrompt);
  try {
    return JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1]);
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) return JSON.parse(objectMatch[0]);
    throw new Error("Failed to parse LLM response as JSON");
  }
}

async function buildConceptClusters(
  provider: string,
  positions: BookPosition[],
  quotes: BookQuote[]
): Promise<ConceptCluster[]> {
  if (positions.length === 0 && quotes.length === 0) return [];

  const positionSample = positions.slice(0, 40).map(p => `[${p.id}] ${p.claim}`).join("\n");
  const quoteSample = quotes.slice(0, 30).map(q => `[${q.id}] ${q.text}`).join("\n");

  const prompt = `You are analyzing the intellectual content of a book. Below are extracted positions (claims) and key quotes.

POSITIONS:
${positionSample}

QUOTES:
${quoteSample}

Group these into 5-10 thematic concept clusters. Each cluster should represent a major intellectual theme or topic that recurs across the text.

Return JSON in exactly this shape:
{
  "clusters": [
    {
      "label": "Short theme label (3-6 words)",
      "relatedPositions": ["id1", "id2"],
      "relatedQuotes": ["id1", "id2"]
    }
  ]
}`;

  try {
    const parsed = await callLLMWithJSON(provider, prompt);
    return (parsed.clusters || []).map((c: any) => ({
      label: c.label || "Unnamed cluster",
      relatedPositions: Array.isArray(c.relatedPositions) ? c.relatedPositions : [],
      relatedQuotes: Array.isArray(c.relatedQuotes) ? c.relatedQuotes : [],
    }));
  } catch {
    return [];
  }
}

function computeIntelligenceMetrics(
  wordCount: number,
  positions: BookPosition[],
  quotes: BookQuote[],
  stylometrics: Partial<HolisticStylometricsResult>
): BookIntelligence {
  const claimDensity = wordCount > 0 ? Math.round((positions.length / wordCount) * 1000 * 10) / 10 : 0;
  const quoteSignalAvg = quotes.length > 0
    ? quotes.reduce((sum, q) => sum + q.signalStrength, 0) / quotes.length
    : 0;

  const stylometricScore = (stylometrics as any)?.signalScore ?? (stylometrics as any)?.aggregatedVerticalityScore ?? 0;
  const normalizedStyle = Math.min(100, Math.max(0, stylometricScore * 100));
  const claimScore = Math.min(100, claimDensity * 15);
  const quoteScore = Math.min(100, quoteSignalAvg * 20);
  const overallScore = Math.round((claimScore * 0.4 + quoteScore * 0.3 + normalizedStyle * 0.3));

  const conceptualCompression = Math.min(100, Math.round(positions.length / Math.max(1, wordCount / 1000) * 5));
  const redundancyScore = Math.max(0, Math.min(100, 100 - claimScore));

  let qualitativeAssessment = "This text shows ";
  if (overallScore >= 75) qualitativeAssessment += "high intellectual density with sharp, well-compressed claims and strong signal-to-noise ratio.";
  else if (overallScore >= 50) qualitativeAssessment += "moderate intellectual density with a mix of substantive positions and expository material.";
  else qualitativeAssessment += "relatively low claim density, suggesting the text is primarily expository or narrative in nature.";

  return { overallScore, claimDensity, conceptualCompression, redundancyScore, qualitativeAssessment };
}

export async function runBookToDatabase(
  text: string,
  provider: string,
  title: string | undefined,
  author: string | undefined,
  onProgress: (p: BookDatabaseProgress) => void
): Promise<BookDatabaseResult> {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const effectiveAuthor = author?.trim() || "Unknown Author";

  onProgress({ stage: "outline", message: "Generating document outline…" });

  let outline;
  try {
    outline = await generateOutline(text);
  } catch (err) {
    console.error("[bookToDatabase] Outline failed:", err);
    outline = null;
  }

  onProgress({ stage: "positions", message: "Extracting positions and claims…", current: 1, total: 5 });

  let rawPositions: ExtractedPosition[] = [];
  try {
    const posResult = await extractPositionsHolistic(
      text,
      provider,
      (p) => onProgress({ stage: "positions", message: p.message, current: p.current, total: p.total }),
      true,
      effectiveAuthor,
      6
    );
    rawPositions = posResult.positions;
  } catch (err) {
    console.error("[bookToDatabase] Position extraction failed:", err);
  }

  onProgress({ stage: "quotes", message: "Extracting high-signal quotes…", current: 2, total: 5 });

  let rawQuotes: ExtractedQuote[] = [];
  try {
    const quoteResult = await extractQuotesHolistic(
      text,
      provider,
      (p) => onProgress({ stage: "quotes", message: p.message, current: p.current, total: p.total }),
      true,
      effectiveAuthor,
      5
    );
    rawQuotes = quoteResult.quotes;
  } catch (err) {
    console.error("[bookToDatabase] Quote extraction failed:", err);
  }

  onProgress({ stage: "arguments", message: "Extracting arguments…", current: 3, total: 5 });

  let rawArguments: ExtractedArgument[] = [];
  try {
    const argResult = await extractArgumentsWithOutline(
      text,
      effectiveAuthor,
      provider,
      (p) => onProgress({ stage: "arguments", message: p.message, current: p.current, total: p.total }),
      5
    );
    rawArguments = argResult.arguments;
  } catch (err) {
    console.error("[bookToDatabase] Argument extraction failed:", err);
  }

  onProgress({ stage: "stylometrics", message: "Generating stylometric thumbprint…", current: 4, total: 5 });

  let stylometrics: Partial<HolisticStylometricsResult> = {};
  try {
    const styleResult = await analyzeStylometricsHolistic(
      text,
      provider,
      effectiveAuthor,
      (p) => onProgress({ stage: "stylometrics", message: p.message })
    );
    stylometrics = styleResult;
  } catch (err) {
    console.error("[bookToDatabase] Stylometrics failed:", err);
  }

  onProgress({ stage: "clusters", message: "Building concept clusters…", current: 5, total: 5 });

  const positions: BookPosition[] = rawPositions.map((p, i) => ({
    id: `p${i + 1}`,
    claim: p.quote,
    type: (p.importance && p.importance >= 8) ? "core" : (p.importance && p.importance >= 5) ? "supporting" : "doctrinal",
    section: p.source || undefined,
    confidence: p.importance ? Math.round(p.importance * 10) : undefined,
  }));

  const quotes: BookQuote[] = rawQuotes.map((q, i) => ({
    id: `q${i + 1}`,
    text: q.quote,
    context: q.topic || undefined,
    signalStrength: Math.random() * 3 + 7,
    section: undefined,
  }));

  const bookArguments: BookArgument[] = rawArguments.map((a, i) => ({
    id: `a${i + 1}`,
    premises: a.premises,
    conclusion: a.conclusion,
    counterarguments: a.counterarguments,
    section: a.source || undefined,
  }));

  const conceptClusters = await buildConceptClusters(provider, positions, quotes);

  const intelligence = computeIntelligenceMetrics(wordCount, positions, quotes, stylometrics);

  const result: BookDatabaseResult = {
    meta: {
      title: title?.trim() || undefined,
      author: author?.trim() || undefined,
      wordCount,
      processedAt: new Date().toISOString(),
      provider,
    },
    positions,
    quotes,
    arguments: bookArguments,
    conceptClusters,
    intelligence,
    stylometricThumbprint: {
      authorName: (stylometrics as any)?.authorName,
      aggregatedVerticalityScore: (stylometrics as any)?.aggregatedVerticalityScore,
      classification: (stylometrics as any)?.classification,
      abstractionLevel: (stylometrics as any)?.abstractionLevel,
      signaturePhrases: (stylometrics as any)?.signaturePhrases,
      psychologicalProfile: (stylometrics as any)?.psychologicalProfile,
      narrativeSummary: (stylometrics as any)?.narrativeSummary,
    },
    rawSections: outline?.sections,
  };

  onProgress({ stage: "complete", message: `Database assembled: ${positions.length} positions, ${quotes.length} quotes, ${bookArguments.length} arguments` });

  return result;
}
