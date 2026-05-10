# FSTS → FTS Rename — Design

_Date: 2026-05-10_
_Branch: `maint/fsts-to-fts-rename`_

## Goal

Eliminate every live `FSTS` / `fsts` reference outside historical artifacts so the codebase reads as "FTS" top to bottom. Follows the partial rename in commit `76da266` (README only) flagged in `TODO.md`.

## Scope

### In-scope: code, config, tests, launchers, live docs

**Code & config (11 files):**

| File | Change |
|---|---|
| `package.json` | `"name": "fsts"` → `"fts"`; `"description": "Forza Stream Telemetry Suite"` → `"Forza Telemetry Suite"` (matches README H1; the dropped "Stream" mirrors the dropped "S" in the acronym) |
| `package-lock.json` | Regenerate via `npm install` (do not hand-edit) |
| `src/core/config/types.ts` | `export interface FstsConfig` → `FtsConfig` |
| `src/core/config/loadConfig.ts` | 3 refs: `import type { FstsConfig }` → `FtsConfig`; `function loadConfig(path: string): FstsConfig` → `FtsConfig`; `return parsed as FstsConfig` → `FtsConfig` |
| `src/index.ts` | `import type { FstsConfig }` → `FtsConfig` + 2 usages (`function createInput(cfg: FstsConfig)`, `let cfg: FstsConfig`); env vars `FSTS_CONFIG_PATH` / `FSTS_EXAMPLE_PATH` → `FTS_CONFIG_PATH` / `FTS_EXAMPLE_PATH`; logger child name `"fsts"` → `"fts"`; log message `"FSTS started"` → `"FTS started"` |
| `src/core/parser/TelemetryPacket.ts` | Comment `"FSTS received/parsed"` → `"FTS received/parsed"` |
| `src/core/hub/index.html` | `<title>FSTS Admin</title>` → `<title>FTS Admin</title>`; `<h1>FSTS</h1>` → `<h1>FTS</h1>` |
| `src/core/http/Server.test.ts` | `expect(html).toContain("FSTS Admin")` → `expect(html).toContain("FTS Admin")` |
| `src/core/config/loadConfig.test.ts` | Temp-dir prefix `fsts-cfg-` → `fts-cfg-` |
| `src/core/input/MockInput.test.ts` | Temp-file prefix `fsts-test-` → `fts-test-` |
| `test/integration/skateboard.test.ts` | Temp-dir prefix `fsts-int-` → `fts-int-`; comment `"Spawn FSTS"` → `"Spawn FTS"`; env vars `FSTS_CONFIG_PATH` / `FSTS_EXAMPLE_PATH` → `FTS_*`; stderr log prefix `[fsts-stderr]` → `[fts-stderr]` |

**Filename renames (use `git mv` to preserve history):**

- `start-fsts.bat` → `start-fts.bat`
- `stop-fsts.bat` → `stop-fts.bat`

**Contents of the renamed `.bat` files also change:**

- `start-fts.bat`: `title FSTS` → `title FTS`; comment header `"Starts FSTS in a named console window"` → `"Starts FTS in a named console window"`; echoes `"Starting FSTS..."` / `"FSTS stopped."` → `"Starting FTS..."` / `"FTS stopped."`
- `stop-fts.bat`: `taskkill /FI "WINDOWTITLE eq FSTS"` → `eq FTS`; comment header `"Terminates any FSTS process started via start-fsts.bat by title"` → `"Terminates any FTS process started via start-fts.bat by title"`

The window-title strings in `start-fts.bat` and `stop-fts.bat` MUST match. If they don't, `taskkill` can't find the process.

**Live docs (2 files):**

- `README.md` — `cd FSTS` → `cd FTS`; `start-fsts.bat` → `start-fts.bat`
- `TESTING.md` — heading `# FSTS — Manual Smoke Test` → `# FTS — Manual Smoke Test`; in-line references to `start-fsts.bat` / `stop-fsts.bat` and `"FSTS started"` log message

### Out-of-scope (intentional)

These are historical artifacts. Rewriting them would muddy the project's record.

- `docs/superpowers/specs/2026-04-18-stream-telemetry-suite-design.md` — original design under the FSTS name
- `docs/superpowers/plans/2026-04-18-stream-telemetry-suite-skateboard.md` — original implementation plan under the FSTS name
- `docs/superpowers/specs/2026-05-10-todo-md-design.md` — narrates "FSTS → FTS" event in its `Last shipped` example
- `docs/superpowers/plans/2026-05-10-todo-md.md` — same as above
- `TODO.md` `Last shipped` entries — they literally describe the FSTS → FTS milestone
- `.git/` history — never rewritten

## Order of Operations

1. Rename source files & their contents: `src/index.ts`, parser, hub HTML, three test files, integration test
2. Update `package.json` `name` field, then run `npm install` to regenerate `package-lock.json`
3. `git mv start-fsts.bat start-fts.bat`; `git mv stop-fsts.bat stop-fts.bat`; update their contents (title, comments, echoes, taskkill filter)
4. Update `README.md` and `TESTING.md`
5. Run `npm test` — must pass green
6. Manual smoke test: `start-fts.bat` launches, Admin Panel shows `FTS`; `stop-fts.bat` cleanly terminates the process (no orphan UDP binding on `:9999`)
7. Update `TODO.md`: add a `Last shipped` entry for this rename, refresh `Up next`, bump `_Last updated:_` date

## Risks & Mitigations

- **`stop-fts.bat` ↔ `start-fts.bat` coupling.** The `taskkill` filter in `stop-fts.bat` matches the `title` set by `start-fts.bat`. Mismatch = stop becomes a no-op. Catch via manual smoke test in step 6.
- **`package-lock.json` checksum drift.** Hand-editing the `name` field in the lock leaves checksums inconsistent. Mitigation: use `npm install` to regenerate.
- **Env var rename breaks existing scripts.** `FSTS_CONFIG_PATH` / `FSTS_EXAMPLE_PATH` are only set by the integration test, which we update in the same change. No other consumer exists. Sole-user project: no external callers to break.

## Verification & Success Criteria

After the sweep, a case-insensitive grep (`grep -ri 'fsts'` — covers `FSTS`, `fsts`, and `Fsts`) from the project root should return hits ONLY inside:

- `docs/superpowers/specs/2026-04-18-*` and `docs/superpowers/plans/2026-04-18-*` (historical)
- `docs/superpowers/specs/2026-05-10-todo-md-design.md` and `docs/superpowers/plans/2026-05-10-todo-md.md` (historical narration)
- `docs/superpowers/specs/2026-05-10-fsts-to-fts-rename-design.md` and the corresponding plan doc (this spec; narrates the rename)
- `TODO.md` `Last shipped` lines
- `.git/` history
- `node_modules/` (third-party — never touched)

Any hit outside those locations is a miss and must be fixed before commit.

Additional gates:

- `npm test` is green
- Manual smoke: `start-fts.bat` opens a window titled `FTS`, Admin Panel HTML shows `FTS Admin` / `<h1>FTS</h1>`; `stop-fts.bat` closes that window cleanly; `netstat -an | findstr :9999` returns empty after stop

## Non-Goals

- No behavior changes. This is a pure rename.
- No refactoring beyond what the rename requires.
- No README polish beyond the two FSTS references.
