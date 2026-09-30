---
name: Document-bound analyses
description: Why generated analyses must not silently carry across source-document changes
---

Generated trees and other derived analyses must belong to the exact submitted document or chapter. On source replacement, invalidate old derived results and ignore late completions from the previous source. A page reload alone cannot guarantee that a model will not import knowledge of other chapters.

**Why:** A chapter-only tree appeared to include material from the rest of a previously uploaded book. Reusing a prior result within the same page session can present a whole-book output for a chapter, while source-unrestricted prompts can independently introduce out-of-scope claims.

**How to apply:** For future text analysis flows, track source identity through requests and results, invalidate on source edits/uploads, and explicitly limit generation to the supplied text. Verify source fidelity separately from successful request completion.