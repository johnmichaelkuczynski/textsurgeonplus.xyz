---
name: Auth setup quirks
description: Lessons from migrating this app's login from Google OAuth to Clerk
---

- **Rule:** Before wiring a user-pasted API key, verify its format without printing it (e.g. shell prefix check `${KEY:0:3}` or a status-code-only curl). Gate frontend provider mounting on the expected prefix (Clerk publishable keys must start with `pk_`), otherwise an invalid key crashes the whole React tree.
- **Why:** The user pasted a GitHub PAT as the Clerk publishable key (twice); the app white-screened until the ClerkProvider was guarded by a `pk_` prefix check in `main.tsx`.
- **How to apply:** Any time a secret is added/changed, do a prefix/length sanity check and a harmless API ping before restarting and debugging deeper.
- Clerk users are bridged to the legacy passport session via `/api/auth/clerk-sync` (Clerk ID stored as `clerk:<id>` in the googleId column) so credits/history stay unchanged — keep that bridge if auth is touched again.
- The client resync latch must reset on sign-out or a second sign-in in the same tab silently skips server session sync.
- **Rule:** When a Clerk dev instance's keys are swapped, stale `__clerk_db_jwt` dev-browser cookies make ClerkJS fail init with 4x 401 ("Something went wrong initializing Clerk") — it reuses the rejected token and never requests a new dev_browser token. Naive `document.cookie` deletion is not enough: replay deletes across domain/path variants AND attribute permutations (`max-age=0`, `Secure`, `SameSite=None`, `Partitioned`) — Partitioned cookies can only be cleared with the `Partitioned` attribute.
- **Why:** Two purge attempts failed silently until attribute permutations were added; browser console "Failed to load resource 401" gave no URLs — diagnosing required `performance.getEntriesByType("resource")` (a window.fetch interceptor saw nothing).
- **How to apply:** Purge runs once per pk change via a versioned localStorage marker (`nwl_clerk_pk_v3` in `main.tsx`); bump the marker version if the purge logic changes so existing browsers re-run it.
- Also: Clerk dev instances reject unknown origins — PATCH `api.clerk.com/v1/instance` `allowed_origins` with the Replit dev domain when keys change (a key swap means a different instance that lacks the origin).
- **Rule:** Clerk `signIn.authenticateWithPopup` requires ABSOLUTE redirect URLs (`window.location.origin + path`); relative paths throw `Failed to construct 'URL': Invalid URL`. Never fall back to `authenticateWithRedirect` on a popup runtime error — inside the embedded Replit preview iframe a full-page redirect hits Google's 403 frame-blocking. Redirect fallback is only for popup-API-missing or popup-blocked (window.open returned null).
- **Why:** Relative URLs silently broke the popup path, the catch-all fallback redirected the iframe, and the user saw Google 403 twice.
- **How to apply:** Any change to the Google sign-in flow must keep absolute URLs and the narrow fallback; verify sign-up mode/providers non-invasively via the public frontend endpoint `https://<clerk-frontend-domain>/v1/environment?_clerk_js_version=5`.
