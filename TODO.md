# TODO

_Last updated: 2026-05-10_

## Last shipped

- **2026-05-10** — Project name updated FSTS → FTS in README ([`76da266`](https://github.com/Ktulue/FTS/commit/76da266))
- **2026-04-18** — Skateboard phase merged: core listener, plugin host, Admin Panel, raw UDP forwarder, two validator modules ([PR #1](https://github.com/Ktulue/FTS/pull/1), [`592b742`](https://github.com/Ktulue/FTS/commit/592b742))

## Up next

**Finish the FSTS → FTS rename.**

The 2026-05-10 commit only updated `README.md`. 15 other files still reference `FSTS`/`fsts`: `package.json`, both `.bat` launchers, source files (`src/index.ts`, parser, http server, config loader, hub HTML, mock input test), `TESTING.md`, the spec, and the plan doc. Decide whether to rename `start-fsts.bat`/`stop-fsts.bat` → `start-fts.bat`/`stop-fts.bat` (breaking change for muscle memory) or leave the `.bat` filenames and just clean up code/docs. First action: search for `FSTS`/`fsts` references and sweep file by file.

---

_Not on the active list:_ overlays (Bicycle), persistence/StreamDeck/Moza activation/CLI (Car) — see [`docs/superpowers/specs/2026-04-18-stream-telemetry-suite-design.md`](docs/superpowers/specs/2026-04-18-stream-telemetry-suite-design.md) §10.
