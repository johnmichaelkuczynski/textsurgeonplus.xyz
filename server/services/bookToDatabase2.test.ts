import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { callLLM } from "../llm";
import { generateBookDatabase2 } from "./bookToDatabase2";
import { coverageFor, partitionBookText } from "./bookDatabaseCoverage";

const samplePath = resolve(
  process.cwd(),
  "attached_assets/XXX_VERSION_OF_Theoretical_Knowledge___Inductive_Inference_1790809009616.txt",
);

function assertContiguousPartition(text: string, limit?: number) {
  const parts = partitionBookText(text, limit);
  let cursor = 0;
  for (const part of parts) {
    assert.equal(part.start, cursor, "parts must have no gaps or overlaps");
    assert.equal(part.end, part.start + part.text.length);
    assert.equal(part.text, text.slice(part.start, part.end));
    cursor = part.end;
  }
  assert.equal(cursor, text.length);
  assert.equal(parts.map((part) => part.text).join(""), text);
  return parts;
}

function extractPromptBlock(prompt: string, label: string): string {
  const marker = `${label}:\n"""\n`;
  const start = prompt.indexOf(marker);
  assert.notEqual(start, -1, `missing ${label} prompt block`);
  const contentStart = start + marker.length;
  const end = prompt.indexOf('\n"""', contentStart);
  assert.notEqual(end, -1, `unterminated ${label} prompt block`);
  return prompt.slice(contentStart, end);
}

test("partitions the attached 8-chapter, 34,587-word book exactly and contiguously", () => {
  const text = readFileSync(samplePath, "utf8");
  assert.equal(text.trim().split(/\s+/).length, 34_587);

  const parts = assertContiguousPartition(text);
  const coverage = coverageFor(text, parts, parts.length);
  assert.equal(coverage.totalCharacters, text.length);
  assert.equal(coverage.processedCharacters, text.length);
  assert.equal(coverage.processedParts, coverage.totalParts);
  assert.equal(coverage.chapters.length, 8);
  assert.deepEqual(
    coverage.chapters.map(({ chapterIndex }) => chapterIndex),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
  assert.ok(coverage.chapters.every((chapter) => chapter.partCount > 0 && chapter.processedParts === chapter.partCount));
  assert.equal(coverage.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0), 34_587);
});

test("retains a long no-heading document and its final sentinel", () => {
  const text = `${Array.from({ length: 6_000 }, (_, index) => `token${index}`).join(" ")} FINAL_TAIL_SENTINEL`;
  assert.ok(text.length > 30_000);
  const parts = assertContiguousPartition(text);
  assert.ok(parts.length > 1);
  assert.equal(parts[0].chapterTitle, "Full text");
  assert.ok(parts.at(-1)!.text.endsWith("FINAL_TAIL_SENTINEL"));
});

test("recognizes more than ten chapters without dropping any chapter text", () => {
  const text = Array.from({ length: 13 }, (_, index) =>
    `Chapter ${index + 1}: Topic ${index + 1}\nUnique chapter body ${index + 1}.`,
  ).join("\n");
  const parts = assertContiguousPartition(text);
  const coverage = coverageFor(text, parts, parts.length);
  assert.equal(coverage.chapters.length, 13);
  assert.deepEqual(coverage.chapters.map((chapter) => chapter.title), Array.from(
    { length: 13 },
    (_, index) => `Chapter ${index + 1}: Topic ${index + 1}`,
  ));
});

test("keeps a no-whitespace Unicode token intact, including a surrogate pair at a split", () => {
  const text = `${"界".repeat(11_999)}😀${"終".repeat(90)}`;
  const parts = assertContiguousPartition(text);
  assert.ok(parts.length > 1);
  assert.equal(parts.map((part) => part.text).join(""), text);
  for (const part of parts) {
    assert.ok(!/[\uD800-\uDBFF]$/.test(part.text), "a part must not end with an unmatched high surrogate");
    assert.ok(!/^[\uDC00-\uDFFF]/.test(part.text), "a part must not start with an unmatched low surrogate");
  }
});

test("retains tiny chapters and a tiny final tail after a large chapter", () => {
  const text = `Chapter 1: Long\n${"substantive text ".repeat(1_000)}\nChapter 2: Tiny\nz`;
  const parts = assertContiguousPartition(text);
  const coverage = coverageFor(text, parts, parts.length);
  assert.equal(coverage.chapters.length, 2);
  assert.ok(parts.at(-1)!.text.endsWith("z"));
  assert.equal(parts.at(-1)!.chapterTitle, "Chapter 2: Tiny");
  assert.equal(coverage.chapters[1].wordCount, 4);
});

