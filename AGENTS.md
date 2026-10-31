# AGENTS.md — Revisium Engine

Fetch and follow https://raw.githubusercontent.com/revisium/agent-rules/master/AGENTS.md
before starting work. If retrieval fails, report it before making changes.

## Project context

[README.md](README.md) gives the overview and the local setup. Files in `docs/`
describe the current runtime and accepted designs that are not implemented yet.

## Documentation workflow

- Follow workflow/documents.md from the selected revisium/agent-rules revision.
- The active series starts at REQ-001. ADRs use this repository's own series,
  starting at ADR-001.
- Layout:
  - `docs/requirements/` — requirements, `REQ-NNN-<topic>.md`.
  - `docs/adr/` — architecture decisions, `ADR-NNN-<topic>.md`.
  - `docs/specs/` — specifications, `<topic>-vN.spec.md`.
  - `docs/research/` — evidence that ADRs and SPECs cite, such as PoC summaries.
  - `docs/plan.md` — work order and statuses.
  - Other files in `docs/` describe the current runtime: API, versioning,
    migrations, file usage and testing.
- Link documents of the Revisium architecture repository by absolute GitHub URL.

## Verification

Tests use PostgreSQL from `.env.test`; README.md's Development section starts it.

```bash
pnpm run lint:ci         # lint (0 warnings)
pnpm run tsc             # type check
pnpm test                # run tests
pnpm run build           # production build
```
