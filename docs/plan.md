# Plan

## Partial commit and revert

Design: Accepted on 2026-10-31.

| Document | Status |
| --- | --- |
| [REQ-001](requirements/REQ-001-partial-commit-and-revert.md) | Accepted |
| [ADR-001](adr/ADR-001-partial-commit-and-revert.md) | Accepted |
| [partial-changes-v1](specs/partial-changes-v1.spec.md) | Accepted |
| [PoC v2 summary](research/partial-changes-poc-v2.md) | Evidence for ADR-001 |

### Work order

The stages run in the order 0–4; stages 1–3 may be developed in parallel with stage 0. The stage contents and their
"Done when" criteria are in [ADR-001, Delivery stages](adr/ADR-001-partial-commit-and-revert.md#delivery-stages).

| Stage | Work | Status | Design |
| --- | --- | --- | --- |
| 0 | Native prerequisites | In progress | [SPEC §12](specs/partial-changes-v1.spec.md#12-native-prerequisites-stage-0) |
| 1 | Partial revert, `listChanges`, `previewChanges`, Head schema check | Not started | [SPEC §5.2](specs/partial-changes-v1.spec.md#52-listchanges), [§5.3](specs/partial-changes-v1.spec.md#53-previewchanges), [§5.5](specs/partial-changes-v1.spec.md#55-revertchanges), [§6.10](specs/partial-changes-v1.spec.md#610-checkheadschema), [§6.14](specs/partial-changes-v1.spec.md#614-writerevert) |
| 2 | Partial commit of data units | Not started | [SPEC §5.4](specs/partial-changes-v1.spec.md#54-commitchanges), [§6.13](specs/partial-changes-v1.spec.md#613-writecommit) |
| 3 | Partial commit of structure units, ledger renumbering, replica guarantee | Not started | [SPEC §6.8](specs/partial-changes-v1.spec.md#68-planledger), [§10](specs/partial-changes-v1.spec.md#10-migration-history-and-replicas) |
| 4 | Public API, CLI and MCP | Not started | [SPEC §5.10](specs/partial-changes-v1.spec.md#510-facade-and-transports) |

### Stage 0 items

Each item is delivered by its own pull requests, in this order.

| Item | Priority | Status |
| --- | --- | --- |
| `applyMigrations` checks the migration id inside the migration's transaction | Must | Done (#87) |
| Migration lock checked inside every API writer's transaction, views writes included | Must | Done (#86, #89) |
| Serializable views writes | Must | Done (#86) |
| Referrer rewrites and the row-removal guard without the 100 limits | Must | Done (#88) |
| Table copy-on-write by `INSERT … SELECT` | Must | Done (#85) |
| `applyMigrations` applies an `update` synchronously or waits for the async migration | Must | Not started |
| Async migration fix (own design, a new version of async-row-migration) | Must | Not started |
| Detection scan | Must | Not started |
| Forward-only repair tool | Must | Not started |
| Branch write fence | Must | Not started |
| `createRevision` locking without scanning readonly rows | Should | Not started |
| Formulas compiled once per schema | Should | Not started |
| Set-based file registration | Should | Not started |
| Limits re-measured on production-like hardware | Gate | Not started |
| Scan run on existing deployments, results reviewed | Gate | Not started |

Acceptance scenarios for every stage: [SPEC §13](specs/partial-changes-v1.spec.md#13-acceptance-scenarios).

### Release gate

Status: not reached. No partial operation is released before the gate holds:
[ADR-001, Delivery stages](adr/ADR-001-partial-commit-and-revert.md#delivery-stages),
[SPEC §12](specs/partial-changes-v1.spec.md#12-native-prerequisites-stage-0) (release gate) and
[SPEC §11](specs/partial-changes-v1.spec.md#11-limits-and-configuration) (limits re-measured).

### Open questions

Questions 2 and 3 of [SPEC §17](specs/partial-changes-v1.spec.md#17-open-questions) are decided during stage 0.
