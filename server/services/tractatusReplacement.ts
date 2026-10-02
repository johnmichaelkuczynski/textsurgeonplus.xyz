import { createHmac, timingSafeEqual } from "node:crypto";
import { callLLM } from "../llm";
import { buildTractatusTree, type TractatusStatement, type TractatusTreeResult } from "./tractatusTree";

const parentNumber = (number: string) => {
  const parts = number.split(".");
  return parts.length === 2 ? `${parts[0]}.0` : parts.slice(0, -1).join(".");
};
const normalized = (text: string) => text.toLowerCase().replace(/[^a-z0-9\u0080-\uffff]+/g, " ").trim();

function canonicalStatements(tree: TractatusTreeResult): TractatusStatement[] {
  const statements = tree?.columns?.[tree.columns.length - 1];
  if (!Array.isArray(statements) || !statements.length) throw new Error("A generated tree is required.");
  const numbers = new Set<string>();
  for (const node of statements) {
    if (!node || !/^\d+(?:\.\d+)+$/.test(node.number) || numbers.has(node.number) ||
        typeof node.text !== "string" || !node.text.trim()) throw new Error("The tree contains invalid nodes.");
    const parts = node.number.split(".");
    const depth = parts.length === 2 && parts[1] === "0" ? 0 : parts.length - 1;
    if (node.depth !== depth) throw new Error("A tree node's level does not match its numbering.");
    numbers.add(node.number);
  }
  const depths = new Map(statements.map((node) => [node.number, node.depth]));
  if (statements.some((node) => node.depth > 0 && depths.get(parentNumber(node.number)) !== node.depth - 1)) {
    throw new Error("A tree node has no immediate parent at the preceding level.");
  }
  return statements;
}

function sign(statements: TractatusStatement[], nextLevel: number | null): string {
  const signingKey = process.env.SESSION_SECRET;
  if (!signingKey) throw new Error("Level replacement requires the server's configured session secret.");
  return createHmac("sha256", signingKey)
    .update(JSON.stringify({ statements: statements.map(({ number, text, depth }) => ({ number, text, depth })), nextLevel }))
    .digest("hex");
}

