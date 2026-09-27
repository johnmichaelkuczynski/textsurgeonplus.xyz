---
name: Author corpus credentials
description: Why corpus diagnostics must preserve and verify each author's own credential
---

Keep each author's stored corpus credential separate. Do not replace the author-specific selection with a shared credential, remove stored keys, or call a shared-key search proof that an author's key works.

**Why:** Dr. Kuczynski explicitly rejected the shared-key assumption and requested a distinct, real diagnostic for every author-specific key. A response obtained with another key says nothing about the named key.

**How to apply:** Compare each live check's reported credential name with the author-specific name expected for that author, and require a real corpus response before marking it passed. If the corpus service endpoint is not configured, report that as a blocker rather than a successful or definitively invalid key. Never expose credential values.