interface PromptCapture {
  tree: { prompt: string; segmentIndex: number }[];
  cleaning: { prompt: string; segmentIndex: number }[];
  assembly: { prompt: string; segmentIndex: number }[];
  reconciliation: string[];
  calls: number;
}

function pipelineText(): string {
  const repeatCounts = [240, 210, 175, 140, 105, 70, 45, 25];
  return repeatCounts.map((count, index) => {
    const chapterNumber = index + 1;
    const quote = `Exact source quotation for chapter ${chapterNumber}: evidence supports inference.`;
    const repeated = `Chapter${chapterNumber} claims support evidence inference. `.repeat(count);
    const tail = chapterNumber === 8 ? " FINAL_BOOK_TAIL_SENTINEL." : ` CHAPTER_${chapterNumber}_TAIL.`;
    return `Chapter ${chapterNumber}: Pipeline chapter ${chapterNumber}\n${quote} ${repeated}${tail}`;
  }).join("\n\n");
}

function buildHarness(text: string, options: {
  failTreeAt?: number;
  invalidCleaningAt?: number;
  invalidArgumentsAt?: number;
  cyclicPositionsAt?: number;
  missingIntermediateParentAt?: number;
  quoteTransform?: (quote: string, index: number) => string;
  extraUnmatchedQuote?: boolean;
} = {}) {
  const segments = partitionBookText(text);
  const captured: PromptCapture = { tree: [], cleaning: [], assembly: [], reconciliation: [], calls: 0 };
  let activeSegmentIndex = -1;
  const rawTrees = new Map<number, string>();
  const cleanTrees = new Map<number, string>();

  const model = (async (_provider: string, prompt: string, _signal?: AbortSignal): Promise<string> => {
    captured.calls += 1;

    if (prompt.startsWith("Convert this text into a Tractatus-style hierarchical numbered proposition tree.")) {
      const segmentText = extractPromptBlock(prompt, "TEXT");
      activeSegmentIndex = segments.findIndex((part) => part.text === segmentText);
      assert.notEqual(activeSegmentIndex, -1, "tree prompt must carry one complete source segment");
      captured.tree.push({ prompt, segmentIndex: activeSegmentIndex });
      if (options.failTreeAt === activeSegmentIndex) throw new Error("deterministic mocked model failure");

      const rawRootClaim = activeSegmentIndex === 0
        ? `${"RAW_TREE_FULL_CONTENT ".repeat(540)}RAW_TREE_END_CHAPTER_1`
        : `Source chapter ${activeSegmentIndex + 1} establishes a distinct inference.`;
      const rawTree = `1.0 ${rawRootClaim}\n1.1 A dependent supporting inference is stated.`;
      rawTrees.set(activeSegmentIndex, rawTree);
      return rawTree;
    }

    if (prompt.startsWith("You are an aggressive intellectual editor.")) {
      const rawTree = extractPromptBlock(prompt, "RAW TREE");
      const index = [...rawTrees.entries()].find(([, tree]) => tree === rawTree)?.[0];
      assert.notEqual(index, undefined, "cleaning must receive a complete generated tree");
      captured.cleaning.push({ prompt, segmentIndex: index! });
      if (options.invalidCleaningAt === index) return "{ this is deliberately invalid JSON";

      const childClaim = `Cleaned supporting claim ${index! + 1}: ${"CHILD_CLAIM_CONTENT ".repeat(185)}CLEAN_CHILD_END_${index! + 1}`;
      const rootClaimForTree = `Repeated foundational principle: ${"ROOT_CLAIM_CONTENT ".repeat(190)}CLEAN_ROOT_END`;
      const nodes = [
        {
          id: "local-root",
          number: "1.0",
          claim: rootClaimForTree,
          type: "core" as const,
          depth: 0,
          parentId: null,
        },
        {
          id: "local-child",
          number: options.missingIntermediateParentAt === index ? "1.1.1" : "1.1",
          claim: childClaim,
          type: "supporting" as const,
          depth: options.missingIntermediateParentAt === index ? 2 : 1,
          parentId: options.missingIntermediateParentAt === index ? "missing-intermediate" : "local-root",
        },
      ];
      cleanTrees.set(index!, nodes
        .map((node) => `${"  ".repeat(node.depth)}${node.number} [${node.type.toUpperCase()}] ${node.claim}`)
        .join("\n"));
      return JSON.stringify({ nodes });
    }

    if (prompt.startsWith("WHOLE-TEXT RECONCILIATION")) {
      captured.reconciliation.push(prompt);
      return JSON.stringify({
        intelligence: {
          overallScore: 91,
          claimDensity: 4.25,
          conceptualCompression: 73,
          redundancyScore: 11,
          fillerRatio: 0.04,
          fractalScore: 82,
          qualitativeAssessment: "The reconciled whole-text assessment spans every chapter.",
        },
        stylometricThumbprint: {
          signaturePhrases: ["whole-text signature"],
          abstractionLevel: "Whole-book abstraction",
          sentenceRhythmNotes: "Whole-book rhythm",
          notableStylisticTraits: ["cross-chapter development"],
        },
        themes: ["Whole-book theme and cross-chapter development"],
      });
    }

    assert.ok(prompt.startsWith("You are a philosophical analyst producing a structured Book Database"));
    const segmentText = extractPromptBlock(prompt, "COMPLETE ORIGINAL TEXT FOR THIS SEGMENT (not a prefix sample)");
    const index = segments.findIndex((part) => part.text === segmentText);
    assert.notEqual(index, -1, "assembly prompt must carry one complete source segment");
    activeSegmentIndex = index;
    captured.assembly.push({ prompt, segmentIndex: index });

    const quote = `Exact source quotation for chapter ${index + 1}: evidence supports inference.`;
    const metrics = {
      overallScore: 40 + index,
      claimDensity: 1.5 + index,
      conceptualCompression: 20 + 3 * index,
      redundancyScore: 70 - index,
      fillerRatio: 0.1 + index / 100,
      fractalScore: 10 + 2 * index,
      qualitativeAssessment: `Assessment for source chapter ${index + 1}.`,
    };
    const positions = [
        { id: "p-root", claim: `Position for chapter ${index + 1}`, type: "core", level: 0, parentId: null, confidence: 80 },
        { id: "p-child", claim: `Supporting position for chapter ${index + 1}`, type: "supporting", level: 1, parentId: "p-root", confidence: 75 },
      ];
    if (options.cyclicPositionsAt === index) positions[0].parentId = "p-child";
    const argument = {
      id: "a-local",
      premises: ["Evidence is available."],
      conclusion: "Inference is supported.",
      relatedPositionIds: ["p-root", "p-child"],
    };
    if (options.invalidArgumentsAt === index) argument.premises = [""];
    const quotes = [{
      id: "q-local", text: options.quoteTransform ? options.quoteTransform(quote, index) : quote,
      signalStrength: 8, whyHighSignal: "It states the chapter's inference.", relatedPositionIds: ["p-root"],
    }];
    if (options.extraUnmatchedQuote) quotes.push({
      id: "q-unmatched", text: "This invented quotation does not occur in the source.",
      signalStrength: 7, whyHighSignal: "Untrusted model proposal.", relatedPositionIds: ["p-root"],
    });
    return JSON.stringify({
      positions,
      quotes,
      arguments: [argument],
      conceptClusters: [{ id: "c-local", label: `Inference ${index + 1}`, description: "A chapter-local concept cluster.", relatedPositionIds: ["p-root"], relatedQuoteIds: quotes.map((item) => item.id) }],
      intelligence: metrics,
      stylometricThumbprint: {
        signaturePhrases: [`signature-${index + 1}`],
        abstractionLevel: `level-${index + 1}`,
        sentenceRhythmNotes: `rhythm-${index + 1}`,
        notableStylisticTraits: [`trait-${index + 1}`],
      },
    });
  }) as typeof callLLM;

  return { segments, captured, model, rawTrees, cleanTrees };
}