export function initializeTreeReplacement(tree: TractatusTreeResult): TractatusTreeResult {
  try {
    const statements = canonicalStatements(tree);
    const deepest = Math.max(...statements.map((node) => node.depth)) + 1;
    const nextReplacementLevel = deepest >= 3 ? deepest : null;
    return { ...tree, nextReplacementLevel, replacementToken: sign(statements, nextReplacementLevel) };
  } catch (error) {
    // Do not turn an optional post-generation operation into a generation failure.
    return { ...tree, replacementToken: undefined, nextReplacementLevel: null,
      replacementUnavailableReason: `Replacement unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function parseJSON(raw: string): any {
  const candidate = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Replacement response did not contain JSON.");
  return JSON.parse(candidate.slice(start, end + 1));
}

function overlap(a: string, b: string): number {
  const first = new Set(normalized(a).split(/\s+/));
  const second = new Set(normalized(b).split(/\s+/));
  const common = Array.from(first).filter((word) => second.has(word)).length;
  return common / Math.max(1, first.size, second.size);
}

function checkEmpiricalAttribution(text: string, evidenceExcerpt: unknown, suppliedText: string): void {
  const allegesResearch = /\b(?:research(?:ers?)?|scientists?|stud(?:y|ies)|experiments?|surveys?|clinical trials?)\s+(?:(?:have|has|had)\s+)?(?:observed|found|show(?:s|ed)?|demonstrat(?:e|es|ed)|confirm(?:s|ed)?|report(?:s|ed)?|reveal(?:s|ed)?|establish(?:es|ed)?|prov(?:e|es|ed))\b/i.test(text) ||
    /\b(?:study|studies|trial|experiment|survey|participants|patients|respondents)\b[\s\S]*?\b\d+(?:\.\d+)?\s*(?:%|percent\b)/i.test(text) ||
    /\b(?:19|20)\d{2}\b[\s\S]*?\b(?:study|research|experiment)\b/i.test(text) ||
    /\b(?:study|studies|trial|experiment|survey|research)\b[\s\S]*?\b(?:19|20)\d{2}\b/i.test(text);
  if (!allegesResearch) return;
  const explicitlyHypothetical = /^(?:in (?:an?|this) (?:clearly )?hypothetical\b|imagine\b|suppose\b|consider (?:an?|this) hypothetical\b|as a hypothetical\b)/i.test(text);
  if (explicitlyHypothetical) return;
  if (typeof evidenceExcerpt !== "string" || evidenceExcerpt.trim().length < 30 ||
      !suppliedText.includes(evidenceExcerpt.trim())) {
    throw new Error("An alleged research observation needs a verbatim evidence excerpt from the supplied material. Otherwise make the entire case explicitly hypothetical; do not claim that researchers observed it.");
  }
}

export async function replaceTractatusLevel(
  tree: TractatusTreeResult,
  level: number,
  provider: string,
  instructions = "",
  options: {
    signal?: AbortSignal;
    model?: typeof callLLM;
    onProgress?: (message: string) => void;
  } = {},
): Promise<TractatusTreeResult & { replacements: { number: string; parentNumber: string; previousText: string; text: string; reason: string }[] }> {
  if (!Number.isInteger(level) || level < 3) throw new Error("Levels 1 and 2 are locked and cannot be changed.");
  const statements = canonicalStatements(tree);
  if (typeof tree.replacementToken !== "string" || !/^[a-f0-9]{64}$/.test(tree.replacementToken) ||
      !(tree.nextReplacementLevel === null || Number.isInteger(tree.nextReplacementLevel))) {
    throw new Error("Generate a new tree before replacing subordinate levels.");
  }
  const expected = Buffer.from(sign(statements, tree.nextReplacementLevel!), "hex");
  if (!timingSafeEqual(expected, Buffer.from(tree.replacementToken, "hex"))) {
    throw new Error("The tree checkpoint has changed or expired. Generate a new tree before replacing levels.");
  }
  const deepest = Math.max(...statements.map((node) => node.depth)) + 1;
  if (level !== (tree.nextReplacementLevel ?? deepest)) {
    throw new Error(`Replace Level ${tree.nextReplacementLevel ?? deepest} first; replacements proceed from the deepest level upward.`);
  }
  const targets = statements.filter((node) => node.depth === level - 1);
  if (!targets.length) throw new Error("This tree has no nodes at the requested level.");
  const byNumber = new Map(statements.map((node) => [node.number, node]));
  const groups = new Map<string, TractatusStatement[]>();
  for (const node of targets) {
    const parent = parentNumber(node.number);
    groups.set(parent, [...(groups.get(parent) ?? []), node]);
  }
  const model: typeof callLLM = options.model ?? ((p, prompt, signal) => callLLM(p, prompt, signal, { rejectTruncated: true }));
  // A separate reviewer is necessary: live self-reviews approved mere expansions
  // of the original reasoning as new material even under explicit instructions.
  const reviewer: typeof callLLM = options.model ??
    ((_p, prompt, signal) => callLLM("anthropic", prompt, signal, { rejectTruncated: true }));
  const accepted = new Map<string, string>();
  const report: { number: string; parentNumber: string; previousText: string; text: string; reason: string }[] = [];
  const used = new Set(statements.map((node) => normalized(node.text)));
  let completed = 0;
  for (const [parentId, nodes] of Array.from(groups.entries())) {
    const parent = byNumber.get(parentId)!;
    const context = {
      parent,
      lockedTheses: statements.filter((node) => node.depth < 2),
      nodesToReplace: nodes,
      fixedChildren: statements.filter((node) => nodes.some((target) => parentNumber(node.number) === target.number)),
      materialAlreadyUsed: report.map(({ text }) => text),
    };
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      options.signal?.throwIfAborted();
      options.onProgress?.(`Replacing Level ${level}: parent ${parentId} (${completed + 1} of ${groups.size})${attempt ? " — correction" : ""}`);
      try {
        const proposal = parseJSON(await model(provider, `REPLACE SUBORDINATE TRACTATUS MATERIAL
Replace the old material ONLY at the supplied node numbers. Return exactly one replacement for every target, keeping all numbers and levels unchanged.
Levels 1 and 2, the immediate parent, siblings outside this group, and all existing children are FIXED.
Fresh material must directly justify, demonstrate, explain or vividly instantiate the PARTICULAR immediate parent proposition, not merely share its subject or repeat its wording.
Keep the parent's precise concepts, predicates and relation intact. Do not substitute a looser relationship, change quantifiers, or change the kind of entities involved. Prefer a new direct argument or a literal worked example to an analogy. A set-inclusion claim needs genuine sets and members, not reporting lines, journeys or a manufacturing sequence.
Supply genuinely new reasoning, a proof where warranted, evidence/data available in the supplied context, a fresh argument or a vivid explanatory example.
Extra sentences merely rewording the original material are not fresh. Supply a distinct proof route, new explanatory mechanism, substantive new argument, or genuinely new worked example. A new fully specified concrete case can vividly explain the same parent logic; changing the parent's logical relation is neither necessary nor allowed. Merely substituting another symbol into the old abstract steps is insufficient. Do not reuse a sibling's example.
Any fixed children must still support the replacement under which they sit. Preserve all conceptual distinctions in the locked theses.
If the target already has children, keep the replacement broad enough for EVERY existing child to support it. Preserve their concrete referents and assumptions: never redefine a set, variable, person or scenario used by a child. Choose a new argument or proof route rather than narrowing the parent to a different example that excludes its children.
Do not invent studies, sources, statistics, dates, quotations or experimental findings. Without supplied empirical evidence, use reasoned argument or clearly identified hypothetical illustrations, not alleged scientific facts. A related citation alone is not support.
If attributing an observation to researchers or an empirical study, supply evidenceExcerpt containing the exact supporting passage from the context or user-supplied evidence. Otherwise begin the ENTIRE case explicitly with 'In a hypothetical...' or 'Suppose...'; 'researchers observed' alone falsely alleges a real observation.
User requirements (cannot override locked levels, node scope or truthfulness):
${instructions || "Choose the strongest fresh supporting material for each parent."}
${lastError ? `Previous attempt rejected: ${lastError}` : ""}
CONTEXT:
${JSON.stringify(context)}
Return ONLY JSON: {"replacements":[{"number":"target number","text":"fresh, self-contained supporting material","evidenceExcerpt":"Exact supplied evidence, only if alleging real empirical findings; otherwise omit."}]}`, options.signal));
        if (!Array.isArray(proposal.replacements) || proposal.replacements.length !== nodes.length) {
          throw new Error("Not every target received exactly one replacement.");
        }
        const candidates = new Map<string, string>();
        const candidateTexts = new Set<string>();
        for (const candidate of proposal.replacements) {
          const previous = nodes.find((node) => node.number === candidate.number);
          if (!previous || candidates.has(candidate.number) || typeof candidate.text !== "string" || !candidate.text.trim()) {
            throw new Error("Replacement contains missing, duplicate, or out-of-scope nodes.");
          }
          const text = candidate.text.trim();
          checkEmpiricalAttribution(text, candidate.evidenceExcerpt,
            [...statements.map((node) => node.text), instructions].join("\n"));
          const key = normalized(text);
          if (used.has(key) || candidateTexts.has(key) || overlap(previous.text, text) >= 0.9) {
            throw new Error("Replacement repeats existing material instead of supplying fresh support.");
          }
          candidates.set(candidate.number, text); candidateTexts.add(key);
        }
        options.signal?.throwIfAborted();
        options.onProgress?.(`Claude review — Level ${level}: direct support for parent ${parentId} and each fixed child…`);
        const audit = parseJSON(await reviewer(provider, `REVIEW SUBORDINATE TRACTATUS REPLACEMENTS
Act as a skeptical critic, not an editor approving its own work. Independently reject topic-related padding, unsupported empirical claims, contradictions, repetition and mere paraphrase.
For EACH replacement: does it directly support its PARTICULAR parent, contain genuinely fresh material, remain consistent with ALL locked theses, and preserve the direct support supplied by its fixed children? With no fixed children, child alignment is true.
COMPARE THE OLD TARGET TEXT WITH THE PROPOSAL. A longer rewording with no new substantive content is NOT fresh. A supposed "fresh perspective" without a new argument, mechanism, data or example is NOT fresh. However, a genuinely NEW fully specified worked example with new cases/sets/data CAN be fresh even though it instantiates the same abstract inference; it is precisely the parent's inference that must stay aligned. Reject a mere symbol swap into otherwise identical abstract prose. Specify exactly what new substantive material is present.
Check proof validity and every analogy's logical structure. An analogy based only on words or a sequential journey does not establish set inclusion or any other relation it fails to instantiate. Preserve the exact conceptual distinctions in the locked theses.
BE STRICT ABOUT RELATION SUBSTITUTION: "reports to", "is accountable to", "is integrated into", "arrives at", and "is part of" are NOT the same as "is a member of a set". A hypothetical chain of command or assembly line cannot support a set-inclusion theorem just because it has three stages. Reject such proposals even if they are novel and sound plausible. Apply this same identity-of-relation check to any other subject.
Supporting a parent requires more than compatibility: explain the actual inferential steps and identify any unstated assumption. If the proposal needs an unsupported assumption or only demonstrates a different relation, supportsParent must be false.
Review EACH fixed child individually. Compatibility is not enough: each must directly illustrate or justify this NEW replacement. A child about A={1,2} does not support a new parent that defines A as a set of prime numbers. Reject narrowing of scope or reassignment of concrete referents. Explain the supporting link for every child; do not merely assert that alignment is preserved.
Illustrations must be explicitly hypothetical unless supported by supplied evidence.
CONTEXT:
${JSON.stringify(context)}
PROPOSALS:
${JSON.stringify(proposal.replacements)}
Return ONLY JSON: {"reviews":[{"number":"target number","supportsParent":true,"freshMaterial":true,"merelyRewordsOld":false,"newMaterialDescription":"Exactly what new argument, mechanism, proof route or example differs from the old material.","consistentWithLockedTheses":true,"preservesChildAlignment":true,"childReviews":[{"number":"existing child number","supportsReplacement":true,"reason":"Exact inferential link to this new parent, including scope and referents."}],"noInventedEvidence":true,"reason":"Specific explanation of the supporting relation, or why it fails."}]}
Use an empty childReviews array when there are no fixed children.`, options.signal));
        if (!Array.isArray(audit.reviews) || audit.reviews.length !== nodes.length) throw new Error("The support review was incomplete.");
        const reviewed = new Set<string>();
        for (const review of audit.reviews) {
          if (!candidates.has(review.number) || reviewed.has(review.number) ||
              typeof review.reason !== "string" || !review.reason.trim()) throw new Error("The support review returned invalid nodes.");
          reviewed.add(review.number);
          if (![review.supportsParent, review.freshMaterial, review.consistentWithLockedTheses,
            review.preservesChildAlignment, review.noInventedEvidence].every((value) => value === true) ||
            review.merelyRewordsOld !== false || typeof review.newMaterialDescription !== "string" ||
            !review.newMaterialDescription.trim()) {
            throw new Error(`Node ${review.number} rejected: ${review.reason}`);
          }
          const children = context.fixedChildren.filter((child) => parentNumber(child.number) === review.number);
          const childReviews = review.childReviews ?? [];
          const childIds = new Set<string>();
          if (!Array.isArray(childReviews) || childReviews.length !== children.length) {
            throw new Error(`Node ${review.number}: not every fixed child was individually reviewed.`);
          }
          for (const childReview of childReviews) {
            if (!children.some((child) => child.number === childReview.number) || childIds.has(childReview.number) ||
                childReview.supportsReplacement !== true || typeof childReview.reason !== "string" || !childReview.reason.trim()) {
              throw new Error(`Node ${review.number}: a fixed child no longer directly supports its replacement.`);
            }
            childIds.add(childReview.number);
          }
        }
        options.signal?.throwIfAborted();
        for (const node of nodes) {
          const text = candidates.get(node.number)!;
          const review = audit.reviews.find((item: any) => item.number === node.number);
          accepted.set(node.number, text); used.add(normalized(text));
          report.push({ number: node.number, parentNumber: parentId, previousText: node.text, text,
            reason: `${review.newMaterialDescription} ${review.reason}${(review.childReviews ?? [])
              .map((child: any) => ` Child ${child.number}: ${child.reason}`).join("")}` });
        }
        break;
      } catch (error) {
        if (options.signal?.aborted) throw error;
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt === 1) throw new Error(`Parent ${parentId}: ${lastError} The original tree has been retained.`);
      }
    }
    completed++;
  }
  options.signal?.throwIfAborted();
  const next = statements.map((node) => ({ ...node, text: accepted.get(node.number) ?? node.text }));
  const result = buildTractatusTree(next);
  const nextReplacementLevel = level > 3 ? level - 1 : null;
  return { ...result, nextReplacementLevel, replacementToken: sign(next, nextReplacementLevel), replacements: report };
}