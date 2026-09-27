export function countRewriteWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function requestedRewriteWords(instructions: string): number | undefined {
  const match = instructions.match(/\b(?:approximately|about|around|roughly|aim for|target(?:ing)?|write|produce)?\s*(\d{2,4})(?:\s*[-–]\s*\d{2,4})?\s*[- ]?\s*words?\b/i);
  if (!match) return undefined;
  const target = Number(match[1]);
  return target >= 100 && target <= 2000 ? target : undefined;
}

export function rewriteLengthIssue(text: string, target: number): string | undefined {
  const words = countRewriteWords(text);
  const minimum = Math.round(target * 0.8);
  const maximum = Math.round(target * 1.2);
  return words < minimum || words > maximum
    ? `Length check failed: ${words} words, expected approximately ${target} (${minimum}–${maximum} accepted).`
    : undefined;
}

// These anchors apply only to the supplied diagnostic fixtures, not arbitrary user input.
export function diagnosticFidelityIssues(text: string): string[] {
  const sourceTerms = [/\bdocuments?\b/i, /\bchunks?\b/i, /\bcoheren(?:ce|t)\b/i, /\btractatus\b/i];
  const retained = sourceTerms.filter((term) => term.test(text)).length;
  const importedTopic = /\bnatural law\b|\bslavery\b|\blegal positivism\b|\btorture\b|\b(?:problem of )?induction\b|\bcaus(?:al|ally|ation)\b|\bspace[- ]time manifold\b|\bmanifold\b|\bstatutory (?:law|authority)\b|\bmoral authority\b|\bHume\b|\bdeterminis(?:m|tic)\b/i.test(text);
  return [
    ...(importedTopic ? ["Source-fidelity check failed: the rewrite imported the style sample's natural-law subject."] : []),
    ...(retained < 2 ? ["Source-fidelity check failed: fewer than two central Box A terms (document, chunk, coherence, tractatus) remain."] : []),
  ];
}