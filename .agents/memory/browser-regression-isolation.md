---
name: Browser regression isolation
description: Why deterministic generation regressions use a separate host and controlled HTTP streams
---

Keep deterministic generation browser tests independent of the live application's providers and ongoing user work. Use a private test host for the production component and real, manually released HTTP SSE events; report clearly which production orchestration paths are not exercised.

**Why:** Earlier Fresh Tree browser attempts were blocked by infrastructure and produced no result. A separate host avoids disturbing long-running user generation and makes each interruption reproducible without paid requests. A component-host pass is evidence of browser checkpoint behavior, not proof of live provider or server orchestration correctness.

**How to apply:** For stopped/resumed streaming regressions, release the next event only after observing the previous UI and storage checkpoint. Check exact resume payloads and real same-tab reloads. Keep production-route verification distinct rather than overstating what mocked SSE tests establish.