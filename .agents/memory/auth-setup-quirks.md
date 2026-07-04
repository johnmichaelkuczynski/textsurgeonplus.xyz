---
name: Auth history — login fully removed
description: Owner's final decision on authentication for this app; read before touching anything auth-related.
---

# Authentication: REMOVED entirely (July 2026)

- **Rule:** This app has NO login system. Fully open, anonymous use of every feature. Do not resurrect any auth (Google, Clerk, username, or otherwise) without an explicit new instruction from the owner.
- **Why:** The owner iterated Clerk → username login → direct Google OAuth (his explicit spec at the time), but Google's `redirect_uri_mismatch` requirement (registering callback URLs in Google Cloud Console per OAuth client) proved an unacceptable manual step. He then ordered: "GET RID OF GOOGLE LOGIN. DO NOT PATCH. DO NOT FIX." That is the final, standing decision.
- **How to apply:**
  - Session/passport plumbing is intentionally kept in `server/auth.ts` so `req.isAuthenticated()` (always false) doesn't crash routes; don't "clean up" the session middleware without checking route usage.
  - The `/api` identity middleware stripping client-supplied `username` must stay — it prevented username spoofing (a blocking authz hole in review) and keeps per-user endpoints (history, stylometrics) inert rather than exploitable.
  - Paywall/credits depend on identity; with no login they stay disabled (`hasCredits = true` client-side) unless rebuilt with an anonymous-compatible billing path.
- **Other durable lessons:**
  - Google OAuth on Replit always needs BOTH redirect URIs (dev `*.riker.replit.dev` + custom domain) registered on the specific OAuth client in use; switching client credentials resets that requirement — this manual step is what triggered the owner's final removal order.
  - Google 403-blocks framed sign-in; in the Replit preview iframe a login link needs `target="_top"` or a new tab.
  - Validate pasted secret prefixes (pk_/sk_) before trusting them; users have pasted wrong tokens. Verify OAuth creds non-invasively via status-code-only curl; never print key values.
