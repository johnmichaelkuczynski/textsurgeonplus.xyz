export const chapters = ["Alpha", "Beta", "Gamma"].map((title, index) => ({
  index, number: index + 1, title: `CHAPTER ${index + 1}: ${title}`, wordCount: 2,
}));

export const progress = (targetDepth, completedDepth = 2, completedTheses = [], complete = false) => ({
  baseComplete: true, targetDepth, completedDepth,
  tiers: targetDepth > 2 ? { "3": { completedTheses, complete } } : {},
});

export function baseTree(index, targetDepth = 3) {
  return {
    index, title: chapters[index].title,
    statements: [
      { number: "1.0", text: `${chapters[index].title} first thesis`, depth: 0 },
      { number: "1.1", text: `${chapters[index].title} first child`, depth: 1 },
      { number: "2.0", text: `${chapters[index].title} second thesis`, depth: 0 },
      { number: "2.1", text: `${chapters[index].title} second child`, depth: 1 },
    ],
    sources: [], complete: targetDepth === 2, progress: progress(targetDepth),
  };
}

export function thesisTier(index, thesis, complete = false, dropped = false) {
  return {
    type: "tier", index, title: chapters[index].title,
    statements: dropped ? [] : [{
      number: `${thesis}.1.1`, text: `Verified fresh fact ${index}-${thesis}`, depth: 2,
    }],
    sources: dropped ? [] : [{
      node: `${thesis}.1.1`, url: `https://example.org/chapter-${index}/thesis-${thesis}`, marker: `[${thesis}]`,
    }],
    progress: progress(3, complete ? 3 : 2, thesis === 1 ? ["1.0"] : ["1.0", "2.0"], complete),
    complete,
  };
}

export function applyTier(tree, tier) {
  return {
    ...tree, statements: [...tree.statements, ...tier.statements],
    sources: [...tree.sources, ...tier.sources], progress: tier.progress, complete: tier.complete,
  };
}

export const treeEvent = (tree) => ({ type: "tree", ...tree });
export const chapterComplete = (tree) => ({
  type: "chapter-complete", index: tree.index, title: tree.title, progress: tree.progress, complete: true,
});

export function finishedTree(index) {
  return applyTier(applyTier(baseTree(index), thesisTier(index, 1)), thesisTier(index, 2, true));
}

// Independent expected export, including hierarchical ordering and exact sources.
export function outputFor(trees) {
  return trees.map((tree) => {
    const statements = [...tree.statements].sort((a, b) => {
      const aa = a.number.split(".").map(Number), bb = b.number.split(".").map(Number);
      for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
        if ((aa[i] ?? -1) !== (bb[i] ?? -1)) return (aa[i] ?? -1) - (bb[i] ?? -1);
      }
      return 0;
    });
    const sources = tree.sources.length ? `\n\nSources\n${tree.sources.map((s) =>
      `${s.marker ? `${s.marker} ` : ""}(${s.node}) — ${s.url}`).join("\n")}` : "";
    return `${tree.title}\n${statements.map((s) => `${s.number} ${s.text}`).join("\n")}${sources}`;
  }).join("\n\n");
}