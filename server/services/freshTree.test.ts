import { test } from "node:test";
import assert from "node:assert/strict";
import { addNextTier, freshTreeParentsAtTier, type FreshTreeStatement } from "./freshTree";

const checkpointedTree: FreshTreeStatement[] = [
  { number: "1.0", text: "First thesis", depth: 0 },
  { number: "1.1", text: "First child", depth: 1 },
  { number: "1.1.1", text: "First grandchild", depth: 2 },
  { number: "2.0", text: "Second thesis", depth: 0 },
  { number: "2.1", text: "Second child", depth: 1 },
];

test("explicit tier pins its parents instead of inferring from the deepest partial branch", () => {
  assert.deepEqual(freshTreeParentsAtTier(checkpointedTree, 3).map((statement) => statement.number), ["1.1", "2.1"]);
  assert.deepEqual(freshTreeParentsAtTier(checkpointedTree, 4).map((statement) => statement.number), ["1.1.1"]);
});

test("a completed thesis is skipped on resume without making a provider call", async () => {
  let completed = 0;
  let tierEvents = 0;
  const stopped = await addNextTier("source", checkpointedTree, "", new AbortController().signal, () => {
    tierEvents++;
  }, {
    tierNumber: 3,
    completedTheses: ["1.0", "2.0"],
    onThesisComplete: () => { completed++; },
  });

  assert.equal(stopped, false);
  assert.equal(completed, 0);
  assert.equal(tierEvents, 0);
});

test("resuming a partial tier requests its unfinished thesis at the original parent depth", async () => {
  let prompt = "";
  const before = structuredClone(checkpointedTree);
  await assert.rejects(addNextTier("source", checkpointedTree, "", new AbortController().signal, () => {}, {
    tierNumber: 3,
    completedTheses: ["1.0"],
    research: async (request) => {
      prompt = request;
      throw new Error("controlled interruption before any model call");
    },
  }), /Tier 3, thesis 2\.0/);
  const requestedParents = prompt.split("PARENTS FOR THIS CALL:\n")[1]?.split("\n\nSOURCE TEXT")[0];
  assert.equal(requestedParents, "2.1 Second child");
  assert.deepEqual(checkpointedTree, before);
});

test("a thesis with no parents at the requested depth is checkpointed as an empty completion", async () => {
  const tree: FreshTreeStatement[] = [
    { number: "1.0", text: "Thesis without children at this tier", depth: 0 },
    { number: "2.0", text: "Thesis with a deeper branch", depth: 0 },
    { number: "2.1", text: "Child", depth: 1 },
    { number: "2.1.1", text: "Grandchild", depth: 2 },
  ];
  const finished: Array<{ thesis: string; count: number }> = [];
  let mockProviderCalls = 0;
  await assert.rejects(addNextTier("source", tree, "", new AbortController().signal, () => {}, {
    tierNumber: 4,
    research: async () => {
      mockProviderCalls++;
      throw new Error("mocked provider interruption");
    },
    onThesisComplete: (_tier, thesis, statements) => finished.push({ thesis, count: statements.length }),
  }));

  assert.deepEqual(finished, [{ thesis: "1.0", count: 0 }]);
  assert.equal(mockProviderCalls, 1);
});

test("an explicit tier with no parents checkpoints every dropped thesis without a provider call", async () => {
  const tree: FreshTreeStatement[] = [
    { number: "1.0", text: "First thesis", depth: 0 },
    { number: "1.1", text: "First child", depth: 1 },
    { number: "2.0", text: "Second thesis", depth: 0 },
    { number: "2.1", text: "Second child", depth: 1 },
  ];
  const finished: string[] = [];
  const stopped = await addNextTier("source", tree, "", new AbortController().signal, () => {
    assert.fail("No provider results should be emitted when there are no parents.");
  }, {
    tierNumber: 4,
    onThesisComplete: (_tier, thesis, statements, sources) => {
      assert.deepEqual(statements, []);
      assert.deepEqual(sources, []);
      finished.push(thesis);
    },
  });

  assert.equal(stopped, false);
  assert.deepEqual(finished, ["1.0", "2.0"]);
});