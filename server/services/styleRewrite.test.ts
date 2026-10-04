import assert from "node:assert/strict";
import test from "node:test";
import { chunkStyleSource, findNovelStyleOverlap, rewriteInSampleStyle, validateStyleRewriteInput } from "./styleRewrite";

test("style rewrite requires separate substantive source and sample texts", () => {
  const source = Array.from({ length: 25 }, (_, i) => `source${i}`).join(" ");
  const sample = Array.from({ length: 45 }, (_, i) => `sample${i}`).join(" ");
  assert.equal(validateStyleRewriteInput({ text: source, styleSample: sample }).provider, "openai");
  assert.throws(() => validateStyleRewriteInput({ text: source, styleSample: "too short" }), /40 words/);
});

test("paragraph-aware chunking retains the complete source in order", () => {
  const paragraphs = ["alpha one two", "beta three four", "gamma five six"];
  const chunks = chunkStyleSource(paragraphs.join("\n\n"), 5);
  assert.deepEqual(chunks, [paragraphs[0], paragraphs[1], paragraphs[2]]);
  assert.equal(chunks.join("\n\n"), paragraphs.join("\n\n"));
});

test("verbatim sample language is rejected unless it already belongs to Text A", () => {
  const phrase = "this exact sequence of ten words came only from style text";
  const output = `A rewrite that says ${phrase} and then continues.`;
  assert.equal(findNovelStyleOverlap("unrelated source material", phrase, output, 11), phrase);
  assert.equal(findNovelStyleOverlap(`source includes ${phrase}`, phrase, output, 11), null);
});

test("style rewriting analyzes Text B but rewrites and reviews Text A", async () => {
  const text = "The source makes a careful claim about rational action and preserves its qualification. ".repeat(4).trim();
  const sample = "Measured sentences establish a thesis and then qualify it through deliberate transitions. ".repeat(6).trim();
  const profile = {
    overview: "measured", sentenceRhythm: "varied", syntax: "complex", diction: "formal",
    paragraphing: "medium", transitions: "explicit", voice: "assertive", rhetoricalHabits: "qualification",
    figurativeLanguage: "minimal", distinctiveDevices: ["clefts"], tendenciesToAvoid: ["metaphor"],
  };
  const prompts: string[] = [];
  const model = async (_provider: string, prompt: string) => {
    prompts.push(prompt);
    if (prompt.startsWith("Analyze")) return JSON.stringify(profile);
    if (prompt.startsWith("Rewrite")) return JSON.stringify({ rewrittenText: text });
    return JSON.stringify({ contentPreserved: true, noAddedSubstance: true, styleOnly: true, instructionsFollowed: true, issues: [] });
  };

  const result = await rewriteInSampleStyle({ text, styleSample: sample, instructions: "Use clefts; avoid metaphor." }, undefined, model);
  assert.equal(result.rewrittenText, text);
  assert.match(prompts[0], /STYLE SAMPLE \(TEXT B\)/);
  assert.doesNotMatch(prompts[1], new RegExp(sample.slice(0, 40)));
  assert.match(prompts[1], /style transfer, not content revision/i);
  assert.match(prompts[2], /Compare SOURCE and REWRITE/);
});
