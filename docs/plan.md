# Plan

## Partial commit and revert

Design: Accepted on 2026-10-31.

| Document | Status |
| --- | --- |
| [REQ-001](requirements/REQ-001-partial-commit-and-revert.md) | Accepted |
| [ADR-001](adr/ADR-001-partial-commit-and-revert.md) | Accepted; amended by ADR-002 |
| [ADR-002](adr/ADR-002-draft-reads-and-public-changes-api.md) | Accepted (2026-11-10): the public API revision and the Draft reads |
| [partial-changes-v1](specs/partial-changes-v1.spec.md) | Accepted; v2.0 (the API revision) pending in code |
| [draft-reads-v1](specs/draft-reads-v1.spec.md) | Accepted; the table reads and the summary in code, the row reads pending |
| [async-row-migration-v2](specs/async-row-migration-v2.spec.md) | Accepted |
| [schema-ledger-backfill-v1](specs/schema-ledger-backfill-v1.spec.md) | Accepted |
| [PoC v2 summary](research/partial-changes-poc-v2.md) | Evidence for ADR-001 |

### Work order

The stages run in the order 0–4; stages 1–3 may be developed in parallel with stage 0. The stage contents and their
"Done when" criteria are in [ADR-001, Delivery stages](adr/ADR-001-partial-commit-and-revert.md#delivery-stages).

| Stage | Work | Status | Design |
| --- | --- | --- | --- |
| 0 | Native prerequisites | Must items done; one should item and the release gate open | [SPEC §12](specs/partial-changes-v1.spec.md#12-native-prerequisites-stage-0) |
| 1 | Partial revert, `listChanges`, `previewChanges`, Head schema check | Done (#104, #125, #129, #133) | [SPEC §5.2](specs/partial-changes-v1.spec.md#52-listchanges), [§5.3](specs/partial-changes-v1.spec.md#53-previewchanges), [§5.5](specs/partial-changes-v1.spec.md#55-revertchanges), [§6.10](specs/partial-changes-v1.spec.md#610-checkheadschema), [§6.14](specs/partial-changes-v1.spec.md#614-writerevert) |
| 2 | Partial commit of data units | Done (#130, #137) | [SPEC §5.4](specs/partial-changes-v1.spec.md#54-commitchanges), [§6.13](specs/partial-changes-v1.spec.md#613-writecommit) |
| 3 | Partial commit of structure units, ledger renumbering, replica guarantee | Done (#142, #144) | [SPEC §6.8](specs/partial-changes-v1.spec.md#68-planledger), [§10](specs/partial-changes-v1.spec.md#10-migration-history-and-replicas) |
| 4 | Public API, CLI and MCP | In progress: the API revision and the Draft reads ([ADR-002, Delivery](adr/ADR-002-draft-reads-and-public-changes-api.md#delivery), PRs 1–11; PR 1 done in #175; PR 8, the table reads and the summary, implemented), then the engine facade (draft #145, PR 12) | [SPEC §5.10](specs/partial-changes-v1.spec.md#510-facade-and-transports), [draft-reads-v1](specs/draft-reads-v1.spec.md) |

### Stage 0 items

Each item is delivered by its own pull requests, in this order.

| Item | Priority | Status |
| --- | --- | --- |
| `applyMigrations` checks the migration id inside the migration's transaction | Must | Done (#87) |
| Migration lock checked inside every API writer's transaction, views writes included | Must | Done (#86, #89) |
| Serializable views writes | Must | Done (#86) |
| Referrer rewrites and the row-removal guard without the 100 limits | Must | Done (#88) |
| Table copy-on-write by `INSERT … SELECT` | Must | Done (#85) |
| `applyMigrations` waits for the async migration ([async SPEC §4](specs/async-row-migration-v2.spec.md#4-applymigrations-above-the-threshold)) | Must | Done (#115) |
| Async migration fix ([async-row-migration-v2 §3](specs/async-row-migration-v2.spec.md#3-the-fixed-async-migration)) | Must | Done (cleanup: #90, state machine: #97, recovery: #102, atomic swap: #105, guarded start: #109, batches: #112, applyMigrations: #115, exclusive fence: #128) |
| Detection scan ([async-row-migration-v2 §5](specs/async-row-migration-v2.spec.md#5-detection-scan-scanschemaledger)) | Must | Done (#124, #126, #127); host exposure with the release gate |
| Forward-only repair tool ([async-row-migration-v2 §6](specs/async-row-migration-v2.spec.md#6-forward-only-repair-repairschemaledger)) | Must | Done (planner: #118, #121; write: #131); host exposure with the release gate |
| Schema ledger backfill ([schema-ledger-backfill-v1](specs/schema-ledger-backfill-v1.spec.md)) | Must | Done (SPEC: #169; planning: #172; write: #173; docs: #176); host exposure with the release gate |
| Branch write fence | Must | Done (shared: #92, exclusive escalation: #119) |
| `createRevision` locking without scanning readonly rows | Should | Done (#91) |
| Formulas compiled once per schema | Should | Not started |
| Set-based file registration | Should | Done (#94) |
| Limits re-measured on production-like hardware | Gate | Not started |
| Scan run on existing deployments, results reviewed | Gate | Not started |

Acceptance scenarios for every stage: [SPEC §13](specs/partial-changes-v1.spec.md#13-acceptance-scenarios).
After stages 1–3, an audit of master (2026-11-08) led to #162–#167: input types, database errors in lookups, the
fingerprint, and tests for AS-36, AS-38, AS-39, AS-41 and AS-54.

### Release gate

Status: not reached. No partial operation is released before the gate holds:
[ADR-001, Delivery stages](adr/ADR-001-partial-commit-and-revert.md#delivery-stages),
[SPEC §12](specs/partial-changes-v1.spec.md#12-native-prerequisites-stage-0) (release gate) and
[SPEC §11](specs/partial-changes-v1.spec.md#11-limits-and-configuration) (limits re-measured).

### Open questions

Question 2 of [SPEC §17](specs/partial-changes-v1.spec.md#17-open-questions) is still open; question 3 was decided on
2026-11-01.
