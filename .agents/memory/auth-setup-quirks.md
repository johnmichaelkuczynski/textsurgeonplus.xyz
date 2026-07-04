---
name: Auth history — optional Google login (reinstated)
description: Owner's current auth policy and hard-won OAuth/secrets quirks; read before touching anything auth-related.
---

# Authentication: OPTIONAL Google login (reinstated July 2026)

- **Rule:** Google OAuth login exists but is strictly OPTIONAL. The app stays fully open — every analysis/TTS feature works anonymously with no gates. Signing in only enables history, saved profiles, and admin. Do NOT add login walls, landing pages, or gates on analysis endpoints.
- **Why:** Owner first ordered all auth removed (redirect_uri_mismatch frustration), then reversed and had Google OAuth reinstalled with a callback path he controls in Google Cloud Console. Both decisions were explicit; the current standing state is optional login.
- **How to apply:**
  - Callback path is `/auth/google/callback` (NO `/api` prefix — it must match the URIs the owner registers in Google Cloud). A legacy `/api/auth/google/callback` alias also works.
  - Credentials read from env with fallbacks: `GOOGLE_LOGIN_CLIENT_ID/SECRET` → `GOOGLE_OAUTH_CLIENT_ID/SECRET` → `GOOGLE_CLIENT_ID/SECRET`, sanitized for invisible chars. If absent, login silently disables and the app still runs open.
  - The `/api` identity middleware stripping client-supplied `username` must stay — it prevented username spoofing (a blocking authz hole in review).
  - Credits: logged-in users get credit checks/deduction; anonymous users are ungated. Deduct credits exactly ONCE per request — a duplicate deduction block on the streaming endpoint once double-charged users.
  - Client paywall stays off (`hasCredits = true`) unless the owner rebuilds billing.
- **Other durable lessons:**
  - Google OAuth on Replit always needs BOTH redirect URIs (dev `*.riker.replit.dev` + custom domain) registered on the specific OAuth client in use; switching client credentials resets that requirement.
  - Google 403-blocks framed sign-in; in the Replit preview iframe a login link needs a new tab / `target="_top"`.
  - Account-vault secrets linked into an app can shadow same-named new keys and block saving replacements; when a stale vault entry collides, the fix is deleting the app-level entries in ALL environments (shared/dev/prod) and/or having the owner unlink the vault rows — or use fresh names entirely.
  - Verify OAuth creds non-invasively via status-code-only curl (check 302 + client_id in Location header); never print key values.
