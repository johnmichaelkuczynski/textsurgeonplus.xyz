import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { buildTractatusTree, type TractatusStatement } from "./tractatusTree";
import { initializeTreeReplacement, replaceTractatusLevel } from "./tractatusReplacement";
import type { callLLM } from "../llm";

const nodes: TractatusStatement[] = [
  { number: "1.0", text: "A deductive proof establishes necessity rather than statistical likelihood.", depth: 0 },
  { number: "1.1", text: "A conclusion follows necessarily when it is entailed by its premises.", depth: 1 },
  { number: "1.1.1", text: "Transitive inclusion can establish a deductive conclusion.", depth: 2 },
  { number: "1.1.1.1", text: "The old inclusion example uses a red token placed in nested boxes.", depth: 3 },
  { number: "1.1.1.2", text: "The old example discusses sets of letters and consonants.", depth: 3 },
  { number: "2.0", text: "Illustrations clarify an argument without constituting empirical proof.", depth: 0 },
  { number: "2.1", text: "A hypothetical case can expose a logical distinction.", depth: 1 },
  { number: "2.1.1", text: "A scenario can separate possibility from necessity.", depth: 2 },
  { number: "2.1.1.1", text: "The original scenario concerns an umbrella and some rain.", depth: 3 },
];
const freshTree = () => initializeTreeReplacement(buildTractatusTree(nodes.map((node) => ({ ...node }))));
const flat = (tree: ReturnType<typeof freshTree>) => tree.columns[tree.columns.length - 1];
const context = (prompt: string) => JSON.parse(prompt.match(/CONTEXT:\n([\s\S]*?)\n(?:Return ONLY|PROPOSALS:)/)![1]);
const proposals = (prompt: string) => JSON.parse(prompt.match(/PROPOSALS:\n([\s\S]*?)\nReturn ONLY/)![1]);
const review = (number: string) => ({ number, supportsParent: true, freshMaterial: true,
  merelyRewordsOld: false, newMaterialDescription: "A different hypothetical construction supplies new substantive support.",
  consistentWithLockedTheses: true, preservesChildAlignment: true, noInventedEvidence: true,
  reason: "The specific inferential link explains why this material supports the immediate parent." });
function goodModel(prompts: string[] = []): typeof callLLM {
  let counter = 0;
  return async (_provider, prompt) => {
    prompts.push(prompt);
    if (prompt.startsWith("REVIEW")) return JSON.stringify({ reviews: proposals(prompt).map((node: any) => ({
      ...review(node.number),
      childReviews: context(prompt).fixedChildren.filter((child: any) => child.number.startsWith(`${node.number}.`))
        .map((child: any) => ({ number: child.number, supportsReplacement: true, reason: "The fixed child's concrete scope illustrates this replacement." })),
    })) });
    return JSON.stringify({ replacements: context(prompt).nodesToReplace.map((node: any) => ({
      number: node.number,
      text: `Node ${node.number}, fresh construction ${++counter}: ${[
        "A contradiction approach supposes a member excluded from the destination and derives incompatibility with the two premises.",
        "A clearly hypothetical taxonomy of geometric shapes shows nested membership guaranteeing the ultimate category.",
        "An illustrative table assigns category membership values, making the containment rule explicit for each hypothetical object.",
        "Represent a forbidden counterexample by symbolic predicates and show that it violates the rule required by the fixed parent.",
        "Different hypothetical families of musical instruments clarify inclusion without claiming any experimental measurement.",
        "A new worked logical derivation specifies quantifiers and demonstrates why the denied conclusion is impossible.",
      ][counter % 6]}`,
    })) });
  };
}

test("replaces only level 4 and synchronizes all cumulative columns; levels 1 and 2 are byte-identical", async () => {
  const tree = freshTree();
  const original = JSON.stringify(tree);
  const result = await replaceTractatusLevel(tree, 4, "test", "", { model: goodModel() });
  assert.equal(JSON.stringify(tree), original);
  assert.equal(result.nextReplacementLevel, 3);
  assert.notEqual(result.replacementToken, tree.replacementToken);
  assert.equal(result.replacements.length, 3);
  assert.deepEqual(result.columns.slice(0, 3), tree.columns.slice(0, 3));
  for (const before of flat(tree)) {
    const after = flat(result).find((node) => node.number === before.number)!;
    assert.equal(after.number, before.number); assert.equal(after.depth, before.depth);
    if (before.depth === 3) assert.notEqual(after.text, before.text);
    else assert.deepEqual(after, before);
  }
});

