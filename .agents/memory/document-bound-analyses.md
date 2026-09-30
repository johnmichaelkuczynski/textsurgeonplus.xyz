---
name: Document-bound analyses
description: Why generated analyses must not silently carry across source-document changes
---

Generated trees and other derived analyses must belong to the exact submitted document or chapter. On source replacement, invalidate old derived results and ignore late completions from the previous source. A page reload alone cannot guarantee that a model will not import knowledge of other chapters.

**Why:** A chapter-only tree appeared to include material from the rest of a previously uploaded book. Reusing a prior result within the same page session can present a whole-book output for a chapter, while source-unrestricted prompts can independently introduce out-of-scope claims.

**How to apply:** For future text analysis flows, track source identity through requests and results, invalidate on source edits/uploads, and explicitly limit generation to the supplied text. Verify source fidelity separately from successful request completion.

Resource limits must bound individual analysis requests, never silently limit the total source covered. Every derived stage must include all source segments, and later aggregation must compare the complete set of segment analyses.

**Why:** A whole-book result recorded the full input word count while representing mostly the opening chapter. Successful requests and correct source metadata concealed repeated prefix sampling in the analysis itself.

**How to apply:** Check contiguous source coverage through every stage, reject output-limit completions and skipped segments, and distinguish recorded input coverage from guaranteed semantic recall. Whole-text scores need cross-segment reconciliation, not merely averages of local scores.

An unverified optional quotation must not discard a valid tree and all other analyses. Recover literal source passages for typography-only differences; exclude genuinely unmatched proposals with visible evidence, and remove their links.

**Why:** A short-work analysis was entirely rejected because one model-proposed quotation did not match the source. Fail-closed quotation checks were incorrectly applied to the whole independent analysis.

**How to apply:** Never pass paraphrases off as verbatim quotations, but isolate rejection to the offending quote. Retain core outputs and expose quote verification/exclusion in the result and saved evidence.

Tree-only requests must run only tree generation and cleaning, not unrelated quotation extraction or database assessments.

**Why:** A user asking for a tree encountered a database quotation error instead of a tree. Sharing an internal pipeline does not justify making an independently requested output depend on unrelated analyses.

**How to apply:** Keep requested analysis scope explicit end to end. Preserve complete-source coverage and exports for tree-only results; run the additional analyses only when those outputs are requested.