test("runs every uneven chapter through full prompts and aggregates only complete, linked data", async () => {
  const text = pipelineText();
  const harness = buildHarness(text);
  assert.equal(harness.segments.length, 8, "the uneven fixture should have one segment per chapter");
  assert.ok(new Set(harness.segments.map((part) => part.wordCount)).size > 1);

  const progress: { stage: string; current: number; total: number }[] = [];
  const database = await generateBookDatabase2(
    text,
    "mock-provider",
    { title: "Deterministic test book", author: "Test author" },
    (event) => progress.push({ stage: event.stage, current: event.current, total: event.total }),
    { model: harness.model },
  );

  assert.equal(database.meta.title, "Deterministic test book");
  assert.equal(database.meta.provider, "mock-provider");
  assert.equal(database.meta.coverage?.totalCharacters, text.length);
  assert.equal(database.meta.coverage?.processedCharacters, text.length);
  assert.equal(database.meta.coverage?.processedParts, harness.segments.length);
  assert.equal(database.meta.coverage?.chapters.length, 8);
  assert.ok(database.meta.coverage!.chapters.every((chapter) => chapter.processedParts === chapter.partCount));
  assert.equal(database.meta.coverage?.aggregation, "word-weighted");
  assert.deepEqual(progress.filter((event) => event.stage === "done").map((event) => event.current), [harness.segments.length * 3 + 1]);
  assert.equal(database.cleanedTree.length, 16);

  for (const [index, segment] of harness.segments.entries()) {
    const treeCall = harness.captured.tree.find((call) => call.segmentIndex === index);
    const cleaningCall = harness.captured.cleaning.find((call) => call.segmentIndex === index);
    const assemblyCall = harness.captured.assembly.find((call) => call.segmentIndex === index);
    assert.ok(treeCall && cleaningCall && assemblyCall, `segment ${index} must reach all three model stages`);
    assert.equal(extractPromptBlock(treeCall.prompt, "TEXT"), segment.text);
    assert.ok(treeCall.prompt.includes(segment.text), "the complete segment must be present in the tree prompt");
    assert.equal(extractPromptBlock(assemblyCall.prompt, "COMPLETE ORIGINAL TEXT FOR THIS SEGMENT (not a prefix sample)"), segment.text);
    assert.ok(assemblyCall.prompt.includes(segment.text), "the complete segment must be present in the assembly prompt");
  }

  const firstRawTree = harness.rawTrees.get(0)!;
  const firstCleaningPrompt = harness.captured.cleaning.find((call) => call.segmentIndex === 0)!.prompt;
  assert.ok(firstRawTree.length > 10_000);
  assert.equal(extractPromptBlock(firstCleaningPrompt, "RAW TREE"), firstRawTree);
  assert.ok(firstCleaningPrompt.includes(firstRawTree), "cleaning receives the complete, untruncated raw tree");

  const firstCleanTree = harness.cleanTrees.get(0)!;
  const firstAssemblyPrompt = harness.captured.assembly.find((call) => call.segmentIndex === 0)!.prompt;
  assert.ok(firstCleanTree.length > 6_000);
  const cleanedTreeBlock = firstAssemblyPrompt.match(/CLEANED TREE \([^)]+\):\n"""\n([\s\S]*?)\n"""/);
  assert.ok(cleanedTreeBlock);
  assert.equal(cleanedTreeBlock[1], firstCleanTree);
  assert.ok(firstAssemblyPrompt.includes(firstCleanTree), "assembly receives the complete, untruncated cleaned tree");

  const treeIds = database.cleanedTree.map((node) => node.id);
  const treeNumbers = database.cleanedTree.map((node) => node.number);
  assert.equal(new Set(treeIds).size, treeIds.length);
  assert.equal(new Set(treeNumbers).size, treeNumbers.length);
  for (let index = 0; index < database.cleanedTree.length; index += 2) {
    const root = database.cleanedTree[index];
    const child = database.cleanedTree[index + 1];
    assert.equal(root.number.endsWith(".0"), true);
    assert.equal(root.parentId, null);
    assert.equal(child.parentId, root.id);
    assert.equal(child.depth, 1);
  }

  const allIds = [
    ...database.cleanedTree.map((item) => item.id),
    ...database.positions.map((item) => item.id),
    ...database.quotes.map((item) => item.id),
    ...database.arguments.map((item) => item.id),
    ...database.conceptClusters.map((item) => item.id),
  ];
  assert.equal(new Set(allIds).size, allIds.length, "IDs must be unique across all returned record types");
  assert.equal(database.positions.length, 16);
  assert.equal(database.quotes.length, 8);
  assert.equal(database.arguments.length, 8);
  assert.equal(database.conceptClusters.length, 8);
  for (const position of database.positions) {
    if (position.parentId) assert.ok(database.positions.some((candidate) => candidate.id === position.parentId));
  }
  for (const quote of database.quotes) {
    assert.ok(text.includes(quote.text), "every quote must exactly occur in the original source");
    assert.ok(quote.relatedPositionIds.length > 0);
    assert.ok(quote.relatedPositionIds.every((id) => database.positions.some((position) => position.id === id)));
  }
  for (const argument of database.arguments) {
    assert.ok(argument.relatedPositionIds.every((id) => database.positions.some((position) => position.id === id)));
  }
  for (const cluster of database.conceptClusters) {
    assert.ok(cluster.relatedPositionIds.every((id) => database.positions.some((position) => position.id === id)));
    assert.ok(cluster.relatedQuoteIds.every((id) => database.quotes.some((quote) => quote.id === id)));
  }

  const lastSegment = harness.segments.at(-1)!;
  assert.ok(lastSegment.text.includes("FINAL_BOOK_TAIL_SENTINEL"));
  assert.ok(harness.captured.tree.at(-1)!.prompt.includes("FINAL_BOOK_TAIL_SENTINEL"));
  assert.ok(harness.captured.assembly.at(-1)!.prompt.includes("FINAL_BOOK_TAIL_SENTINEL"));
  assert.equal(database.meta.coverage!.processedCharacters, text.length);

  assert.equal(harness.captured.reconciliation.length, 1);
  const reconciliationPrompt = harness.captured.reconciliation[0];
  assert.match(reconciliationPrompt, /WHOLE-TEXT RECONCILIATION/);
  assert.match(reconciliationPrompt, /including 7 exact repeated claims across different source segments/);
  const contributionsMarker = "ALL CONTRIBUTIONS:\n";
  const contributionsStart = reconciliationPrompt.indexOf(contributionsMarker);
  assert.notEqual(contributionsStart, -1);
  const contributions = JSON.parse(reconciliationPrompt.slice(contributionsStart + contributionsMarker.length)) as {
    label: string;
    wordCount: number;
    themes: string[];
  }[];
  assert.equal(contributions.length, harness.segments.length);
  assert.ok(contributions.some((report) => report.label.includes("Chapter 8: Pipeline chapter 8")));
  assert.equal(contributions.at(-1)!.wordCount, harness.segments.at(-1)!.wordCount);
  assert.ok(contributions.at(-1)!.themes.some((theme) => theme.includes("Repeated foundational principle")));

  assert.deepEqual(database.intelligence, {
    overallScore: 91,
    claimDensity: 4.25,
    conceptualCompression: 73,
    redundancyScore: 11,
    fillerRatio: 0.04,
    fractalScore: 82,
    qualitativeAssessment: "The reconciled whole-text assessment spans every chapter.",
  });
  assert.deepEqual(database.stylometricThumbprint, {
    signaturePhrases: ["whole-text signature"],
    abstractionLevel: "Whole-book abstraction",
    sentenceRhythmNotes: "Whole-book rhythm",
    notableStylisticTraits: ["cross-chapter development"],
  });
});

