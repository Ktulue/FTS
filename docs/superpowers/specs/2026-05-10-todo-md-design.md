## TODO.md — Re-entry On-Ramp Design

**Status:** Draft — pending user review
**Date:** 2026-05-10
**Scope:** Add `TODO.md` and a small `CLAUDE.md` to the FTS repo root. Establish a low-maintenance convention for keeping `TODO.md` current across intermittent work sessions.

---

### 1. Purpose

FTS is worked on intermittently — weeks may elapse between sessions. The cost of re-entering the project cold is non-trivial: which doc do you read first, where did you leave off, what's the next concrete action.

`TODO.md` exists to collapse that re-entry cost to ~30 seconds: open the file, read two short sections, know what to do.

It is **not** a roadmap (README has one), **not** a backlog (the spec's Future Work appendix has one), **not** a kanban board, and **not** a session journal.

### 2. Job-to-be-done

When you sit down to work on FTS after weeks away, `TODO.md` should answer two questions:

1. **Where did I leave off?** ("Last shipped")
2. **What's the next thing?** ("Up next")

Anything that doesn't directly serve those two questions is out of scope for this file.

### 3. Format

**Location:** `TODO.md` at repo root, alongside `README.md` and `TESTING.md`.

**Structure:**

```markdown
# TODO

_Last updated: YYYY-MM-DD_

## Last shipped

- **YYYY-MM-DD** — short description (commit ref or PR link)
- **YYYY-MM-DD** — short description (commit ref or PR link)

## Up next

**Headline of the next thing.**

Two or three sentences of entry-point context: where the relevant spec/plan/code lives, what state it's in, and the first concrete action when the next session begins. Pointers, not prose.

---

_Not on the active list:_ <pointer to spec's Future Work for deferred work>
```

**Conventions:**

- Dates use ISO `YYYY-MM-DD`.
- "Last shipped" caps at ~3 most recent entries; older work falls off (git log is the audit trail).
- "Up next" is **one** headline item, not a list. Multiple parallel "next things" defeat the purpose of the file.
- The footer line points future-phase work to the spec so the file is not tempted to grow into a roadmap.

### 4. Initial content

`Last shipped` (newest first):

- **2026-05-10** — Project name updated FSTS → FTS in README (commit `76da266`)
- **2026-04-18** — Skateboard phase merged: core listener, plugin host, Admin Panel, raw UDP forwarder, two validator modules (PR #1, commit `592b742`)

`Up next`:

> **Finish the FSTS → FTS rename.**
>
> The 2026-05-10 commit only updated `README.md`. 15 other files still reference `FSTS`/`fsts`: `package.json`, both `.bat` launchers, source files (`src/index.ts`, parser, http server, config loader, hub HTML, mock input test), `TESTING.md`, the spec, and the plan doc. Decide whether to rename `start-fsts.bat`/`stop-fsts.bat` → `start-fts.bat`/`stop-fts.bat` (breaking change for muscle memory) or leave the bat filenames and just clean up code/docs. First action: search for `FSTS`/`fsts` references and sweep file by file.

Footer pointer: spec §10 (Future Work appendix), covering Bicycle (overlays) and Car (persistence, StreamDeck, Moza activation, CLI).

### 5. Maintenance convention

A `CLAUDE.md` at repo root (new file) encodes the update rule:

```markdown
# Claude instructions — FTS

When finishing a session that shipped meaningful work, update `TODO.md` before committing:

- Add a new entry to "Last shipped" (cap the section at ~3 entries; let older work fall off — git log is the audit trail)
- Update "Up next" if the next action changed
- Update the `_Last updated:_` date

Skip the update for micro-fixes (typos, comment tweaks) that don't change project direction.
```

**Rationale for `CLAUDE.md` over an in-file footer:** `CLAUDE.md` is the canonical home for project-level AI conventions and is read automatically at session start. A footer convention inside `TODO.md` is weaker — easily missed, easier to drift away from. Having `CLAUDE.md` exist also makes future project conventions (commit style, branch protocol, testing rules) low-friction to add.

### 6. Out of scope (non-goals)

- **Multi-item active lists.** "Up next" is one thing. If two things compete, decide before writing.
- **Audit trail / history beyond ~3 entries.** Git log is the audit trail.
- **Automated update mechanisms.** No hooks, no scripts. The CLAUDE.md convention is the entire mechanism.
- **Restructuring `README.md` or the spec.** The Roadmap and Future Work sections stay where they are; `TODO.md` does not duplicate them.

### 7. Acceptance criteria

- [ ] `TODO.md` exists at repo root with the format described in §3 and the initial content in §4
- [ ] `CLAUDE.md` exists at repo root with the maintenance rule in §5
- [ ] Both files are committed on the `feat/todo-md` branch
- [ ] PR opened for review; **not** merged without explicit user approval
