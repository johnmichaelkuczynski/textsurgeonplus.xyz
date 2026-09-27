---
name: Live Vite file replacement
description: Why to edit active imported pages in place instead of deleting and recreating them during hot reload
---

When a Vite-served imported page needs a wholesale rewrite, keep the module present while editing it. Avoid a separate delete-then-add interval in a running workspace.

**Why:** During a transient missing-file interval, Vite's runtime-error overlay attempted to read the imported page and threw an uncaught file-not-found error. That ended the running preview even though the replacement module and later build were valid.

**How to apply:** Use an in-place update for live React modules. If a workflow has already failed, confirm the replacement file and build first; do not assume hot reload will recover a stopped process. Follow the project owner's restart policy before starting it again.