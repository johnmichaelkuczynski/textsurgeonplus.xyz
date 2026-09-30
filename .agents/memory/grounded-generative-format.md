---
name: Grounded generative output
description: Observed format and grounding failures in live source-bound tree generation
---

For source-bound trees, do not trust instructions alone to enforce exact quotes, complete parent/child structure, or stable numbering. Independently validate grounding; when a response is malformed, make a bounded stateless retry or show an explicit error. For external examples, ask for a keyed structure and assign hierarchical numbers in code rather than parsing the model's numbered prose.

**Why:** Live generation returned plausible but non-source-exact supporting quotes, top theses without sub-claims, and examples in ordinary numbered lists even after prompts demanded a particular hierarchy.

**How to apply:** Use this when building source-grounded outlines with separately generated fresh examples. A retry must see only that tree's own source and the same instructions, not other chapters or prior run output; never silently count incomplete content as a successful result.

For new source-only tree flows, cite code-assigned source passage numbers rather than requiring the model to copy exact excerpts. Check that every cited number exists; the existence of a passage does not by itself prove that the claim follows from it.

**Why:** Exact-excerpt retries still rejected a short, one-page book when the model altered a supporting quote. Passage IDs remove quote-transcription failures while keeping citations tied to actual supplied text.

**How to apply:** Number source passages before prompting, validate cited IDs in the response, and keep claims and fresh examples separate. Do not describe a valid passage ID as proof of semantic support without a separate check.

For legitimacy edge cases, do not treat a conflicting instruction as a deterministic test fixture. A model may anticipate a prohibition and produce an allowed node instead, so the rejection, regeneration, and drop path never runs.

**Why:** Live requests asking for philosopher citations produced apparently valid support nodes without any drop warnings, even after classifier guidance was tightened. The absence of warnings did not prove the rejection path worked.

**How to apply:** Verify rejection and one-time regeneration with controlled candidate inputs as well as live requests. Report separately when a live conflict scenario never actually exercised that path; do not infer it passed from prompt wording.