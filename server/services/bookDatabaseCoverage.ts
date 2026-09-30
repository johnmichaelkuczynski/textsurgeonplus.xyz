export interface BookSourcePart {
  partIndex: number;
  chapterIndex: number;
  chapterTitle: string;
  chapterPartIndex?: number;
  start: number;
  end: number;
}

export interface BookTextPart extends BookSourcePart {
  text: string;
  wordCount: number;
}

export interface BookCoverage {
  totalCharacters: number;
  processedCharacters: number;
  totalParts: number;
  processedParts: number;
  chapters: { chapterIndex: number; title: string; partCount: number; processedParts: number; wordCount: number }[];
  aggregation: "word-weighted";
  assessment?: "whole-text-reconciled";
}

/** Partition the ENTIRE original string. Limits bound each request, never coverage. */
export function partitionBookText(text: string, limit = 12000): BookTextPart[] {
  if (limit < 100) throw new Error("Book analysis segment limit must be at least 100 characters.");
  const headings = Array.from(text.matchAll(/^[ \t]*chapter[ \t]+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b[^\r\n]*$/gmi));
  const sections = headings.length
    ? headings.map((match, index) => ({
      start: index === 0 ? 0 : match.index!,
      end: headings[index + 1]?.index ?? text.length,
      title: match[0].trim(),
    }))
    : [{ start: 0, end: text.length, title: "Full text" }];
  const parts: BookTextPart[] = [];
  for (const [chapterIndex, section] of Array.from(sections.entries())) {
    let start = section.start;
    let chapterPartIndex = 0;
    while (start < section.end) {
      let end = Math.min(start + limit, section.end);
      if (end < section.end) {
        const window = text.slice(start, end);
        const paragraph = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\r\n\r\n"));
        const whitespace = Array.from(window.matchAll(/\s+/g)).at(-1)?.index ?? -1;
        const boundary = paragraph > limit / 2 ? paragraph : whitespace;
        if (boundary > limit / 2) end = start + boundary;
        // Never separate a UTF-16 surrogate pair.
        if (/[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
      }
      const chunk = text.slice(start, end);
      parts.push({
        partIndex: parts.length, chapterIndex, chapterTitle: section.title, chapterPartIndex: chapterPartIndex++,
        start, end, text: chunk,
        wordCount: chunk.trim() ? chunk.trim().split(/\s+/).length : 0,
      });
      start = end;
    }
  }
  if (parts.map((part) => part.text).join("") !== text) {
    throw new Error("Book analysis coverage error: the source was not partitioned completely.");
  }
  return parts;
}

export function coverageFor(text: string, parts: BookTextPart[], processed: number): BookCoverage {
  const completed = parts.slice(0, processed);
  const chapters = Array.from(new Set(parts.map((part) => part.chapterIndex))).map((chapterIndex) => {
    const chapterParts = parts.filter((part) => part.chapterIndex === chapterIndex);
    return {
      chapterIndex, title: chapterParts[0].chapterTitle,
      partCount: chapterParts.length,
      processedParts: completed.filter((part) => part.chapterIndex === chapterIndex).length,
      wordCount: chapterParts.reduce((sum, part) => sum + part.wordCount, 0),
    };
  });
  return {
    totalCharacters: text.length,
    processedCharacters: completed.reduce((sum, part) => sum + part.text.length, 0),
    totalParts: parts.length, processedParts: completed.length, chapters,
    aggregation: "word-weighted",
  };
}