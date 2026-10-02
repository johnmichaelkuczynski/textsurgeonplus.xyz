# Fresh Tree browser regressions

Run `npm run test:fresh-tree:browser`. This uses the existing Playwright package;
install its Chromium browser or set `CHROMIUM_BIN` to a compatible executable.
On Replit, the runner also discovers installed Nix Chromium executables.
Missing browser infrastructure fails the command rather than reporting a pass.

The runner starts and closes a private Vite server on a dynamically allocated
loopback port. It never starts/restarts the application's workflow or accesses
its database, secrets, or providers. Every API is mocked, and external browser
requests are blocked. SSE events travel through real HTTP streams, held open
until the tests observe the desired UI/storage checkpoint; no model timings
or paid calls are involved.

The test-only host imports the production `FreshTreeDialog`, UI components, and
styles. It persists only its source fixture between same-tab reloads. It does
not test Home's document ingestion/restoration or the real server's provider
orchestration. Pair it with existing service regressions:
`node --import tsx --test server/services/freshTree.test.ts`.

Coverage:
- One finished chapter, the next chapter's partially streamed third tier,
  and an untouched later chapter; exact nodes, sources, warning, settings,
  and per-thesis checkpoints through STOP, close/reopen, reload, and RESUME.
- Original resume payload, replayed tree/thesis deduplication, and final
  completion without changing an already finished chapter.
- Source, mode, selected-chapter, depth, and both instruction-field guards.
- ADD NEXT TIER stopped before the server emits any model output, followed
  by reload and successful continuation of all chapters.
- Final thesis completion before chapter-complete arrives, including a
  reviewed thesis with no retained children.