export const MAX_WORKSHOP_DOCUMENT_CHARS = 2_000_000;
export const WORKSHOP_CHUNK_CHARS = 3_000;

export function splitWorkshopDocument(text: string): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + WORKSHOP_CHUNK_CHARS, text.length);
    if (end < text.length) {
      const earliest = start + Math.floor(WORKSHOP_CHUNK_CHARS / 2);
      const breaks = [
        text.lastIndexOf("\n\n", end - 1),
        text.lastIndexOf("\n", end - 1),
        Math.max(text.lastIndexOf(". ", end - 1), text.lastIndexOf("? ", end - 1), text.lastIndexOf("! ", end - 1)),
        text.lastIndexOf(" ", end - 1),
      ];
      const boundary = breaks.find((position) => position >= earliest);
      if (boundary !== undefined) {
        end = Math.min(end, boundary + (text.slice(boundary, boundary + 2) === "\n\n" ? 2 : 1));
      }
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    const part = text.slice(start, end);
    if (part.trim()) chunks.push(part);
    start = end;
  }
  return chunks;
}