import assert from "node:assert/strict";
import test from "node:test";
import { createSourceQuoteMatcher } from "./bookDatabaseQuotes";

test("returns unchanged literal quotations", () => {
  assert.deepEqual(createSourceQuoteMatcher("Before. Exact passage. After.")("Exact passage."),
    { text: "Exact passage.", corrected: false });
});

test("restores actual source whitespace, Unicode punctuation, and ellipses", () => {
  const exact = "“Reason’s\u00a0limits”\n\nmatter — even now…";
  const match = createSourceQuoteMatcher("Before. " + exact + " After.")("\"Reason's limits\" matter - even now...");
  assert.deepEqual(match, { text: exact, corrected: true });
});

test("removes model-added outer delimiters only when the enclosed passage matches", () => {
  assert.deepEqual(createSourceQuoteMatcher("An exact passage exists.")('"An exact passage exists."'),
    { text: "An exact passage exists.", corrected: true });
});

test("rejects fabricated, paraphrased, differently cased, and blank text", () => {
  const match = createSourceQuoteMatcher("Evidence supports a tentative inference.");
  for (const candidate of ["Evidence proves a certain inference.", "evidence supports a tentative inference.", "Absent passage.", " "]) {
    assert.equal(match(candidate), null);
  }
});

test("preserves Unicode offsets and does not match a fragment of an expanded character", () => {
  assert.deepEqual(createSourceQuoteMatcher("😀 Before. A ﬀ ligature appears. After.")("A ff ligature appears."),
    { text: "A ﬀ ligature appears.", corrected: true });
  assert.equal(createSourceQuoteMatcher("ﬀ")("f"), null);
  assert.deepEqual(createSourceQuoteMatcher("ﬀ; f")("f"), { text: "f", corrected: false });
});