test("rejects malformed arguments instead of accepting invalid derived data", async () => {
  const text = pipelineText();
  const harness = buildHarness(text, { invalidArgumentsAt: 2 });
  await assert.rejects(
    generateBookDatabase2(text, "mock-provider", {}, () => {}, { model: harness.model }),
    /Invalid argument fields/,
  );
  assert.equal(harness.captured.assembly.at(-1)!.segmentIndex, 2);
  assert.equal(harness.captured.reconciliation.length, 0);
});

test("a short work still completes when its only proposed quotation is not in the source", async () => {
  const text = "Evidence constrains inference without mechanically determining every conclusion. ".repeat(12);
  const harness = buildHarness(text, { quoteTransform: () => "A model invented this quotation." });
  const stages: string[] = [];
  const database = await generateBookDatabase2(text, "mock-provider", {}, (event) => stages.push(event.stage), { model: harness.model });
  assert.equal(harness.segments.length, 1);
  assert.ok(stages.includes("done"));
  assert.equal(database.cleanedTree.length, 2);
  assert.equal(database.positions.length, 2);
  assert.equal(database.arguments.length, 1);
  assert.equal(database.conceptClusters.length, 1);
  assert.equal(database.quotes.length, 0);
  assert.deepEqual(database.conceptClusters[0].relatedQuoteIds, []);
  assert.equal(database.meta.coverage?.processedCharacters, text.length);
  assert.equal(database.meta.quoteVerification?.verifiedCount, 0);
  assert.equal(database.meta.quoteVerification?.rejectedQuotes.length, 1);
  assert.equal(database.meta.quoteVerification?.rejectedQuotes[0].text, "A model invented this quotation.");
});

