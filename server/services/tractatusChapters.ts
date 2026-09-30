export interface BookChapter {
  title: string;
  text: string;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

function chapterNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);
  if (WORD_NUMBERS[value.toLowerCase()]) return WORD_NUMBERS[value.toLowerCase()];
  if (!/^[IVXLCDM]+$/i.test(value)) return null;
  const digits: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const roman = value.toUpperCase();
  let total = 0;
  for (let i = 0; i < roman.length; i++) {
    total += digits[roman[i]] < (digits[roman[i + 1]] || 0) ? -digits[roman[i]] : digits[roman[i]];
  }
  return total;
}

/** Only standalone chapter headings count; numbered paragraphs and table-of-contents entries do not. */
export function splitBookChapters(text: string, allowShortChapters = false): BookChapter[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const headings: { line: number; title: string; number: number }[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line.length > 140 || /\.{3,}\s*\d*$/.test(line)) continue;
    const match = /^chapter\s+(\d{1,3}|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b(?:\s*[.:—–-]\s*|\s+)?(?:\S.*)?$/i.exec(line);
    if (!match) continue;
    const number = chapterNumber(match[1]);
    if (number === null || number < 1 || number > 999) continue;
    headings.push({ line: index, title: line, number });
  }

  const chapters = headings.map((heading, index) => {
    const end = headings[index + 1]?.line ?? lines.length;
    return { title: heading.title, number: heading.number, text: lines.slice(heading.line, end).join("\n").trim() };
  });
  // A table of contents repeats the chapter sequence before the actual text.
  // Start after the last sequence reset, then reject any incomplete body chapter.
  const lastReset = chapters.reduce((offset, chapter, index) =>
    index > 0 && chapter.number <= chapters[index - 1].number ? index : offset, 0);
  const candidateChapters = chapters.slice(lastReset);
  const firstBody = candidateChapters.findIndex((chapter) => chapter.text.split(/\s+/).length >= (allowShortChapters ? 1 : 100));
  if (firstBody < 0) return [];
  const bodyChapters = candidateChapters.slice(firstBody);
  if (bodyChapters.length < 2 || bodyChapters.some((chapter) => chapter.text.split(/\s+/).length < (allowShortChapters ? 1 : 100))) return [];
  if (new Set(bodyChapters.map((chapter) => chapter.number)).size !== bodyChapters.length) return [];
  if (bodyChapters.some((chapter, index) => index > 0 && chapter.number <= bodyChapters[index - 1].number)) return [];
  return bodyChapters.map(({ title, text }) => ({ title, text }));
}