test("level 3 follows level 4, retains new children, and every column reflects the replacements", async () => {
  const prompts: string[] = [];
  const model = goodModel(prompts);
  const fourth = await replaceTractatusLevel(freshTree(), 4, "test", "", { model });
  prompts.length = 0;
  const third = await replaceTractatusLevel(fourth, 3, "test", "", { model });
  assert.equal(third.nextReplacementLevel, null);
  assert.deepEqual(third.columns.slice(0, 2), fourth.columns.slice(0, 2));
  for (const node of flat(fourth).filter((node) => node.depth === 3)) assert.deepEqual(flat(third).find((item) => item.number === node.number), node);
  for (const node of flat(third).filter((node) => node.depth === 2)) {
    assert.deepEqual(third.columns[2].find((item) => item.number === node.number), node);
  }
  assert.ok(prompts.filter((prompt) => prompt.startsWith("REPLACE")).every((prompt) => context(prompt).fixedChildren.length > 0));
  await replaceTractatusLevel(third, 4, "test", "", { model });
});

test("rejects locked levels and skipping a subordinate level without calling any model", async () => {
  let calls = 0;
  const model: typeof callLLM = async () => { calls++; return ""; };
  for (const level of [1, 2, 3]) await assert.rejects(replaceTractatusLevel(freshTree(), level, "test", "", { model }), level < 3 ? /locked/ : /Replace Level 4 first/);
  assert.equal(calls, 0);
});

test("signed checkpoints prevent changing protected text, relabeling levels, or forging replacement order", async () => {
  for (const field of ["text", "level", "order"]) {
    const tree = freshTree();
    if (field === "text") flat(tree)[0].text = "Tampered thesis";
    if (field === "level") flat(tree)[0].depth = 3;
    if (field === "order") tree.nextReplacementLevel = 3;
    await assert.rejects(replaceTractatusLevel(tree, field === "order" ? 3 : 4, "test", "", {
      model: async () => { assert.fail("No provider call should happen for a forged checkpoint."); },
    }), /checkpoint|level/);
  }
});

test("repeated old text, missing targets, new node numbers and duplicated targets cannot be committed", async () => {
  for (const kind of ["repeat", "missing", "new", "duplicate"]) {
    const tree = freshTree();
    const original = JSON.stringify(tree);
    const model: typeof callLLM = async (_p, prompt) => {
      const targets = context(prompt).nodesToReplace;
      let replacements = targets.map((node: any) => ({ number: node.number, text: `Novel support for node ${node.number}: an explicit hypothetical construction demonstrates entailment.` }));
      if (kind === "repeat") replacements = targets.map((node: any) => ({ number: node.number, text: node.text }));
      if (kind === "missing") replacements = replacements.slice(1);
      if (kind === "new") replacements[0].number = "1.0";
      if (kind === "duplicate") replacements[1] = replacements[0];
      return JSON.stringify({ replacements });
    };
    await assert.rejects(replaceTractatusLevel(tree, 4, "test", "", { model }), /original tree has been retained/);
    assert.equal(JSON.stringify(tree), original);
  }
});

test("topic drift, stale paraphrase, locked-thesis contradictions, broken children and invented evidence fail the support review", async () => {
  for (const field of ["supportsParent", "freshMaterial", "consistentWithLockedTheses", "preservesChildAlignment", "noInventedEvidence"]) {
    const baseModel = goodModel();
    const model: typeof callLLM = async (p, prompt, signal) => {
      if (!prompt.startsWith("REVIEW")) return baseModel(p, prompt, signal);
      return JSON.stringify({ reviews: proposals(prompt).map((node: any) => ({
        ...review(node.number), [field]: false, reason: `Failed ${field}.`,
      })) });
    };
    await assert.rejects(replaceTractatusLevel(freshTree(), 4, "test", "", { model }), new RegExp(field));
  }
});

test("a reviewer cannot approve an expanded old argument as fresh or omit its substantive novelty explanation", async () => {
  for (const mode of ["same-reasoning", "no-description"]) {
    const good = goodModel();
    await assert.rejects(replaceTractatusLevel(freshTree(), 4, "test", "", {
      model: async (p, prompt, signal) => {
        if (!prompt.startsWith("REVIEW")) return good(p, prompt, signal);
        return JSON.stringify({ reviews: proposals(prompt).map((node: any) => ({
          ...review(node.number),
          ...(mode === "same-reasoning" ? { merelyRewordsOld: true } : { newMaterialDescription: "" }),
        })) });
      },
    }), /rejected/);
  }
});

test("an invented researcher observation is blocked before even an approving model review; explicit hypotheticals are allowed", async () => {
  const alleged = "When researchers observed that shoe size correlates with reading ability in children, age explained the association.";
  const modelFor = (text: string): typeof callLLM => async (_p, prompt) => {
    if (prompt.startsWith("REVIEW")) return JSON.stringify({ reviews: proposals(prompt).map((node: any) => review(node.number)) });
    return JSON.stringify({ replacements: context(prompt).nodesToReplace.map((node: any) => ({
      number: node.number, text: `${text} Node ${node.number} illustrates the relation.`,
    })) });
  };
  await assert.rejects(replaceTractatusLevel(freshTree(), 4, "test", "", { model: modelFor(alleged) }), /verbatim evidence excerpt/);
  const result = await replaceTractatusLevel(freshTree(), 4, "test", "", {
    model: modelFor(`In a hypothetical scenario, researchers observed an imagined relationship between category membership and classification.`),
  });
  assert.equal(result.replacements.length, 3);
});

