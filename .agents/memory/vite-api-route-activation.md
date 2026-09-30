---
name: New API routes and live Vite
description: Why a hot-reloaded frontend can misread a stale server's HTML fallback as a successful API response
---

When a frontend calls a newly added API route, do not assume the running backend has loaded that route just because the frontend hot-reloaded. An absent route may fall through to Vite's HTML page handler and return HTTP 200. SSE clients must check response content type before reading events.

**Why:** A feature merged after the server process started appeared in the browser via hot reload, but the backend had not registered its new route. The HTML fallback returned 200 immediately; the client interpreted the lack of a completion event as an interrupted generation.

**How to apply:** Compare server process start time to the introduction of routes when a new feature produces an implausibly fast 200 without events. Verify the endpoint's response type, and follow the owner's explicit restart permission policy before activating changed server code.