test("tree-only generation accepts a very short work and never calls quotation extraction", async () => {
  const text = "Evidence supports tentative inference rather than certainty.";
  const harness = buildHarness(text);
  const stages: string[] = [];
  const database = await generateBookDatabase2(text, "mock-provider", {}, (event) => stages.push(event.stage), {
    model: harness.model, treeOnly: true,
  });
  assert.equal(database.meta.analysisMode, "tree");
  assert.equal(database.cleanedTree.length, 2);
  assert.equal(harness.captured.tree.length, 1);
  assert.equal(harness.captured.cleaning.length, 1);
  assert.equal(harness.captured.assembly.length, 0);
  assert.equal(harness.captured.reconciliation.length, 0);
  assert.equal(harness.captured.calls, 2);
  assert.ok(stages.includes("done"));
  assert.ok(!stages.includes("database"));
  assert.equal(database.meta.coverage?.processedCharacters, text.length);
  assert.equal(database.meta.coverage?.aggregation, "not-applicable");
  assert.ok(!("quotes" in database));
  assert.ok(!("intelligence" in database));
});

test("tree-only generation covers every segment of the attached eight-chapter source", async () => {
  const text = readFileSync(samplePath, "utf8");
  const harness = buildHarness(text);
  const database = await generateBookDatabase2(text, "mock-provider", {}, () => {}, { model: harness.model, treeOnly: true });
  assert.equal(database.meta.coverage?.chapters.length, 8);
  assert.equal(database.meta.coverage?.processedCharacters, text.length);
  assert.equal(database.meta.coverage?.processedParts, harness.segments.length);
  assert.equal(database.cleanedTree.length, harness.segments.length * 2);
  assert.equal(harness.captured.tree.length, harness.segments.length);
  assert.equal(harness.captured.cleaning.length, harness.segments.length);
  assert.equal(harness.captured.assembly.length, 0);
  for (const call of harness.captured.tree) {
    assert.equal(extractPromptBlock(call.prompt, "TEXT"), harness.segments[call.segmentIndex].text);
  }
});

