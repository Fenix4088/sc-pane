# Source Control mod

A Claude Code function-hooks plugin that adds a VS Code-style Source Control pane and a Git Graph pane. `hooks/register.tsx` only wires the hooks; state lives in `hooks/store.ts`, git operations in `hooks/actions/`, pure helpers in `hooks/helpers/` and the panes in `hooks/ui/` (see the file table in the requirements, section 3.1).

## Requirements

The requirements and current-state spec is `.claude/REQUIREMENTS.md` (imported below). Read it before changing behaviour; it holds the business rules (BR-*), functional requirements (FR-*), engine constraints (NFR-*), test list and open items (OPEN-*).

@REQUIREMENTS.md

Working rules:

- Treat the BR-* and NFR-* rules as hard constraints. NFR-1 (Select option limit) and NFR-2 (control characters) each blank the whole pane if broken.
- Reference requirement IDs in commit messages and test names.
- When behaviour changes, update `.claude/REQUIREMENTS.md` in the same change: the affected FR rows, the test list in section 7, and section 8 when an open item is resolved or a new one appears. Bump the version and date at the top.
- Where the spec and the code disagree, the code is authoritative; fix the spec.

## Verify

Run types, `plugin validate` and `plugin test` as described in section 7 of the requirements before calling a change done.
