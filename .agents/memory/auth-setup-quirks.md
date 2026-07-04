---
name: Auth setup quirks
description: Lessons from this app's login history (Google OAuth direct; Clerk was removed July 2026)
---

- **Rule:** Auth is direct Google OAuth ONLY (owner mandate, July 2026). Never reintroduce Clerk, Auth0, Firebase Auth, username login, or any auth middleman. Never tell the owner to create new OAuth credentials — his shared-vault Google creds are used.
- **Why:** Owner explicitly ordered all middlemen ripped out after repeated Clerk breakage (stale dev-browser cookies, iframe popup failures, key mixups). Clerk packages/secrets were fully removed.
- **How to apply:** Any auth change goes through `server/auth.ts` (passport-google-oauth20). Login UI must stay a plain `<a href="/api/auth/google" target="_top">` — `target="_top"` is required because the Replit preview is an iframe and Google 403-blocks framed sign-in pages.
- **Rule:** Never trust client-supplied `username` for identity. An `/api` middleware in `server/routes.ts` overwrites body/query `username` from the session and strips it for anonymous requests. Any new route must rely on that (or `req.user`), never on request params.
- **Why:** Legacy routes were keyed by a user-passed `username` string, letting anyone read/write another user's history by guessing their name — flagged as a blocking authz hole in review.
- After changing OAuth callback hosts/domains, both redirect URIs (dev `*.riker.replit.dev` and prod textsurgeonplus.xyz) must exist in the owner's Google Cloud Console OAuth client — the only manual step; changes there take effect within minutes.
- Verify a secret non-invasively before debugging deeper: status-code-only curl of `/api/auth/google` (302 to accounts.google.com proves creds load); never print key values.
