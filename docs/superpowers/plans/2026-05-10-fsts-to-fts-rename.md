# FSTS → FTS Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate every live `FSTS` / `fsts` / `Fsts` reference from the FTS codebase outside historical artifacts, so the project reads as "FTS" top to bottom.

**Architecture:** Pure rename. No behavior changes, no refactoring beyond what the rename touches. Tasks are grouped by tight coupling — env vars and the integration test that sets them ship together; HTML and the test that asserts on it ship together; the `FstsConfig` type and all its imports ship together. After each task, the existing test suite (`npm test`) is the verification — there's no new behavior to write tests for.

**Tech Stack:** Node 20+, TypeScript, Vitest, Windows `.bat` launchers.

**Branch:** `maint/fsts-to-fts-rename` (already created)

**Spec:** `docs/superpowers/specs/2026-05-10-fsts-to-fts-rename-design.md`

---

## Task 1: Rename `FstsConfig` type and all imports

The type is defined once in `src/core/config/types.ts` and imported by two files. All three must change in one commit or `tsc` won't compile.

**Files:**
- Modify: `src/core/config/types.ts:42`
- Modify: `src/core/config/loadConfig.ts:6, 18, 35`
- Modify: `src/index.ts:15, 32, 44`

- [ ] **Step 1: Rename the interface in `src/core/config/types.ts`**

Find line 42:
```ts
export interface FstsConfig {
```
Change to:
```ts
export interface FtsConfig {
```

- [ ] **Step 2: Rename all usages in `src/core/config/loadConfig.ts`**

Three occurrences. Find:
```ts
import type { FstsConfig } from "./types.js";
```
Change to:
```ts
import type { FtsConfig } from "./types.js";
```

Find:
```ts
export function loadConfig(path: string): FstsConfig {
```
Change to:
```ts
export function loadConfig(path: string): FtsConfig {
```

Find:
```ts
  return parsed as FstsConfig;
```
Change to:
```ts
  return parsed as FtsConfig;
```

- [ ] **Step 3: Rename all usages in `src/index.ts`**

Three occurrences. Find:
```ts
import type { FstsConfig } from "./core/config/types.js";
```
Change to:
```ts
import type { FtsConfig } from "./core/config/types.js";
```

Find:
```ts
function createInput(cfg: FstsConfig): InputSource {
```
Change to:
```ts
function createInput(cfg: FtsConfig): InputSource {
```

Find:
```ts
  let cfg: FstsConfig;
```
Change to:
```ts
  let cfg: FtsConfig;
```

- [ ] **Step 4: Verify typecheck and tests pass**

Run: `npm run typecheck`
Expected: clean exit, no errors.

Run: `npm test`
Expected: all suites green.

- [ ] **Step 5: Commit**

```bash
git add src/core/config/types.ts src/core/config/loadConfig.ts src/index.ts
git commit -m "Rename FstsConfig type to FtsConfig"
```

---

## Task 2: Rename env vars + log strings + integration test

`src/index.ts` reads `FSTS_CONFIG_PATH` / `FSTS_EXAMPLE_PATH`; `test/integration/skateboard.test.ts` sets those exact names. Renaming one without the other breaks the integration test, so they must commit together. The log strings and logger child name in `src/index.ts` ride along — same file, same rename family.

**Files:**
- Modify: `src/index.ts:17, 18, 57, 106`
- Modify: `test/integration/skateboard.test.ts:43, 48, 52, 56`

- [ ] **Step 1: Update env vars and log strings in `src/index.ts`**

Find line 17:
```ts
const CONFIG_PATH = process.env.FSTS_CONFIG_PATH ?? "./config.jsonc";
const EXAMPLE_PATH = process.env.FSTS_EXAMPLE_PATH ?? "./config.example.jsonc";
```
Change to:
```ts
const CONFIG_PATH = process.env.FTS_CONFIG_PATH ?? "./config.jsonc";
const EXAMPLE_PATH = process.env.FTS_EXAMPLE_PATH ?? "./config.example.jsonc";
```

Find line 57:
```ts
  const log = childLogger(rootLog, "fsts");
```
Change to:
```ts
  const log = childLogger(rootLog, "fts");
```

Find line 106:
```ts
  log.info({ input: cfg.input.type, httpPort: cfg.http.port, modules: moduleRegistry.length }, "FSTS started");
```
Change to:
```ts
  log.info({ input: cfg.input.type, httpPort: cfg.http.port, modules: moduleRegistry.length }, "FTS started");
```

