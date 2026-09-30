import type { BookSourcePart } from "./bookDatabaseCoverage";

export interface QuoteVerification {
  verifiedCount: number;
  correctedCount: number;
  rejectedQuotes: { text: string; reason: string; source: BookSourcePart }[];
}

// Only typography is normalized, never words or meaning. Offsets recover the
// literal source passage so accepted quotations are always actual substrings.
function canonicalize(text: string) {
  let value = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const character of text) {
    const start = offset;
    offset += character.length;
    const normalized = character.normalize("NFKC")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2013\u2014]/g, "-");
    for (const unit of normalized) {
      const output = /\s/.test(unit) ? " " : unit;
      if (output === " " && value.endsWith(" ")) {
        ends[ends.length - 1] = offset;
        continue;
      }
      value += output;
      // Index arrays follow UTF-16 string indices, including surrogate pairs.
      for (let index = 0; index < output.length; index++) {
        starts.push(start);
        ends.push(offset);
      }
    }
  }
  return { value, starts, ends };
}

export function createSourceQuoteMatcher(source: string) {
  const canonical = canonicalize(source);
  return (candidate: string): { text: string; corrected: boolean } | null => {
    if (!candidate.trim()) return null;
    if (source.includes(candidate)) return { text: candidate, corrected: false };
    const requested = canonicalize(candidate).value.trim();
    const alternatives = [requested];
    // Models sometimes include quotation delimiters that are not in the text.
    if ((requested.startsWith('"') && requested.endsWith('"')) ||
        (requested.startsWith("'") && requested.endsWith("'"))) {
      alternatives.push(requested.slice(1, -1).trim());
    }
    for (const alternative of alternatives) {
      if (!alternative) continue;
      let index = canonical.value.indexOf(alternative);
      while (index >= 0) {
        const last = index + alternative.length - 1;
        const startsInsideCharacter = index > 0 && canonical.starts[index] === canonical.starts[index - 1];
        const endsInsideCharacter = last + 1 < canonical.ends.length && canonical.ends[last] === canonical.ends[last + 1];
        if (!startsInsideCharacter && !endsInsideCharacter) {
          const exact = source.slice(canonical.starts[index], canonical.ends[last]);
          return { text: exact, corrected: exact !== candidate };
        }
        index = canonical.value.indexOf(alternative, index + 1);
      }
    }
    return null;
  };
}