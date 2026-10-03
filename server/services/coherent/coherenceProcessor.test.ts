import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkChunks, validateTractatusOutput } from "./coherenceProcessor";

test("Tractatus validation accepts only numbered propositions", () => {
  assert.equal(
    validateTractatusOutput("• 4. Knowledge is inferential.\n• 4.1 Inference has premises.", 4),
    "• 4. Knowledge is inferential.\n• 4.1 Inference has premises."
  );
  assert.throws(
    () => validateTractatusOutput("• 4. Knowledge is inferential.\nThis is copied source prose.", 4),
    /Non-proposition text/
  );
  assert.throws(() => validateTractatusOutput("• 3. Wrong chapter.", 4), /Expected chapter 4/);
});

test("chapter-aware chunks retain every source chapter and its part position", () => {
  const words = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(" ");
  const sections = Array.from({ length: 8 }, (_, index) => ({
    title: `Chapter ${index + 1}`,
    chapterNumber: index + 1,
    text: words(`chapter${index + 1}-`, index === 0 ? 1500 : index === 7 ? 2100 : 200)
  }));
  const chunks = buildWorkChunks("ignored", sections);

  assert.deepEqual(chunks.map((chunk) => chunk.chapterNumber), [1, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8]);
  assert.deepEqual(chunks.map((chunk) => chunk.chapterChunkIndex), [0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
  assert.deepEqual(chunks.map((chunk) => chunk.chapterChunkCount), [2, 2, 1, 1, 1, 1, 1, 1, 3, 3, 3]);
});