- [ ] **Step 2: Update the integration test**

In `test/integration/skateboard.test.ts`:

Find line 43:
```ts
    const tmp = mkdtempSync(join(tmpdir(), "fsts-int-"));
```
Change to:
```ts
    const tmp = mkdtempSync(join(tmpdir(), "fts-int-"));
```

Find line 48:
```ts
    // Spawn FSTS pointed at the temp config via env vars (no cwd gymnastics).
```
Change to:
```ts
    // Spawn FTS pointed at the temp config via env vars (no cwd gymnastics).
```

Find line 52:
```ts
      env: { ...process.env, FSTS_CONFIG_PATH: cfgPath, FSTS_EXAMPLE_PATH: cfgPath },
```
Change to:
```ts
      env: { ...process.env, FTS_CONFIG_PATH: cfgPath, FTS_EXAMPLE_PATH: cfgPath },
```

Find line 56:
```ts
    child.stderr?.on("data", (d) => console.error("[fsts-stderr]", d.toString()));
```
Change to:
```ts
    child.stderr?.on("data", (d) => console.error("[fts-stderr]", d.toString()));
```

- [ ] **Step 3: Run full test suite (integration test is the load-bearing one here)**

Run: `npm test`
Expected: all suites green, including `Skateboard integration` in `test/integration/skateboard.test.ts`.

If the integration test fails, do NOT proceed. The most likely cause is a typo in an env var name on either side. Diff `src/index.ts` lines 17-18 against `test/integration/skateboard.test.ts` line 52 — they must agree exactly.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts test/integration/skateboard.test.ts
git commit -m "Rename FSTS env vars and log strings to FTS"
```

---

## Task 3: Rename Admin Panel HTML + its test

The HTML title and `<h1>` are asserted by `Server.test.ts:153`. They commit together.

**Files:**
- Modify: `src/core/hub/index.html:5, 10`
- Modify: `src/core/http/Server.test.ts:153`

- [ ] **Step 1: Update `src/core/hub/index.html`**

Find line 5:
```html
  <title>FSTS Admin</title>
```
Change to:
```html
  <title>FTS Admin</title>
```

Find line 10:
```html
    <h1>FSTS</h1>
```
Change to:
```html
    <h1>FTS</h1>
```

- [ ] **Step 2: Update the assertion in `src/core/http/Server.test.ts`**

Find line 153:
```ts
    expect(html).toContain("FSTS Admin");
```
Change to:
```ts
    expect(html).toContain("FTS Admin");
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all green. The relevant test is `serves /hub HTML` in `Server.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/core/hub/index.html src/core/http/Server.test.ts
git commit -m "Rename Admin Panel title and h1 to FTS"
```

---

## Task 4: Rename remaining internal references (temp-dir prefixes + parser comment)

Three small changes across three files. None are coupled to each other, but they're all internal cosmetic strings, so one commit is fine.

**Files:**
- Modify: `src/core/config/loadConfig.test.ts:9`
- Modify: `src/core/input/MockInput.test.ts:10`
- Modify: `src/core/parser/TelemetryPacket.ts:3`

- [ ] **Step 1: Update temp-dir prefix in `loadConfig.test.ts`**

Find line 9:
```ts
  const dir = mkdtempSync(join(tmpdir(), "fsts-cfg-"));
```
Change to:
```ts
  const dir = mkdtempSync(join(tmpdir(), "fts-cfg-"));
```

- [ ] **Step 2: Update temp-file prefix in `MockInput.test.ts`**

Find line 10:
```ts
  return join(tmpdir(), `fsts-test-${randomBytes(4).toString("hex")}.fzt`);
```
Change to:
```ts
  return join(tmpdir(), `fts-test-${randomBytes(4).toString("hex")}.fzt`);
```

- [ ] **Step 3: Update comment in `TelemetryPacket.ts`**

Find line 3:
```ts
  /** Unix epoch ms when FSTS received/parsed the packet */
```
Change to:
```ts
  /** Unix epoch ms when FTS received/parsed the packet */
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/core/config/loadConfig.test.ts src/core/input/MockInput.test.ts src/core/parser/TelemetryPacket.ts
git commit -m "Rename internal FSTS strings to FTS (temp prefixes, comment)"
```

---

## Task 5: Rename `package.json` and regenerate lock file

The `name` field changes; the `description` field changes; `package-lock.json` is regenerated by `npm install` rather than hand-edited (avoids checksum drift).

