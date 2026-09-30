import type { BookIntelligence, StylometricThumbprint, CleanedNode } from "./bookToDatabase2";

export interface AssessmentContribution {
  label: string;
  wordCount: number;
  intelligence: BookIntelligence;
  stylometricThumbprint: StylometricThumbprint;
  themes: string[];
}

/** Compare claims across segments; local redundancy alone cannot see repeated chapters. */
export function crossSegmentRepetition(nodes: CleanedNode[]): { duplicateClaims: number; totalClaims: number } {
  const firstSegment = new Map<string, number | undefined>();
  let duplicateClaims = 0;
  for (const node of nodes) {
    const key = node.claim.toLowerCase().replace(/[^a-z0-9\u0080-\uffff]+/g, " ").trim();
    if (firstSegment.has(key) && firstSegment.get(key) !== node.source?.partIndex) duplicateClaims++;
    else if (!firstSegment.has(key)) firstSegment.set(key, node.source?.partIndex);
  }
  return { duplicateClaims, totalClaims: nodes.length };
}

/**
 * Reconcile ALL local analyses. Large books are reduced in complete batches,
 * never by taking the beginning of the collection.
 */
export async function assessWholeBook(
  contributions: AssessmentContribution[],
  repetition: ReturnType<typeof crossSegmentRepetition>,
  ask: (prompt: string) => Promise<any>,
  validate: (result: any) => void,
  onBatch: (message: string) => void,
): Promise<{ intelligence: BookIntelligence; stylometricThumbprint: StylometricThumbprint }> {
  let reports = contributions;
  for (;;) {
    const batches: AssessmentContribution[][] = [];
    let batch: AssessmentContribution[] = [];
    let size = 0;
    for (const report of reports) {
      const length = JSON.stringify(report).length;
      if (batch.length && size + length > 60000) {
        batches.push(batch); batch = []; size = 0;
      }
      batch.push(report); size += length;
    }
    if (batch.length) batches.push(batch);
    const next: AssessmentContribution[] = [];
    for (const [index, group] of Array.from(batches.entries())) {
      onBatch(`Reconciling whole-text intelligence and style — batch ${index + 1} of ${batches.length}…`);
      const result = await ask(`WHOLE-TEXT RECONCILIATION
Assess the supplied collection as a whole, using EVERY contribution below, not only the opening.
All source segments were separately analyzed in full. These are their complete analytical reports and principal claims.
Compare claims and themes ACROSS segments: distinguish repetition from substantive extension. Do not simply average local redundancy or originality scores.
The whole source has ${repetition.totalClaims} cleaned claims, including ${repetition.duplicateClaims} exact repeated claims across different source segments. This is a lower bound on repetition; consider paraphrased repetition too.
Score overall intelligence, conceptual compression, fractal development, filler, claim density and redundancy in the same scales as the supplied reports (0–100, except claimDensity = claims per 1000 words and fillerRatio = 0–1). Weight rates by word counts where appropriate, but assess cross-segment relationships for whole-text scores.
Summarize style across ALL contributions and retain meaningful variation.
If this is an intermediate batch, describe this group's scope accurately; the resulting report will be combined with other groups, not substituted for them.
Return ONLY JSON:
{"intelligence":{"overallScore":70,"claimDensity":3,"conceptualCompression":65,"redundancyScore":20,"fillerRatio":0.1,"fractalScore":60,"qualitativeAssessment":"A specific whole-collection assessment."},"stylometricThumbprint":{"signaturePhrases":["..."],"abstractionLevel":"...","sentenceRhythmNotes":"...","notableStylisticTraits":["..."]},"themes":["principal claims and cross-segment relationships"]}

ALL CONTRIBUTIONS:
${JSON.stringify(group)}`);
      validate(result);
      if (!Array.isArray(result.themes) || !result.themes.every((theme: unknown) => typeof theme === "string")) {
        throw new Error("Whole-text reconciliation returned no valid themes.");
      }
      next.push({
        label: group.map((report) => report.label).join("; "),
        wordCount: group.reduce((sum, report) => sum + report.wordCount, 0),
        intelligence: result.intelligence, stylometricThumbprint: result.stylometricThumbprint, themes: result.themes,
      });
    }
    if (next.length === 1) return next[0];
    if (next.length >= reports.length) throw new Error("Whole-text reconciliation exceeded the model's safe batch size; analysis is incomplete.");
    reports = next;
  }
}