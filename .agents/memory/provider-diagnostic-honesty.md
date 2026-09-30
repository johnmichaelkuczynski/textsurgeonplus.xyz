---
name: Provider diagnostic honesty
description: Distinguishing a working rewrite from a working requested-provider credential
---

Diagnostics must separately report whether the requested provider actually answered. A successful fallback can verify that the rewrite route produced text, but it cannot verify the original provider's credential or availability. Show the substitution and mark the requested-provider check as failed or degraded, not green.

**Why:** A real multi-part workshop probe received usable rewritten text from Anthropic after Gemini returned HTTP 503. A response-only test would have incorrectly reported Gemini healthy.

**How to apply:** Whenever a provider request supports fallback, compare the returned provider against the requested one in key-health diagnostics, while still recording whether the end-to-end feature completed.

Do not infer another provider's remaining balance from a quota error on one provider, or infer verified web research from a fallback text completion.

**Why:** An OpenAI quota-exhausted error identifies OpenAI alone. Switching a research request to a general model can produce usable text without proving that a web search ran or that proposed URLs were checked.

**How to apply:** Name the provider whose actual error was observed; describe other providers as unverified until they answer. Keep a separate provenance flag for successful search, and attach verified source markers only when that search actually succeeded.