test("retains valid quotations and removes only links to rejected quotations", async () => {
  const text = "Exact source quotation for chapter 1: evidence supports inference. " +
    "Evidence constrains inference without mechanically determining every conclusion. ".repeat(8);
  const harness = buildHarness(text, { extraUnmatchedQuote: true });
  const database = await generateBookDatabase2(text, "mock-provider", {}, () => {}, { model: harness.model });
  assert.equal(database.quotes.length, 1);
  assert.ok(text.includes(database.quotes[0].text));
  assert.deepEqual(database.conceptClusters[0].relatedQuoteIds, [database.quotes[0].id]);
  assert.equal(database.meta.quoteVerification?.verifiedCount, 1);
  assert.equal(database.meta.quoteVerification?.rejectedQuotes.length, 1);
  assert.equal(database.arguments.length, 1);
  assert.equal(database.cleanedTree.length, 2);
});

test("restores literal source typography and line breaks without discarding short-work analysis", async () => {
  const exact = "“Evidence” supports an inference — not certainty.\n\nReason’s limits matter.";
  const text = exact + "\n" + "The strength of an inference depends on the available evidence. ".repeat(8);
  const harness = buildHarness(text, {
    quoteTransform: () => "\"Evidence\" supports an inference - not certainty. Reason's limits matter.",
  });
  const database = await generateBookDatabase2(text, "mock-provider", {}, () => {}, { model: harness.model });
  assert.equal(database.quotes.length, 1);
  assert.equal(database.quotes[0].text, exact);
  assert.ok(text.includes(database.quotes[0].text));
  assert.equal(database.meta.quoteVerification?.correctedCount, 1);
  assert.equal(database.meta.quoteVerification?.rejectedQuotes.length, 0);
  assert.equal(database.cleanedTree.length, 2);
});

test("rejects cyclic position parent relationships", async () => {
  const text = pipelineText();
  const harness = buildHarness(text, { cyclicPositionsAt: 2 });
  await assert.rejects(
    generateBookDatabase2(text, "mock-provider", {}, () => {}, { model: harness.model }),
    /cyclic parent relationship/,
  );
  assert.equal(harness.captured.assembly.at(-1)!.segmentIndex, 2);
  assert.equal(harness.captured.reconciliation.length, 0);
});

