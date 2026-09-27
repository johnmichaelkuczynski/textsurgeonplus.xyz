---
name: Humanizer diagnostic fidelity
description: Why style matching tests must also detect imported subject matter
---

The humanizer's style sample and rewrite instructions can discuss a different subject from the Box A source. A generated answer that contains a few source keywords may still be predominantly about the style sample's subject. Do not treat keyword retention or requested length alone as proof of a faithful transformation; inspect full prose and flag imported subject matter separately.

**Why:** A live batch of rewrites produced outputs that satisfied basic length and source-keyword checks but introduced the style sample's topic as if it were source content.

**How to apply:** When revising humanizer prompts, acceptance checks, or diagnostics, distinguish style transfer from content transfer and retain inspectable full outputs for borderline cases.

When a style sample is much longer than the source, directly including it in each rewrite request can dominate even explicit subject-preservation instructions. A subject-neutral style description plus subject-neutral restatement of example-heavy writing instructions performed better in the supplied multi-prompt diagnostic.

**Why:** Repeated full-prose inspection showed that output-length checks and sparse keyword checks missed imported concepts; passing outputs became substantially more source-focused only after separating stylistic features from the sample's factual content.

**How to apply:** Keep the original source authoritative, audit unsupported claims as well as length, and retain full draft evidence. Treat automatic passes as screening, not proof of substantive fidelity.