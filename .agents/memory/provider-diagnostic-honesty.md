---
name: Provider diagnostic honesty
description: Distinguishing a working rewrite from a working requested-provider credential
---

Diagnostics must separately report whether the requested provider actually answered. A successful fallback can verify that the rewrite route produced text, but it cannot verify the original provider's credential or availability. Show the substitution and mark the requested-provider check as failed or degraded, not green.

**Why:** A real multi-part workshop probe received usable rewritten text from Anthropic after Gemini returned HTTP 503. A response-only test would have incorrectly reported Gemini healthy.

**How to apply:** Whenever a provider request supports fallback, compare the returned provider against the requested one in key-health diagnostics, while still recording whether the end-to-end feature completed.