**Files:**
- Modify: `package.json:2, 4`
- Regenerate: `package-lock.json`

- [ ] **Step 1: Update `package.json`**

Find lines 2 and 4:
```json
  "name": "fsts",
  "version": "0.1.0",
  "description": "Forza Stream Telemetry Suite",
```
Change to:
```json
  "name": "fts",
  "version": "0.1.0",
  "description": "Forza Telemetry Suite",
```

- [ ] **Step 2: Regenerate the lock file**

Run: `npm install`
Expected: completes without errors. `package-lock.json` is rewritten with the new package name.

- [ ] **Step 3: Confirm lock file no longer references `fsts`**

Run: `npm test`
Expected: all green (this also confirms the regenerated lock didn't accidentally drop a dep).

Spot check: open `package-lock.json` and confirm the top-level `"name"` field reads `"fts"`. The `node_modules` entries for the project itself (typically `""` and `"node_modules/fts"` or just the root) should also reflect the new name.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "Rename package to fts and update description"
```

---

## Task 6: Rename `.bat` launchers and update their contents

`git mv` preserves history. The window-title strings inside `start-fts.bat` and the `taskkill` filter in `stop-fts.bat` MUST match — if they don't, `stop-fts.bat` becomes a no-op.

**Files:**
- Rename: `start-fsts.bat` → `start-fts.bat`
- Rename: `stop-fsts.bat` → `stop-fts.bat`
- Modify: contents of both

- [ ] **Step 1: Rename the files via git**

Run:
```
git mv start-fsts.bat start-fts.bat
git mv stop-fsts.bat stop-fts.bat
```
Expected: `git status` shows two `renamed:` entries.

- [ ] **Step 2: Update `start-fts.bat` contents**

Open `start-fts.bat`. Replace the entire file contents with:
```bat
@echo off
REM Starts FTS in a named console window. Close the window to stop cleanly.
title FTS
cd /d "%~dp0"
echo Starting FTS...
call npm start
echo FTS stopped.
pause
```

- [ ] **Step 3: Update `stop-fts.bat` contents**

Open `stop-fts.bat`. Replace the entire file contents with:
```bat
@echo off
REM Terminates any FTS process started via start-fts.bat by title.
taskkill /FI "WINDOWTITLE eq FTS" /T /F
exit /b 0
```

The `WINDOWTITLE eq FTS` filter MUST exactly match the `title FTS` set in `start-fts.bat`. They are coupled — verify by eye before committing.

- [ ] **Step 4: Commit**

```bash
git add start-fts.bat stop-fts.bat
git commit -m "Rename launchers to start-fts.bat and stop-fts.bat"
```

(Manual smoke test of these launchers happens in Task 8 along with full verification.)

---

## Task 7: Update live docs (README.md, TESTING.md)

**Files:**
- Modify: `README.md:19, 24`
- Modify: `TESTING.md:1, 13, 14, 37, 43, 49`

- [ ] **Step 1: Update `README.md`**

Find line 19:
```
cd FSTS
```
Change to:
```
cd FTS
```

Find line 24:
```
start-fsts.bat
```
Change to:
```
start-fts.bat
```

- [ ] **Step 2: Update `TESTING.md`**

Find line 1:
```
# FSTS — Manual Smoke Test
```
Change to:
```
# FTS — Manual Smoke Test
```

Find line 13:
```
- [ ] Delete (or rename) your `config.jsonc`, run `start-fsts.bat` — FSTS copies `config.example.jsonc` → `config.jsonc` and exits with a clear message
```
Change to:
```
- [ ] Delete (or rename) your `config.jsonc`, run `start-fts.bat` — FTS copies `config.example.jsonc` → `config.jsonc` and exits with a clear message
```

Find line 14:
```
- [ ] Run `start-fsts.bat` again — FSTS starts, log shows "FSTS started" with input type, http port, module count
```
Change to:
```
- [ ] Run `start-fts.bat` again — FTS starts, log shows "FTS started" with input type, http port, module count
```

Find line 37:
```
- [ ] Edit `config.jsonc`, set `moza-pit-house` raw output `enabled: true` with `port: 55555`; restart FSTS
```
Change to:
```
- [ ] Edit `config.jsonc`, set `moza-pit-house` raw output `enabled: true` with `port: 55555`; restart FTS
```

Find line 43:
```
- [ ] Edit `config.jsonc` to use `"input": {"type":"mock","file":"./test/fixtures/skateboard-smoke.fzt","loop":true,"speed":1.0}`; restart FSTS
```
Change to:
```
- [ ] Edit `config.jsonc` to use `"input": {"type":"mock","file":"./test/fixtures/skateboard-smoke.fzt","loop":true,"speed":1.0}`; restart FTS
```

Find line 49:
```
- [ ] Close the FSTS console window (or run `stop-fsts.bat`) — process exits cleanly, no stuck UDP binding (`netstat -an | findstr :9999` is empty)
```
Change to:
```
- [ ] Close the FTS console window (or run `stop-fts.bat`) — process exits cleanly, no stuck UDP binding (`netstat -an | findstr :9999` is empty)
```

- [ ] **Step 3: Commit**

```bash
git add README.md TESTING.md
git commit -m "Update README and TESTING docs to FTS"
```

---

## Task 8: Verify success criteria + manual smoke test

This is the gate before the TODO.md update. If anything fails, fix before proceeding.

**Files:** None modified — pure verification.

- [ ] **Step 1: Confirm grep cleanliness**

Run: `git grep -in 'fsts'`
(Case-insensitive, tracked files only — automatically skips `node_modules` and `.git`.)

Expected hits, ALL of which are acceptable historical/narrative references:
- `docs/superpowers/specs/2026-04-18-stream-telemetry-suite-design.md` — historical spec
- `docs/superpowers/plans/2026-04-18-stream-telemetry-suite-skateboard.md` — historical plan
- `docs/superpowers/specs/2026-05-10-todo-md-design.md` — narrates the rename in an example
- `docs/superpowers/plans/2026-05-10-todo-md.md` — narrates the rename in an example
- `docs/superpowers/specs/2026-05-10-fsts-to-fts-rename-design.md` — this rename's spec
- `docs/superpowers/plans/2026-05-10-fsts-to-fts-rename.md` — this plan
- `TODO.md` — `Last shipped` lines literally narrate "FSTS → FTS"

ANY hit outside this list is a miss. Go back and fix the file before proceeding.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: all suites green, including `Skateboard integration`.

Run: `npm run typecheck`
Expected: clean exit.

- [ ] **Step 3: Manual smoke test (Windows)**

This step requires a Windows terminal. The launchers are not covered by automated tests.

Run: `.\start-fts.bat`
Expected: a console window opens with title "FTS" (visible in the window title bar and in Alt+Tab); console output shows `Starting FTS...` and shortly after a log line containing `"FTS started"` with `input`, `httpPort`, and `modules` fields.

In a browser, open `http://localhost:5780/hub`.
Expected: page tab title reads "FTS Admin"; the page heading reads "FTS".

In a separate terminal, run: `.\stop-fts.bat`
Expected: the FTS console window closes; `stop-fts.bat` reports the process was terminated.

Run: `netstat -an | findstr :9999`
Expected: empty output (no orphan UDP binding).

If `stop-fts.bat` doesn't kill the window, the most likely cause is a `WINDOWTITLE` mismatch between the two `.bat` files. Reopen them and verify both reference exactly `FTS`.

- [ ] **Step 4: No commit yet**

Verification steps don't produce file changes. The next task (TODO.md update) is the final commit on this branch.

---

## Task 9: Update `TODO.md`

Per `CLAUDE.md`: shipped meaningful work → update `TODO.md` before final commit. Cap `Last shipped` at ~3 entries.

**Files:**
- Modify: `TODO.md:3, 5-8, 10-14`

- [ ] **Step 1: Replace the `Last shipped` and `Up next` sections**

Open `TODO.md`. Replace lines 3 through 14 (`_Last updated:_` through the end of the `Up next` paragraph) with:

```markdown
_Last updated: 2026-05-10_

## Last shipped

- **2026-05-10** — Finished FSTS → FTS rename across code, tests, launchers, and live docs (branch `maint/fsts-to-fts-rename`)
- **2026-05-10** — Project name updated FSTS → FTS in README ([`76da266`](https://github.com/Ktulue/FTS/commit/76da266))
- **2026-04-18** — Skateboard phase merged: core listener, plugin host, Admin Panel, raw UDP forwarder, two validator modules ([PR #1](https://github.com/Ktulue/FTS/pull/1), [`592b742`](https://github.com/Ktulue/FTS/commit/592b742))

## Up next

**Pick the next item from the backlog.** With the rename complete, the next active priority is a judgment call between Bicycle (overlays) and the Car-phase items (persistence, StreamDeck, Moza activation, CLI). See [`docs/superpowers/specs/2026-04-18-stream-telemetry-suite-design.md`](docs/superpowers/specs/2026-04-18-stream-telemetry-suite-design.md) §10 for the full backlog.
```

Notes:
- Cap at 3 `Last shipped` entries. The 2026-04-18 entry was already the bottom of the list and stays. The new 2026-05-10 entry is inserted at the top. The previous 2026-05-10 README entry stays as the second item — it's part of the same milestone narrative and still inside the 3-entry cap.
- The `Up next` text intentionally hands the priority decision back to the user. Don't pre-pick Bicycle or Car here — that's a separate brainstorm.

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "Update TODO.md: rename complete, hand next priority decision to user"
```

- [ ] **Step 3: Confirm branch is ready for PR**

Run: `git log --oneline main..HEAD`
Expected: 10 commits on `maint/fsts-to-fts-rename` — 2 spec commits from the brainstorm phase plus 8 task commits:
1. `Add design spec for FSTS to FTS rename cleanup` (brainstorm)
2. `Expand rename spec scope: FstsConfig type and package.json description` (brainstorm)
3. `Rename FstsConfig type to FtsConfig` (Task 1)
4. `Rename FSTS env vars and log strings to FTS` (Task 2)
5. `Rename Admin Panel title and h1 to FTS` (Task 3)
6. `Rename internal FSTS strings to FTS (temp prefixes, comment)` (Task 4)
7. `Rename package to fts and update description` (Task 5)
8. `Rename launchers to start-fts.bat and stop-fts.bat` (Task 6)
9. `Update README and TESTING docs to FTS` (Task 7)
10. `Update TODO.md: rename complete, hand next priority decision to user` (Task 9)

Run: `git status`
Expected: clean working tree.

- [ ] **Step 4: Open PR — STOP HERE**

Per `CLAUDE.md`: "Always open the PR and stop. Never run `gh pr merge` or merge a PR in any way without explicit user approval."

Run:
```bash
git push -u origin maint/fsts-to-fts-rename
gh pr create --title "maint: finish FSTS to FTS rename" --body "$(cat <<'EOF'
## Summary

- Renames every live FSTS / fsts / Fsts reference to FTS across code, tests, launchers, and live docs
- Includes `FstsConfig` TypeScript type and `package.json` description ("Forza Stream Telemetry Suite" → "Forza Telemetry Suite") to match the README
- Renames `start-fsts.bat` / `stop-fsts.bat` launchers to `start-fts.bat` / `stop-fts.bat` (one-time muscle-memory cost; re-pin any taskbar shortcuts)
- Historical artifacts under `docs/superpowers/specs/2026-04-18-*` and `docs/superpowers/plans/2026-04-18-*` intentionally untouched
- Spec: `docs/superpowers/specs/2026-05-10-fsts-to-fts-rename-design.md`

## Test plan

- [x] `npm test` green (full suite, including `Skateboard integration`)
- [x] `npm run typecheck` clean
- [x] `git grep -in 'fsts'` returns hits only inside historical/narrative locations (see spec §Verification)
- [x] Manual: `start-fts.bat` opens window titled "FTS"; `http://localhost:5780/hub` shows "FTS Admin" / `<h1>FTS</h1>`
- [x] Manual: `stop-fts.bat` cleanly terminates the window; `netstat -an | findstr :9999` is empty after stop

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then say to the user: **"PR is open — ready to merge when you give the word."** Do NOT run `gh pr merge`.

---

## Self-Review Notes

Coverage check vs spec:
- ✅ All 11 code/config files in spec table → Tasks 1, 2, 3, 4, 5
- ✅ Both `.bat` files renamed and contents updated → Task 6
- ✅ Both live docs (`README.md`, `TESTING.md`) → Task 7
- ✅ Verification gates (grep, npm test, typecheck, manual smoke) → Task 8
- ✅ `TODO.md` update per `CLAUDE.md` → Task 9
- ✅ PR open + STOP per global Git Workflow rule → Task 9 Step 4
- ✅ Historical docs left alone (no task touches them)

No placeholders. No "TBD" or "implement later". Every step shows actual code or actual command output.

Type consistency: the type name change (`FstsConfig` → `FtsConfig`) is consistent across Task 1's three steps — same name in `types.ts`, `loadConfig.ts`, and `index.ts`.
