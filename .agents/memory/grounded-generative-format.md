---
name: Grounded generative output
description: Observed format and grounding failures in live source-bound tree generation
---

For source-bound trees, do not trust instructions alone to enforce exact quotes, complete parent/child structure, or stable numbering. Independently validate grounding; when a response is malformed, make a bounded stateless retry or show an explicit error. For external examples, ask for a keyed structure and assign hierarchical numbers in code rather than parsing the model's numbered prose.

**Why:** Live generation returned plausible but non-source-exact supporting quotes, top theses without sub-claims, and examples in ordinary numbered lists even after prompts demanded a particular hierarchy.

**How to apply:** Use this when building source-grounded outlines with separately generated fresh examples. A retry must see only that tree's own source and the same instructions, not other chapters or prior run output; never silently count incomplete content as a successful result.