test("one correction may succeed, but failed later groups cannot partially mutate the original tree", async () => {
  const good = goodModel();
  let attempts = 0;
  const result = await replaceTractatusLevel(freshTree(), 4, "test", "", {
    model: async (p, prompt, signal) => ++attempts === 1 ? '{"replacements":[]}' : good(p, prompt, signal),
  });
  assert.equal(result.replacements.length, 3);
  const tree = freshTree();
  const original = JSON.stringify(tree);
  await assert.rejects(replaceTractatusLevel(tree, 4, "test", "", {
    model: async (p, prompt, signal) => context(prompt).parent.number === "2.1.1" ? '{"replacements":[]}' : good(p, prompt, signal),
  }), /Parent 2.1.1/);
  assert.equal(JSON.stringify(tree), original);
});

test("stopping discards proposals and leaves the checkpoint and old text intact", async () => {
  const tree = freshTree();
  const original = JSON.stringify(tree);
  const controller = new AbortController();
  const good = goodModel();
  await assert.rejects(replaceTractatusLevel(tree, 4, "test", "", {
    signal: controller.signal,
    model: async (p, prompt, signal) => {
      const result = await good(p, prompt, signal);
      if (prompt.startsWith("REVIEW")) controller.abort();
      return result;
    },
  }), /abort/i);
  assert.equal(JSON.stringify(tree), original);
});

test("upper replacements require an individual direct-support review for every previously changed child", async () => {
  const fourth = await replaceTractatusLevel(freshTree(), 4, "test", "", { model: goodModel() });
  for (const mode of ["missing", "unrelated"]) {
    const good = goodModel();
    await assert.rejects(replaceTractatusLevel(fourth, 3, "test", "", {
      model: async (p, prompt, signal) => {
        const response = await good(p, prompt, signal);
        if (!prompt.startsWith("REVIEW")) return response;
        const audit = JSON.parse(response);
        for (const item of audit.reviews) {
          if (mode === "missing") item.childReviews = [];
          else item.childReviews[0].supportsReplacement = false;
        }
        return JSON.stringify(audit);
      },
    }), /fixed child/);
  }
});

test("extra numbering inside column 4 never creates a Level 5 replacement action", async () => {
  const tree = initializeTreeReplacement(buildTractatusTree([...nodes, {
    number: "1.1.1.1.1", text: "Extra explanatory detail within the fourth column.", depth: 4,
  }]));
  assert.equal(tree.columns.length, 4);
  assert.equal(tree.nextReplacementLevel, 4);
  await assert.rejects(replaceTractatusLevel(tree, 5, "test", "", {
    model: async () => assert.fail("Level 5 must not call a provider."),
  }), /four displayed levels/);
  const result = await replaceTractatusLevel(tree, 4, "test", "", { model: goodModel() });
  assert.equal(result.nextReplacementLevel, 3);
  assert.equal(result.replacements.length, 3);
  assert.deepEqual(flat(result).find((node) => node.depth === 4), flat(tree).find((node) => node.depth === 4));
  assert.deepEqual(result.columns.slice(0, 3), tree.columns.slice(0, 3));
});

test("an existing signed Level 5 checkpoint works as Level 4 without regenerating the tree", async () => {
  const tree = initializeTreeReplacement(buildTractatusTree([...nodes, {
    number: "1.1.1.1.1", text: "Existing deeper detail retained in column four.", depth: 4,
  }]));
  tree.nextReplacementLevel = 5;
  tree.replacementToken = createHmac("sha256", process.env.SESSION_SECRET!)
    .update(JSON.stringify({ statements: flat(tree).map(({ number, text, depth }) => ({ number, text, depth })), nextLevel: 5 }))
    .digest("hex");
  await assert.rejects(replaceTractatusLevel(tree, 3, "test", "", { model: goodModel() }), /Replace Level 4 first/);
  const fourth = await replaceTractatusLevel(tree, 4, "test", "", { model: goodModel() });
  assert.equal(fourth.nextReplacementLevel, 3);
  const third = await replaceTractatusLevel(fourth, 3, "test", "", { model: goodModel() });
  assert.equal(third.nextReplacementLevel, null);
  assert.deepEqual(third.columns.slice(0, 2), tree.columns.slice(0, 2));
});

test("an invalid hierarchy retains generated output but explicitly disables replacement", () => {
  const base = buildTractatusTree(nodes.filter((node) => node.number !== "1.1.1"));
  const tree = initializeTreeReplacement(base);
  assert.deepEqual(tree.columns, base.columns);
  assert.equal(tree.replacementToken, undefined);
  assert.match(tree.replacementUnavailableReason!, /no immediate parent/);
});