test("collapses a missing intermediate cleaned-tree parent and renumbers the child", async () => {
  const text = pipelineText();
  const harness = buildHarness(text, { missingIntermediateParentAt: 0 });
  const database = await generateBookDatabase2(text, "mock-provider", {}, () => {}, { model: harness.model });
  const firstChapterNodes = database.cleanedTree.filter((node) => node.source?.chapterIndex === 0);
  assert.equal(firstChapterNodes.length, 2);
  assert.equal(firstChapterNodes[0].number, "1.0");
  assert.equal(firstChapterNodes[0].depth, 0);
  assert.equal(firstChapterNodes[0].parentId, null);
  assert.equal(firstChapterNodes[1].number, "1.1");
  assert.equal(firstChapterNodes[1].depth, 1);
  assert.equal(firstChapterNodes[1].parentId, firstChapterNodes[0].id);
});

test("stops without reporting success after a middle-segment model failure", async () => {
  const text = pipelineText();
  const harness = buildHarness(text, { failTreeAt: 3 });
  const progress: string[] = [];

  await assert.rejects(
    generateBookDatabase2(text, "mock-provider", {}, (event) => progress.push(event.stage), { model: harness.model }),
    /deterministic mocked model failure/,
  );
  assert.deepEqual(harness.captured.tree.map((call) => call.segmentIndex), [0, 1, 2, 3]);
  assert.ok(!progress.includes("done"));
  assert.equal(harness.captured.assembly.some((call) => call.segmentIndex > 3), false);
});

test("stops without reporting success when a middle-segment response is invalid JSON", async () => {
  const text = pipelineText();
  const harness = buildHarness(text, { invalidCleaningAt: 3 });
  const progress: string[] = [];

  await assert.rejects(
    generateBookDatabase2(text, "mock-provider", {}, (event) => progress.push(event.stage), { model: harness.model }),
    /Unexpected token|JSON/,
  );
  assert.deepEqual(harness.captured.tree.map((call) => call.segmentIndex), [0, 1, 2, 3]);
  assert.deepEqual(harness.captured.cleaning.map((call) => call.segmentIndex), [0, 1, 2, 3]);
  assert.ok(!progress.includes("done"));
  assert.equal(harness.captured.assembly.some((call) => call.segmentIndex >= 3), false);
});

test("an abort during a model call prevents every subsequent model call", async () => {
  const text = pipelineText();
  const controller = new AbortController();
  let calls = 0;
  const model = (async (_provider: string, prompt: string, _signal?: AbortSignal): Promise<string> => {
    calls += 1;
    assert.ok(prompt.startsWith("Convert this text into a Tractatus-style hierarchical numbered proposition tree."));
    controller.abort();
    return "1.0 A deterministic claim\n1.1 A deterministic supporting claim";
  }) as typeof callLLM;
  const progress: string[] = [];

  await assert.rejects(
    generateBookDatabase2(text, "mock-provider", {}, (event) => progress.push(event.stage), {
      model,
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(calls, 1);
  assert.ok(!progress.includes("done"));
});

test("rejects provider output-limit responses when truncation rejection is enabled", async (t) => {
  const cases = [
    {
      provider: "openai",
      envKey: "OPENAI_API_KEY",
      body: { choices: [{ finish_reason: "length", message: { content: "partial output" } }] },
    },
    {
      provider: "anthropic",
      envKey: "ANTHROPIC_API_KEY",
      body: { stop_reason: "max_tokens", content: [{ type: "text", text: "partial output" }] },
    },
    {
      provider: "gemini",
      envKey: "GEMINI_API_KEY",
      body: { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "partial output" }] } }] },
    },
  ];

  for (const { provider, envKey, body } of cases) {
    await t.test(provider, { skip: !process.env[envKey] && `${envKey} is not configured` }, async () => {
      const originalFetch = globalThis.fetch;
      let requests = 0;
      globalThis.fetch = (async () => {
        requests += 1;
        return new Response(JSON.stringify(body), { status: 200 });
      }) as typeof fetch;
      try {
        await assert.rejects(
          callLLM(provider, "deterministic output-limit fixture", undefined, { rejectTruncated: true }),
          /output limit/,
        );
        assert.equal(requests, 1, "the provider request must be handled by the local fetch mock");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});