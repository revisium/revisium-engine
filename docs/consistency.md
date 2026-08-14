> Status: Accepted
>
> Version: 1.0

# Consistency and ChangeSet Contract

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, **MAY**,
**REQUIRED**, and **OPTIONAL** in this document are interpreted according to
RFC 2119 and BCP 14 only when they appear in all capitals.

This is the Engine-neutral normative VE-011 target and not a runtime
availability claim. None of the eight methods defined here is currently
exported or implemented by
`@revisium/engine`. Current and future availability is indexed in
[the API reference](api.md#changeset-availability). Present persistence,
copy-on-write, Commit, and Revert mechanics remain documented in
[Versioning System](versioning.md). The partial-commit protocol is isolated in
the [non-normative future design](design/partial-commit.md).

## Canonical ChangeSet

Every structurally valid Draft MUST have exactly one computed ChangeSet. The
ChangeSet is the canonical semantic delta from that branch's Head to its Draft;
it is not a persisted staging object. A semantically clean Draft has one empty
ChangeSet projection with zero counts.

An implementation MUST produce one set of comparison facts and feed both the
existing immutable Revision-diff presenter and a semantic ChangeSet projector.
The existing `revisionChanges`, `tableChanges`, and `rowChanges` projections
remain unchanged. The semantic projector folds facts by internal logical
identity and removes representation-only differences. Internal storage keys
MUST NOT appear in any ChangeSet, cursor, selector, diagnostic, or future
Commit Plan contract.

Repeated edits to one logical entity fold into one item. Every surviving item
has exactly one kind:

| Semantic before/after relation | Kind |
| --- | --- |
| Absent before, present after | `created` |
| Present before, absent after | `deleted` |
| External ID changed | `renamed`, even when content also changed |
| Same external ID, semantic content changed | `modified` |

A created-then-deleted entity vanishes. A pure physical copy-on-write event
with unchanged semantic content creates no item and changes no public
ChangeSet or item version.

SharedSchema changes appear only in the `shared-schema` facet. Their backing
system-table rows MUST NOT also appear as raw table or row items. Schema,
migration, and views backing facts fold into their semantic table owner. Other
raw system facts are excluded. No semantic fact may appear in two facets.

Facet counts count deduplicated semantic items. For each facet, `total` equals
the sum of its four kind counts. `totalChanges` equals the sum of the table,
row, and SharedSchema totals; `isEmpty` is true exactly when that total is zero.

## Opaque identity and stable behavior

Every public ChangeSet ID/version, item ID/version, audit or diagnostic ID,
content hash, cursor, and future plan token is an opaque echo-only string.
Callers MUST NOT parse one or depend on its algorithm, preimage, encoding,
prefix, or canonical serialization.

One ChangeSet ID belongs to one Draft Revision. Semantic edits, physical
copy-on-write, single-item Discard, and Discard all retain the Draft and its
ChangeSet ID. Full Commit promotes that Draft to Head and creates a new Draft,
so the next ChangeSet has a new ID.

The public ChangeSet version changes if and only if the complete canonical
semantic projection changes. An item version changes if and only if that
semantic item changes. Physical storage identity, readonly state, Revision
associations, and timestamps do not affect either version.

## Target documentation schema

The TypeScript in this section is documentation schema, not a package
declaration. `Branch` refers to the unchanged full Branch projection already
returned by current APIs.

```typescript
type OpaqueToken = string;
type ChangeSetEntity = 'table' | 'row' | 'shared-schema';
type ChangeSetKind = 'created' | 'modified' | 'renamed' | 'deleted';
type ChangeSetItemId = OpaqueToken;
type ChangeSetItemVersion = OpaqueToken;

interface BranchRef {
  projectId: string;
  branchName: string;
}

interface ChangeSetCurrent {
  id: OpaqueToken;
  version: OpaqueToken;
}

type ChangeSetPrecondition =
  | { mode: 'current' }
  | { mode: 'version'; current: ChangeSetCurrent };

interface ChangeSetKindCounts {
  created: number;
  modified: number;
  renamed: number;
  deleted: number;
}

interface ChangeSetFacetSummary {
  total: number;
  kinds: ChangeSetKindCounts;
}

interface ChangeSet {
  id: OpaqueToken;
  version: OpaqueToken;
  headRevisionId: string;
  draftRevisionId: string;
  totalChanges: number;
  isEmpty: boolean;
  tables: ChangeSetFacetSummary;
  rows: ChangeSetFacetSummary;
  sharedSchemas: ChangeSetFacetSummary;
}

type ChangeSetItemRef =
  | { entity: 'table'; itemId: ChangeSetItemId; tableId: string }
  | {
      entity: 'row';
      itemId: ChangeSetItemId;
      tableId: string;
      rowId: string;
    }
  | {
      entity: 'shared-schema';
      itemId: ChangeSetItemId;
      sharedSchemaId: string;
    };

type ChangeSetSide =
  | { entity: 'table'; tableId: string }
  | { entity: 'row'; tableId: string; rowId: string }
  | { entity: 'shared-schema'; sharedSchemaId: string };

type ChangeSetDetailKind =
  | 'identity'
  | 'field'
  | 'schema'
  | 'migration'
  | 'views'
  | 'formula-definition'
  | 'file-reference';

interface ChangeSetDetail {
  kind: ChangeSetDetailKind;
  path: string | null; // at most 1,024 UTF-8 bytes
  beforeHash: OpaqueToken | null;
  afterHash: OpaqueToken | null;
}

interface BoundedDetailSummary {
  count: number;
  hash: OpaqueToken;
  preview: ChangeSetDetail[]; // at most 20
  truncated: boolean; // exactly count > preview.length
}

interface ChangeSetItem {
  ref: ChangeSetItemRef;
  itemVersion: ChangeSetItemVersion;
  kind: ChangeSetKind;
  before: ChangeSetSide | null;
  after: ChangeSetSide | null;
  details: BoundedDetailSummary;
}

interface PageInfo {
  startCursor: OpaqueToken | null;
  endCursor: OpaqueToken | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

interface Edge<T> {
  cursor: OpaqueToken;
  node: T;
}

interface ChangeSetConnection<T> {
  current: ChangeSetCurrent;
  totalCount: number;
  edges: Edge<T>[]; // at most first, therefore at most 100
  pageInfo: PageInfo;
}

type ItemScope =
  | { scope: 'all' }
  | { scope: 'entity'; entity: ChangeSetEntity }
  | { scope: 'rows-in-table'; tableId: string };

interface GetChangeSetInput extends BranchRef {
  precondition?: ChangeSetPrecondition;
}

interface GetChangeSetItemsInput extends BranchRef {
  precondition?: ChangeSetPrecondition;
  itemScope: ItemScope;
  kinds?: ChangeSetKind[]; // 1..4 unique values when present
  search?: string; // normalized value at most 512 UTF-8 bytes
  first: number; // integer 0..100 inclusive
  after?: OpaqueToken;
}

interface GetChangeSetItemDetailsInput extends BranchRef {
  precondition?: ChangeSetPrecondition;
  itemId: ChangeSetItemId;
  first: number; // integer 0..100 inclusive
  after?: OpaqueToken;
}

type DiscardSelection =
  | {
      scope: 'item';
      itemId: ChangeSetItemId;
      itemVersion?: ChangeSetItemVersion;
    }
  | { scope: 'all' };

interface DiscardChangeSetInput extends BranchRef {
  precondition?: ChangeSetPrecondition;
  selection: DiscardSelection;
}

interface CommitChangeSetInput extends BranchRef {
  precondition?: ChangeSetPrecondition;
  selection: { scope: 'all' };
  message?: string; // at most 4,096 UTF-8 bytes
}

type Delivery =
  | { status: 'delivered'; revisionId: string }
  | { status: 'not-configured'; revisionId: string }
  | {
      status: 'failed';
      revisionId: string;
      code: 'POST_COMMIT_DELIVERY_FAILED';
    };

interface DiscardChangeSetResult {
  committed: true;
  operation: 'discard-item' | 'discard-all';
  branch: Branch;
  changeSet: ChangeSet;
  delivery: Delivery;
}

interface CommitChangeSetResult {
  committed: true;
  operation: 'commit';
  branch: Branch;
  previousHeadRevisionId: string;
  committedRevisionId: string;
  nextDraftRevisionId: string;
  changeSet: ChangeSet;
  delivery: Delivery;
}
```

The top-level ChangeSet contains identities, counts, and summaries only. It has
no item payload. An item's detail preview is capped at 20; the complete detail
set is available only through `changeSetItemDetails`.

### Audit and diagnostic schema

```typescript
type AuditStatus = 'valid' | 'valid-with-warnings' | 'invalid' | 'unknown';
type AuditStateStatus = 'valid' | 'invalid' | 'unknown';
type AuditCacheStatus =
  | 'in-sync'
  | 'false-with-delta'
  | 'true-without-delta'
  | 'unknown';

interface AuditFinding {
  findingId: OpaqueToken;
  severity: 'warning' | 'error' | 'unknown';
  code: string;
  tableId: string | null;
  rowId: string | null;
  path: string | null; // at most 1,024 UTF-8 bytes
  requiredCount: number;
  requiredHash: OpaqueToken;
}

interface BoundedFindingSummary {
  count: number;
  hash: OpaqueToken;
  preview: AuditFinding[]; // at most 20
  truncated: boolean; // exactly count > preview.length
}

interface BranchConsistencyAudit {
  auditId: OpaqueToken;
  projectId: string;
  branchName: string;
  current: ChangeSetCurrent | null;
  status: AuditStatus;
  stateStatus: AuditStateStatus;
  cacheStatus: AuditCacheStatus;
  findings: BoundedFindingSummary;
}

interface DiagnosticSummary {
  diagnosticId: OpaqueToken;
  count: number;
  hash: OpaqueToken;
  preview: AuditFinding[]; // at most 20
  truncated: boolean; // exactly count > preview.length
}

interface AuditBranchConsistencyInput extends BranchRef {}

interface AuditFindingsInput {
  auditId: OpaqueToken;
  severities?: Array<'warning' | 'error' | 'unknown'>; // 1..3 unique
  first: number; // integer 0..100 inclusive
  after?: OpaqueToken;
}

interface DiagnosticDetailsInput {
  diagnosticId: OpaqueToken;
  first: number; // integer 0..100 inclusive
  after?: OpaqueToken;
}

interface AuditFindingConnection {
  auditId: OpaqueToken;
  totalCount: number;
  edges: Edge<AuditFinding>[]; // at most first, therefore at most 100
  pageInfo: PageInfo;
}

interface DiagnosticFindingConnection {
  diagnosticId: OpaqueToken;
  totalCount: number;
  edges: Edge<AuditFinding>[]; // at most first, therefore at most 100
  pageInfo: PageInfo;
}
```

### Exact v1 method inventory

These eight signatures are target documentation only and are not callable in
the current runtime.

```typescript
changeSet(input: GetChangeSetInput): Promise<ChangeSet>;
changeSetItems(
  input: GetChangeSetItemsInput,
): Promise<ChangeSetConnection<ChangeSetItem>>;
changeSetItemDetails(
  input: GetChangeSetItemDetailsInput,
): Promise<ChangeSetConnection<ChangeSetDetail>>;
discardChangeSet(input: DiscardChangeSetInput): Promise<DiscardChangeSetResult>;
commitChangeSet(input: CommitChangeSetInput): Promise<CommitChangeSetResult>;
auditBranchConsistency(
  input: AuditBranchConsistencyInput,
): Promise<BranchConsistencyAudit>;
auditBranchConsistencyFindings(
  input: AuditFindingsInput,
): Promise<AuditFindingConnection>;
changeSetDiagnosticDetails(
  input: DiagnosticDetailsInput,
): Promise<DiagnosticFindingConnection>;
```

## Preconditions, ordering, search, and paging

An omitted precondition and `{mode:'current'}` both resolve the locked current
singleton atomically; neither requires a prior `changeSet` read.
`{mode:'version',current:{id,version}}` binds both opaque values as one atomic
optimistic precondition. A partial current object is invalid.

For single-item Discard, `itemVersion` is an independent optional item
precondition. After branch lock, strict topology validation, and the migration
gate, failure priority is ChangeSet ID, ChangeSet version, item existence, item
version, then total resulting-state validation. A stale global precondition
therefore wins over item errors.

Items sort by `(entityRank, preferredTableId, preferredEntityId, itemId)` using
ascending raw UTF-8 bytes. Entity ranks are table 0, row 1, SharedSchema 2.
Preferred display IDs come from the after side when present and otherwise the
before side; missing values sort first. Details sort by declaration-order kind,
then path, before hash, and after hash, with null first and then ascending raw
UTF-8 bytes.

Search is case-sensitive literal substring search after NFC normalization and
trimming over both before- and after-side external IDs. It covers table ID;
row table ID and row ID; and SharedSchema ID. An empty normalized search is
absent. A present value is at most 512 UTF-8 bytes. A present `kinds` filter has
1..4 unique values in declared kind order.

All four connections — `changeSetItems`, `changeSetItemDetails`,
`auditBranchConsistencyFindings`, and `changeSetDiagnosticDetails` — share
these rules:

- `first` is an integer from 0 through 100 inclusive;
- `first:0` returns no edges and truthful page information;
- every cursor is opaque and bound to the connection's normalized query;
- malformed/offset, stale, and cross-query cursor failures are distinguishable;
- no connection returns more edges than `first`.

Every bounded preview is exactly the first `min(count,20)` nodes of its
corresponding complete connection after applying the same normalization and
filters. It uses the connection's deterministic total order: ChangeSet items
and details use the order above, and summaries of item references use the same
item order. `truncated` is exactly `count > preview.length`. Paging the
connection reproduces the preview prefix without loss or duplicates. This rule
also applies to audit findings and diagnostic findings.

## Total consistency validator

The validator MUST decide the complete resulting state, not validate only the
changed item. It covers every domain below as one atomic consistency boundary.

| Domain | Required validation |
| --- | --- |
| Table schema and meta-schema | JSON Schema structure and Engine meta-schema rules |
| SharedSchema | Shared definitions, names, references, and exclusive semantic projection |
| Rows | Every row matches the complete resulting table schema |
| Foreign keys | All targets and reverse dependencies resolve in the resulting state |
| Formula definitions | Syntax, references, and cycles are valid |
| Folded system state | Schema, migration, and views backing facts agree with their semantic owners |
| File references | Every live reference resolves under the resulting snapshot |

Runtime formula result evaluation is not a Commit gate. A formula definition's
syntax, references, and cycles are gates; a changed runtime value alone is not.

Every validation or consistency failure whose complete finding set can exceed
20 carries a `DiagnosticSummary`. The preview is at most 20, and complete
immutable findings are available only through
`changeSetDiagnosticDetails(first:0..100)`. No failure contains an unbounded
row, issue, reason, or dependency array.

## Discard and Commit

Single-item Discard, Discard all, and full Commit validate their complete
resulting states in one serializable transaction. A pre-commit failure leaves
Head, Draft, relations, cache state, and migration state unchanged and makes
no notification attempt.

Single-item Discard reverses the whole selected logical item. Its created,
modified, renamed, and deleted forms restore the corresponding Head-to-Draft
semantic effect. It succeeds only when the entire remaining Draft passes the
total validator. It never silently adds or removes another item.

Discard all restores exact Head associations into the existing Draft. It
retains the Draft Revision ID and ChangeSet ID. Target Discard results use
`committed:true` only for a successful nonempty transaction; this means the
Draft-state transaction committed, not that a Revision was created.

V1 Commit accepts only `{scope:'all'}`. It promotes the complete Draft as a new
immutable Head snapshot and creates a new Draft. The committed Revision is a
snapshot of the complete Draft, not a delta-only Revision.

Successful Discard delivery refers to the retained Draft Revision. Successful
Commit delivery refers to the committed Revision (the previous Draft).
`delivered`, `not-configured`, and `failed` correspond to 1, 0, and 1 delivery
attempts. Delivery failure is a committed success and never rolls back state.

## Audit protocol

`auditBranchConsistency` is a pure operator-facing repeatable-snapshot read.
It performs zero writes, repairs, notifications, or opportunistic cache
updates. It returns audit identity, total status, state status, cache status,
and a bounded finding summary. Every warning is an explicit finding.

The `auditId` addresses that exact immutable finding set. Later paging either
returns that set or `AUDIT_NOT_FOUND`; it never substitutes a newer branch
snapshot. Audit-finding cursors bind audit ID and the normalized severity
filter. Diagnostic cursors bind diagnostic ID. Unknown or unavailable IDs
return `AUDIT_NOT_FOUND` or `CHANGESET_DIAGNOSTIC_NOT_FOUND` respectively.

The canonical semantic delta is authoritative when stored `hasChanges`
disagrees:

| Canonical delta | stored `hasChanges` | ChangeSet content | Audit cache status |
| --- | ---: | --- | --- |
| empty | false | empty | `in-sync` |
| dirty | true | dirty | `in-sync` |
| dirty | false | dirty | `false-with-delta` warning |
| empty | true | empty | `true-without-delta` warning |

Reads MUST NOT repair either warning. An explicit cache-only repair may update
only `hasChanges` after a fresh audit proves state validity; no generic repair
may rewrite semantic state.

## Outcomes

Target failures use `{statusCode,code,message,details}`. Rows marked
`false / zero / 0` are rollback-confirmed pre-commit failures: `committed` is
false, state effect is zero, and notification attempts are zero.

| HTTP/code | Committed / effect / notify | Bounded details or rule |
| --- | --- | --- |
| 400 `CHANGESET_INVALID_INPUT` | false / zero / 0 | Bounded field and reason; includes partial preconditions and input bounds |
| 400 `CHANGESET_INVALID_CURSOR` | false / zero / 0 | Encoding-neutral reason `INVALID`, `OFFSET`, `QUERY_MISMATCH`, or `STALE` |
| 400 `DRAFT_STATE_INVALID` | false / zero / 0 | `DiagnosticSummary` |
| 404 `CHANGESET_BRANCH_NOT_FOUND` | false / zero / 0 | Project and branch display IDs |
| 404 `CHANGESET_ITEM_NOT_FOUND` | false / zero / 0 | Opaque item ID |
| 404 `AUDIT_NOT_FOUND` | false / zero / 0 | Opaque audit ID |
| 404 `CHANGESET_DIAGNOSTIC_NOT_FOUND` | false / zero / 0 | Opaque diagnostic ID |
| 409 `CHANGESET_NOT_CURRENT` | false / zero / 0 | Requested and current opaque ChangeSet IDs |
| 409 `CHANGESET_CHANGED` | false / zero / 0 | Expected and current opaque ChangeSet versions |
| 409 `CHANGESET_ITEM_CHANGED` | false / zero / 0 | Item ID and expected/current-or-null opaque item versions |
| 409 `CHANGESET_EMPTY` | false / zero / 0 | Opaque ChangeSet ID |
| 409 `REVISION_CARDINALITY_INVALID` | false / zero / 0 | Head/Draft counts in 0..3, where 3 means at least 3; each role ID and Draft parent ID is present only when that role is singular |
| 409 `LEGACY_HEAD_INVALID` | false / zero / 0 | Head ID and `DiagnosticSummary` |
| 423 `MIGRATION_LOCKED` | false / zero / 0 | Revision ID, table ID, and active status |
| 503 `CHANGESET_TRANSACTION_ABORTED` | false / zero / 0 | Rollback-confirmed timeout, deadlock/retry exhaustion, or connection failure |
| 503 `CHANGESET_OUTCOME_UNKNOWN` | unknown / unknown / unknown | Opaque operation ID and `recovery:'AUDIT_BRANCH'` |
| success, delivery `delivered` | true / committed / 1 | Committed result |
| success, delivery `not-configured` | true / committed / 0 | Committed result |
| success, delivery `failed` | true / committed / 1 | Committed result; never rollback |

A connection loss after the commit decision is not a confirmed transaction
abort. `CHANGESET_OUTCOME_UNKNOWN` makes no delivery claim. The client MUST NOT
automatically retry. It reads current Head, Draft, and ChangeSet, runs
`auditBranchConsistency`, and correlates the operation ID with operator logs
before choosing recovery.

### Operation-specific empty behavior

| Operation on an empty canonical ChangeSet | Target outcome |
| --- | --- |
| `changeSet` | Successful ChangeSet with `isEmpty:true` and every total zero |
| `changeSetItems` | Successful empty connection with truthful page information |
| `changeSetItemDetails` | `CHANGESET_ITEM_NOT_FOUND` |
| `discardChangeSet`, item | `CHANGESET_ITEM_NOT_FOUND`, false / zero / 0 |
| `discardChangeSet`, all | `CHANGESET_EMPTY`, false / zero / 0 |
| `commitChangeSet`, all | `CHANGESET_EMPTY`, false / zero / 0 |
| `auditBranchConsistency` | Healthy report when cache is false; `true-without-delta` warning when true |
| `auditBranchConsistencyFindings` | Successful empty connection when the report has no findings |
| `changeSetDiagnosticDetails` | `CHANGESET_DIAGNOSTIC_NOT_FOUND` for an unknown or unavailable ID |

## Migration interaction

ChangeSet and audit reads are informational during any migration. Single-item
Discard and Commit reject `PENDING`, `COPYING`, and `SWAPPING`. Discard all
atomically cancels `PENDING` or `COPYING` work and restores Draft to Head;
`SWAPPING` rejects. `FAILED` is not active. Present migration and Revert
mechanics remain documented in [Async Row Migration](migration.md).

## Legacy adapters

The current runtime exposes `createRevision` and `revertChanges`; it does not
yet route through ChangeSet handlers. A target implementation maps their
successful whole-Draft behavior to current-mode all-scope Commit and Discard
without changing the established public inputs or successful projections.

Both legacy no-changes gates remain based only on stored `Draft.hasChanges`,
not canonical delta:

| Canonical delta | stored `hasChanges` | New reads | New mutations | `createRevision` | `revertChanges` |
| --- | ---: | --- | --- | --- | --- |
| empty | false | Empty success | `CHANGESET_EMPTY`, zero effect, notify 0 | Established `There are no changes` error | Established `There are no changes` error |
| dirty | false | Dirty success | Operate on canonical delta | Established `There are no changes` error | Established `There are no changes` error |
| empty | true | Empty success | `CHANGESET_EMPTY`, zero effect, notify 0 | Pinned legacy path proceeds | Pinned legacy path proceeds |
| dirty | true | Dirty success | Operate on canonical delta | Pinned legacy path proceeds | Pinned legacy path proceeds |

The legacy gate is neither repaired nor replaced. After a true gate, any new
topology, Head, Draft, migration, or transaction consistency failure uses its
classified target failure and has zero effect.

`createRevision` keeps the exact input
`{projectId,branchName,comment?}`. Historical `comment` remains unchanged and
does not inherit the target `message` limit. Success remains the complete
committed Revision plus only `previousHeadRevisionId` and
`previousDraftRevisionId`.

`revertChanges` keeps the exact input `{projectId,branchName}` and success
remains the complete existing Branch projection. Its present migration
cancellation and no-changes gate stay in one transaction, so a no-changes
failure rolls cancellation back.

Neither adapter exposes committed state, the next Draft, ChangeSet, audit, or
delivery fields. A post-commit delivery failure is logged and remains legacy
success. This preserves exact inputs and success projections; it does not
promise that every new pre-commit consistency failure is byte-identical to a
historical error. Immutable `revisionChanges`, `tableChanges`, and `rowChanges`
remain unchanged Revision comparisons and never become ChangeSet aliases.

## Legacy audit and recovery matrix

All ChangeSet and audit reads are pure: zero writes, repair, notification, or
backfill. Existing valid clean or dirty branches need no ChangeSet persistence,
migration, or backfill.

| Observed condition | ChangeSet read | Audit result | Mutation disposition | Recovery |
| --- | --- | --- | --- | --- |
| Valid clean or dirty state | Computed success | `valid` or cache warning | Use canonical delta | None required |
| Stored cache disagrees | Canonical content wins | `valid-with-warnings` | Target uses canonical content; legacy gate remains stored | Explicit cache-only repair after fresh valid audit |
| Invalid Head/Draft cardinality | Fail closed | `invalid` with bounded finding | `REVISION_CARDINALITY_INVALID` | Operator repairs topology from authoritative history |
| Invalid role or Draft parent topology | Fail closed | `invalid` with bounded finding | Zero-effect topology failure | Operator-guided repair; never implicit |
| Invalid Head schema, foreign key, formula definition, or file reference | Fail closed | `invalid` | `LEGACY_HEAD_INVALID` | Restore a known-valid immutable Head |
| Writable object reachable from immutable state | Fail closed | `invalid` | Zero-effect consistency failure | Operator isolates and repairs storage reachability |
| Irrecoverably invalid Draft | Fail closed | `invalid` | `DRAFT_STATE_INVALID` | Explicit Discard all only when its resulting Head state validates; otherwise operator repair |
| Active migration | Informational success | Status/finding reflects migration | Apply the migration matrix above | Finish, cancel, abort, or inspect migration explicitly |
| Unknown post-commit outcome | Re-read current state | `unknown` until correlated | No automatic retry | Correlate operation ID and operator logs |

No row authorizes implicit destructive repair.

## Normative v1 golden vectors

The following single strict-JSON block is the repository-owned mechanical
contract for v1 semantics. It does not assert runtime availability and contains
no future selector, plan, handle, or PDR-008 acceptance case. Every vector has
exactly the five fields `id`, `context`, `input`, `observable`, and `expected`;
every embedded collection is bounded.

Within this block, `context.current_or_null` is the actual computed
`ChangeSetCurrent` identity for the fixture state, not the caller's optional
precondition. It is non-null for every structurally valid Head/Draft topology,
including an empty ChangeSet and cache drift. It is null only when invalid
cardinality, role, or parent topology prevents a singleton projection.

```json
{
  "schema": "ve011-v1-doc-goldens-v1",
  "contextAxes": {
    "semantic_delta": [
      "empty",
      "dirty"
    ],
    "precondition": [
      "current",
      "version"
    ],
    "legacy_state": [
      "valid",
      "invalid"
    ],
    "migration": [
      "none",
      "pending",
      "copying",
      "swapping",
      "failed"
    ],
    "delivery": [
      "delivered",
      "not-configured",
      "failed"
    ],
    "cache_relation": [
      "in-sync-clean",
      "in-sync-dirty",
      "false-with-delta",
      "true-without-delta"
    ]
  },
  "contextCoverage": {
    "semantic_delta": {
      "empty": [
        "empty-delta"
      ],
      "dirty": [
        "created"
      ]
    },
    "precondition": {
      "current": [
        "changeset-explicit-current-mode-success"
      ],
      "version": [
        "changeset-changed-zero-effect"
      ]
    },
    "legacy_state": {
      "valid": [
        "commit-valid-full-snapshot"
      ],
      "invalid": [
        "invalid-head-zero-effect"
      ]
    },
    "migration": {
      "none": [
        "commit-valid-full-snapshot"
      ],
      "pending": [
        "migration-interaction-matrix"
      ],
      "copying": [
        "migration-interaction-matrix"
      ],
      "swapping": [
        "migration-interaction-matrix"
      ],
      "failed": [
        "migration-interaction-matrix"
      ]
    },
    "delivery": {
      "delivered": [
        "post-commit-delivery-delivered-and-not-configured"
      ],
      "not-configured": [
        "post-commit-delivery-delivered-and-not-configured"
      ],
      "failed": [
        "post-commit-delivery-failed-still-committed"
      ]
    },
    "cache_relation": {
      "in-sync-clean": [
        "audit-healthy-empty"
      ],
      "in-sync-dirty": [
        "audit-healthy-dirty"
      ],
      "false-with-delta": [
        "hasChanges-false-with-delta"
      ],
      "true-without-delta": [
        "audit-warning-empty-hasChanges-true"
      ]
    }
  },
  "vectors": [
    {
      "id": "empty-delta",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-empty",
          "version": "changeset-version-empty"
        }
      },
      "input": {
        "operation": "changeSet"
      },
      "observable": {
        "semanticItemCount": 0
      },
      "expected": {
        "changeSet": {
          "id": "changeset-empty",
          "version": "changeset-version-empty",
          "totalChanges": 0,
          "isEmpty": true,
          "tables": {
            "total": 0
          },
          "rows": {
            "total": 0
          },
          "sharedSchemas": {
            "total": 0
          }
        }
      }
    },
    {
      "id": "created",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "semanticFacts": [
          {
            "entity": "row",
            "before": null,
            "after": {
              "tableId": "products",
              "rowId": "p-1"
            }
          }
        ]
      },
      "observable": {
        "projector": "canonical-head-to-draft"
      },
      "expected": {
        "items": [
          {
            "entity": "row",
            "itemId": "item-created",
            "itemVersion": "item-version-created",
            "kind": "created"
          }
        ],
        "facetTotal": 1
      }
    },
    {
      "id": "modified",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "semanticFacts": [
          {
            "entity": "row",
            "before": {
              "tableId": "products",
              "rowId": "p-1",
              "content": "old"
            },
            "after": {
              "tableId": "products",
              "rowId": "p-1",
              "content": "new"
            }
          }
        ]
      },
      "observable": {
        "projector": "canonical-head-to-draft"
      },
      "expected": {
        "items": [
          {
            "entity": "row",
            "itemId": "item-modified",
            "itemVersion": "item-version-modified",
            "kind": "modified"
          }
        ],
        "facetTotal": 1
      }
    },
    {
      "id": "renamed",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "semanticFacts": [
          {
            "entity": "table",
            "before": {
              "tableId": "products"
            },
            "after": {
              "tableId": "catalog"
            }
          }
        ]
      },
      "observable": {
        "projector": "canonical-head-to-draft"
      },
      "expected": {
        "items": [
          {
            "entity": "table",
            "itemId": "item-renamed",
            "itemVersion": "item-version-renamed",
            "kind": "renamed"
          }
        ],
        "facetTotal": 1
      }
    },
    {
      "id": "deleted",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "semanticFacts": [
          {
            "entity": "row",
            "before": {
              "tableId": "products",
              "rowId": "p-1"
            },
            "after": null
          }
        ]
      },
      "observable": {
        "projector": "canonical-head-to-draft"
      },
      "expected": {
        "items": [
          {
            "entity": "row",
            "itemId": "item-deleted",
            "itemVersion": "item-version-deleted",
            "kind": "deleted"
          }
        ],
        "facetTotal": 1
      }
    },
    {
      "id": "renamed-and-modified-is-renamed",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "semanticFacts": [
          {
            "entity": "row",
            "before": {
              "tableId": "products",
              "rowId": "old",
              "content": "a"
            },
            "after": {
              "tableId": "products",
              "rowId": "new",
              "content": "b"
            }
          }
        ]
      },
      "observable": {
        "classification": "kind"
      },
      "expected": {
        "items": [
          {
            "itemId": "item-rename-modify",
            "kind": "renamed"
          }
        ],
        "modifiedCount": 0,
        "renamedCount": 1
      }
    },
    {
      "id": "repeated-edits-fold",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "edits": [
          {
            "itemId": "item-fold",
            "value": "a"
          },
          {
            "itemId": "item-fold",
            "value": "b"
          },
          {
            "itemId": "item-fold",
            "value": "c"
          }
        ]
      },
      "observable": {
        "projector": "canonical-head-to-draft"
      },
      "expected": {
        "items": [
          {
            "itemId": "item-fold",
            "kind": "modified",
            "afterValue": "c"
          }
        ],
        "totalChanges": 1
      }
    },
    {
      "id": "three-records-three-items",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "semanticFacts": [
          {
            "entity": "table",
            "tableId": "a"
          },
          {
            "entity": "row",
            "tableId": "a",
            "rowId": "1"
          },
          {
            "entity": "shared-schema",
            "sharedSchemaId": "common"
          }
        ]
      },
      "observable": {
        "facetCounts": true
      },
      "expected": {
        "itemIds": [
          "item-table-a",
          "item-row-a-1",
          "item-shared-common"
        ],
        "tables": 1,
        "rows": 1,
        "sharedSchemas": 1,
        "totalChanges": 3
      }
    },
    {
      "id": "created-then-deleted-vanishes",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "edits": [
          {
            "action": "create",
            "tableId": "products",
            "rowId": "temporary"
          },
          {
            "action": "delete",
            "tableId": "products",
            "rowId": "temporary"
          }
        ]
      },
      "observable": {
        "projector": "canonical-head-to-draft"
      },
      "expected": {
        "items": [],
        "totalChanges": 0
      }
    },
    {
      "id": "pure-physical-cow-no-public-change",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-empty",
          "version": "changeset-version-empty"
        }
      },
      "input": {
        "beforeSemantic": "same",
        "afterSemantic": "same",
        "physicalCopyOnWrite": true
      },
      "observable": {
        "publicProjection": true
      },
      "expected": {
        "items": [],
        "changeSetVersionBefore": "changeset-version-empty",
        "changeSetVersionAfter": "changeset-version-empty",
        "itemVersion": null
      }
    },
    {
      "id": "schema-row-coupled-projection",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "semanticFacts": [
          {
            "owner": "table",
            "fact": "schema"
          },
          {
            "owner": "table",
            "fact": "migration"
          },
          {
            "owner": "table",
            "fact": "views"
          }
        ]
      },
      "observable": {
        "publicFacets": true
      },
      "expected": {
        "items": [
          {
            "entity": "table",
            "itemId": "item-table-schema",
            "detailKinds": [
              "schema",
              "migration",
              "views"
            ]
          }
        ],
        "rawSystemItems": []
      }
    },
    {
      "id": "shared-schema-not-raw-system-duplicate",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "semanticFacts": [
          {
            "owner": "shared-schema",
            "fact": "definition"
          },
          {
            "owner": "shared-schema",
            "fact": "backing-row"
          }
        ]
      },
      "observable": {
        "publicFacets": true
      },
      "expected": {
        "items": [
          {
            "entity": "shared-schema",
            "itemId": "item-shared-schema",
            "sharedSchemaId": "common"
          }
        ],
        "rawSystemItems": [],
        "totalChanges": 1
      }
    },
    {
      "id": "hasChanges-false-with-delta",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "canonicalDelta": "dirty",
        "storedHasChanges": false
      },
      "observable": {
        "operation": "auditBranchConsistency"
      },
      "expected": {
        "changeSet": "dirty",
        "auditStatus": "valid-with-warnings",
        "cacheStatus": "false-with-delta",
        "writes": 0,
        "repairs": 0,
        "notificationAttempts": 0,
        "findingCodes": [
          "HAS_CHANGES_FALSE_WITH_DELTA"
        ]
      }
    },
    {
      "id": "hasChanges-true-without-delta",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-empty",
          "version": "changeset-version-empty"
        }
      },
      "input": {
        "canonicalDelta": "empty",
        "storedHasChanges": true
      },
      "observable": {
        "operation": "auditBranchConsistency"
      },
      "expected": {
        "changeSet": "empty",
        "auditStatus": "valid-with-warnings",
        "cacheStatus": "true-without-delta",
        "writes": 0,
        "repairs": 0,
        "notificationAttempts": 0
      }
    },
    {
      "id": "cursor-first-zero",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "connections": [
          "changeSetItems",
          "changeSetItemDetails",
          "auditBranchConsistencyFindings",
          "changeSetDiagnosticDetails"
        ],
        "first": 0
      },
      "observable": {
        "connections": [
          "changeSetItems",
          "changeSetItemDetails",
          "auditBranchConsistencyFindings",
          "changeSetDiagnosticDetails"
        ]
      },
      "expected": {
        "accepted": true,
        "edges": [],
        "edgeLimit": 0,
        "pageInfoTruthful": true
      }
    },
    {
      "id": "cursor-first-one-hundred",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "connections": [
          "changeSetItems",
          "changeSetItemDetails",
          "auditBranchConsistencyFindings",
          "changeSetDiagnosticDetails"
        ],
        "first": 100
      },
      "observable": {
        "connections": [
          "changeSetItems",
          "changeSetItemDetails",
          "auditBranchConsistencyFindings",
          "changeSetDiagnosticDetails"
        ]
      },
      "expected": {
        "accepted": true,
        "maximumEdges": 100,
        "pageInfoTruthful": true
      }
    },
    {
      "id": "cursor-first-minus-one-rejected",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "connections": [
          "changeSetItems",
          "changeSetItemDetails",
          "auditBranchConsistencyFindings",
          "changeSetDiagnosticDetails"
        ],
        "first": -1
      },
      "observable": {
        "connections": [
          "changeSetItems",
          "changeSetItemDetails",
          "auditBranchConsistencyFindings",
          "changeSetDiagnosticDetails"
        ]
      },
      "expected": {
        "code": "CHANGESET_INVALID_INPUT",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "cursor-first-one-hundred-one-rejected",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "connections": [
          "changeSetItems",
          "changeSetItemDetails",
          "auditBranchConsistencyFindings",
          "changeSetDiagnosticDetails"
        ],
        "first": 101
      },
      "observable": {
        "connections": [
          "changeSetItems",
          "changeSetItemDetails",
          "auditBranchConsistencyFindings",
          "changeSetDiagnosticDetails"
        ]
      },
      "expected": {
        "code": "CHANGESET_INVALID_INPUT",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "stale-cursor-rejected",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "connections": [
          "changeSetItems",
          "changeSetItemDetails",
          "auditBranchConsistencyFindings",
          "changeSetDiagnosticDetails"
        ],
        "first": 20,
        "after": "opaque-stale-cursor"
      },
      "observable": {
        "connections": [
          "changeSetItems",
          "changeSetItemDetails",
          "auditBranchConsistencyFindings",
          "changeSetDiagnosticDetails"
        ]
      },
      "expected": {
        "code": "CHANGESET_INVALID_CURSOR",
        "reason": "STALE",
        "distinctFrom": "QUERY_MISMATCH",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "cross-query-cursor-rejected",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "connections": [
          "changeSetItems",
          "changeSetItemDetails",
          "auditBranchConsistencyFindings",
          "changeSetDiagnosticDetails"
        ],
        "first": 20,
        "after": "opaque-other-query-cursor"
      },
      "observable": {
        "connections": [
          "changeSetItems",
          "changeSetItemDetails",
          "auditBranchConsistencyFindings",
          "changeSetDiagnosticDetails"
        ]
      },
      "expected": {
        "code": "CHANGESET_INVALID_CURSOR",
        "reason": "QUERY_MISMATCH",
        "distinctFrom": "STALE",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "changeset-not-current-zero-effect",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "discardChangeSet",
        "precondition": {
          "mode": "version",
          "current": {
            "id": "changeset-old",
            "version": "changeset-version-1"
          }
        },
        "selection": {
          "scope": "all"
        }
      },
      "observable": {
        "checkedBeforeMutation": true
      },
      "expected": {
        "code": "CHANGESET_NOT_CURRENT",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "changeset-changed-zero-effect",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "commitChangeSet",
        "precondition": {
          "mode": "version",
          "current": {
            "id": "changeset-alpha",
            "version": "changeset-version-1"
          }
        },
        "selection": {
          "scope": "all"
        }
      },
      "observable": {
        "checkedBeforeMutation": true
      },
      "expected": {
        "code": "CHANGESET_CHANGED",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "changeset-item-changed-zero-effect",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "discardChangeSet",
        "selection": {
          "scope": "item",
          "itemId": "item-modified",
          "itemVersion": "item-version-old"
        }
      },
      "observable": {
        "checkedBeforeMutation": true
      },
      "expected": {
        "code": "CHANGESET_ITEM_CHANGED",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "discard-created",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "discardChangeSet",
        "selection": {
          "scope": "item",
          "itemId": "item-created"
        }
      },
      "observable": {
        "resultingDraftValidation": "valid"
      },
      "expected": {
        "success": true,
        "committed": true,
        "operation": "discard-item",
        "remainingItemIds": [],
        "draftRevisionId": "rev-draft-1",
        "changeSetId": "changeset-alpha"
      }
    },
    {
      "id": "discard-modified",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "discardChangeSet",
        "selection": {
          "scope": "item",
          "itemId": "item-modified"
        }
      },
      "observable": {
        "resultingDraftValidation": "valid"
      },
      "expected": {
        "success": true,
        "committed": true,
        "restored": "head-value",
        "remainingItemIds": []
      }
    },
    {
      "id": "discard-renamed",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "discardChangeSet",
        "selection": {
          "scope": "item",
          "itemId": "item-renamed"
        }
      },
      "observable": {
        "resultingDraftValidation": "valid"
      },
      "expected": {
        "success": true,
        "committed": true,
        "restoredExternalId": "products",
        "remainingItemIds": []
      }
    },
    {
      "id": "discard-deleted",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "discardChangeSet",
        "selection": {
          "scope": "item",
          "itemId": "item-deleted"
        }
      },
      "observable": {
        "resultingDraftValidation": "valid"
      },
      "expected": {
        "success": true,
        "committed": true,
        "restoredEntity": true,
        "remainingItemIds": []
      }
    },
    {
      "id": "discard-dangling-fk-zero-effect",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "discardChangeSet",
        "selection": {
          "scope": "item",
          "itemId": "item-required-target"
        }
      },
      "observable": {
        "resultingDraftValidation": "invalid-foreign-key"
      },
      "expected": {
        "code": "DRAFT_STATE_INVALID",
        "diagnostic": {
          "diagnosticId": "diagnostic-fk",
          "count": 1,
          "hash": "finding-set-fk",
          "preview": [
            {
              "code": "FOREIGN_KEY_TARGET_MISSING"
            }
          ],
          "truncated": false
        },
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0,
        "previewIsCanonicalPrefix": true
      }
    },
    {
      "id": "discard-formula-reference-zero-effect",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "discardChangeSet",
        "selection": {
          "scope": "item",
          "itemId": "item-formula-target"
        }
      },
      "observable": {
        "resultingDraftValidation": "invalid-formula-reference"
      },
      "expected": {
        "code": "DRAFT_STATE_INVALID",
        "diagnostic": {
          "diagnosticId": "diagnostic-formula",
          "count": 1,
          "hash": "finding-set-formula",
          "preview": [
            {
              "code": "FORMULA_REFERENCE_MISSING"
            }
          ],
          "truncated": false
        },
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0,
        "previewIsCanonicalPrefix": true
      }
    },
    {
      "id": "invalid-head-zero-effect",
      "context": {
        "projectId": "project-invalid",
        "branchName": "broken",
        "headRevisionId": "rev-head-invalid",
        "draftRevisionId": "rev-draft-invalid",
        "current_or_null": {
          "id": "changeset-invalid-head",
          "version": "changeset-version-invalid-head"
        }
      },
      "input": {
        "operation": "commitChangeSet",
        "selection": {
          "scope": "all"
        }
      },
      "observable": {
        "headValidation": "invalid"
      },
      "expected": {
        "code": "LEGACY_HEAD_INVALID",
        "diagnostic": {
          "diagnosticId": "diagnostic-head",
          "count": 1,
          "hash": "finding-set-head",
          "preview": [
            {
              "code": "HEAD_SCHEMA_INVALID"
            }
          ],
          "truncated": false
        },
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0,
        "previewIsCanonicalPrefix": true
      }
    },
    {
      "id": "commit-valid-full-snapshot",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "commitChangeSet",
        "selection": {
          "scope": "all"
        }
      },
      "observable": {
        "candidateValidation": "valid"
      },
      "expected": {
        "committed": true,
        "stateEffect": "committed",
        "revisionSnapshot": "complete-draft",
        "deltaOnly": false,
        "previousHeadRevisionId": "rev-head-1",
        "committedRevisionId": "rev-draft-1",
        "nextDraftRevisionId": "rev-draft-2",
        "validatorDomainRows": [
          {
            "domain": "schema-and-meta-schema",
            "schema": "valid",
            "metaSchema": "valid"
          },
          {
            "domain": "shared-schema",
            "status": "valid"
          },
          {
            "domain": "rows",
            "status": "valid"
          },
          {
            "domain": "foreign-keys",
            "status": "valid"
          },
          {
            "domain": "formula-definitions",
            "status": "valid"
          },
          {
            "domain": "folded-system-state",
            "status": "valid"
          },
          {
            "domain": "live-file-references",
            "status": "valid"
          }
        ]
      }
    },
    {
      "id": "formula-definition-invalid-zero-effect",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "commitChangeSet",
        "formulaDefinition": {
          "syntax": "invalid"
        }
      },
      "observable": {
        "validatorDomain": "formula-definition"
      },
      "expected": {
        "code": "DRAFT_STATE_INVALID",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "formula-runtime-value-not-a-gate",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "commitChangeSet",
        "formulaDefinition": {
          "syntax": "valid",
          "references": "valid",
          "cycles": "none"
        },
        "runtimeValueDifference": true
      },
      "observable": {
        "validatorDomain": "formula-definition"
      },
      "expected": {
        "blocked": false,
        "committed": true,
        "stateEffect": "committed"
      }
    },
    {
      "id": "post-commit-delivery-failed-still-committed",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "commitChangeSet",
        "deliveryProvider": "fails"
      },
      "observable": {
        "deliveryAttempt": true
      },
      "expected": {
        "committed": true,
        "stateEffect": "committed",
        "notificationAttempts": 1,
        "delivery": {
          "status": "failed",
          "revisionId": "rev-draft-1",
          "code": "POST_COMMIT_DELIVERY_FAILED"
        },
        "rollback": false
      }
    },
    {
      "id": "post-commit-connection-outcome-unknown",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "commitChangeSet",
        "connectionLostAfterCommitDecision": true
      },
      "observable": {
        "transactionDecision": "unobservable-to-client"
      },
      "expected": {
        "code": "CHANGESET_OUTCOME_UNKNOWN",
        "committed": "unknown",
        "stateEffect": "unknown",
        "notificationAttempts": "unknown",
        "automaticRetry": false,
        "recovery": "AUDIT_BRANCH",
        "operationId": "operation-opaque-1"
      }
    },
    {
      "id": "audit-healthy-empty",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-empty",
          "version": "changeset-version-empty"
        }
      },
      "input": {
        "operation": "auditBranchConsistency",
        "canonicalDelta": "empty",
        "storedHasChanges": false
      },
      "observable": {
        "auditSnapshot": "repeatable"
      },
      "expected": {
        "status": "valid",
        "stateStatus": "valid",
        "cacheStatus": "in-sync",
        "findingCount": 0,
        "writes": 0,
        "repairs": 0,
        "notificationAttempts": 0
      }
    },
    {
      "id": "audit-warning-empty-hasChanges-true",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-empty",
          "version": "changeset-version-empty"
        }
      },
      "input": {
        "operation": "auditBranchConsistency",
        "canonicalDelta": "empty",
        "storedHasChanges": true
      },
      "observable": {
        "auditSnapshot": "repeatable"
      },
      "expected": {
        "status": "valid-with-warnings",
        "stateStatus": "valid",
        "cacheStatus": "true-without-delta",
        "findingCodes": [
          "HAS_CHANGES_TRUE_WITHOUT_DELTA"
        ],
        "writes": 0,
        "repairs": 0,
        "notificationAttempts": 0
      }
    },
    {
      "id": "audit-findings-empty-page",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-empty",
          "version": "changeset-version-empty"
        }
      },
      "input": {
        "operation": "auditBranchConsistencyFindings",
        "auditId": "audit-healthy",
        "first": 20
      },
      "observable": {
        "immutableFindingSet": true
      },
      "expected": {
        "totalCount": 0,
        "edges": [],
        "pageInfo": {
          "startCursor": null,
          "endCursor": null,
          "hasNextPage": false,
          "hasPreviousPage": false
        }
      }
    },
    {
      "id": "audit-findings-large-page",
      "context": {
        "projectId": "project-invalid",
        "branchName": "broken",
        "headRevisionId": "rev-head-invalid",
        "draftRevisionId": "rev-draft-invalid",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "auditBranchConsistency",
        "findingCount": 121
      },
      "observable": {
        "boundedSummary": true
      },
      "expected": {
        "auditId": "audit-large",
        "findings": {
          "count": 121,
          "hash": "audit-findings-large",
          "previewCount": 20,
          "truncated": true
        },
        "pageRoute": {
          "operation": "auditBranchConsistencyFindings",
          "firstMaximum": 100
        },
        "unboundedFindingsArray": false,
        "previewIsCanonicalPrefix": true
      }
    },
    {
      "id": "validation-diagnostic-large-page",
      "context": {
        "projectId": "project-invalid",
        "branchName": "broken",
        "headRevisionId": "rev-head-invalid",
        "draftRevisionId": "rev-draft-invalid",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "commitChangeSet",
        "validationFindingCount": 121
      },
      "observable": {
        "boundedDiagnostic": true
      },
      "expected": {
        "code": "DRAFT_STATE_INVALID",
        "diagnostic": {
          "diagnosticId": "diagnostic-large",
          "count": 121,
          "hash": "diagnostic-findings-large",
          "previewCount": 20,
          "truncated": true
        },
        "pageRoute": {
          "operation": "changeSetDiagnosticDetails",
          "firstMaximum": 100
        },
        "unboundedFindingsArray": false,
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0,
        "previewIsCanonicalPrefix": true
      }
    },
    {
      "id": "empty-read-summary",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-empty",
          "version": "changeset-version-empty"
        }
      },
      "input": {
        "operation": "changeSet"
      },
      "observable": {
        "canonicalDelta": "empty"
      },
      "expected": {
        "success": true,
        "isEmpty": true,
        "totalChanges": 0,
        "tables": 0,
        "rows": 0,
        "sharedSchemas": 0
      }
    },
    {
      "id": "empty-items-connection",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-empty",
          "version": "changeset-version-empty"
        }
      },
      "input": {
        "operation": "changeSetItems",
        "itemScope": {
          "scope": "all"
        },
        "first": 20
      },
      "observable": {
        "canonicalDelta": "empty"
      },
      "expected": {
        "success": true,
        "totalCount": 0,
        "edges": [],
        "pageInfo": {
          "startCursor": null,
          "endCursor": null,
          "hasNextPage": false,
          "hasPreviousPage": false
        }
      }
    },
    {
      "id": "empty-item-details",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-empty",
          "version": "changeset-version-empty"
        }
      },
      "input": {
        "operation": "changeSetItemDetails",
        "itemId": "item-absent",
        "first": 20
      },
      "observable": {
        "canonicalDelta": "empty"
      },
      "expected": {
        "code": "CHANGESET_ITEM_NOT_FOUND",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "empty-discard-item",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-empty",
          "version": "changeset-version-empty"
        }
      },
      "input": {
        "operation": "discardChangeSet",
        "selection": {
          "scope": "item",
          "itemId": "item-absent"
        }
      },
      "observable": {
        "canonicalDelta": "empty"
      },
      "expected": {
        "code": "CHANGESET_ITEM_NOT_FOUND",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "empty-discard-all",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-empty",
          "version": "changeset-version-empty"
        }
      },
      "input": {
        "operation": "discardChangeSet",
        "selection": {
          "scope": "all"
        }
      },
      "observable": {
        "canonicalDelta": "empty"
      },
      "expected": {
        "code": "CHANGESET_EMPTY",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "empty-commit",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-empty",
          "version": "changeset-version-empty"
        }
      },
      "input": {
        "operation": "commitChangeSet",
        "selection": {
          "scope": "all"
        }
      },
      "observable": {
        "canonicalDelta": "empty"
      },
      "expected": {
        "code": "CHANGESET_EMPTY",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "legacy-stored-false-dirty-createRevision-no-changes",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "createRevision",
        "storedHasChanges": false,
        "canonicalDelta": "dirty"
      },
      "observable": {
        "gate": "stored-Draft.hasChanges"
      },
      "expected": {
        "error": "There are no changes",
        "legacyEnvelope": true,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "legacy-stored-false-dirty-revertChanges-no-changes",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "revertChanges",
        "storedHasChanges": false,
        "canonicalDelta": "dirty"
      },
      "observable": {
        "gate": "stored-Draft.hasChanges"
      },
      "expected": {
        "error": "There are no changes",
        "legacyEnvelope": true,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "legacy-stored-true-empty-createRevision-pinned-path-success",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-empty",
          "version": "changeset-version-empty"
        }
      },
      "input": {
        "operation": "createRevision",
        "storedHasChanges": true,
        "canonicalDelta": "empty",
        "request": {
          "projectId": "project-alpha",
          "branchName": "main",
          "comment": "snapshot"
        }
      },
      "observable": {
        "gate": "stored-Draft.hasChanges"
      },
      "expected": {
        "pinnedPathProceeds": true,
        "successProjection": "complete Revision plus previousHeadRevisionId and previousDraftRevisionId",
        "newTargetMutationWouldBe": "CHANGESET_EMPTY"
      }
    },
    {
      "id": "legacy-stored-true-empty-revertChanges-pinned-path-success",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-empty",
          "version": "changeset-version-empty"
        }
      },
      "input": {
        "operation": "revertChanges",
        "storedHasChanges": true,
        "canonicalDelta": "empty",
        "request": {
          "projectId": "project-alpha",
          "branchName": "main"
        }
      },
      "observable": {
        "gate": "stored-Draft.hasChanges"
      },
      "expected": {
        "pinnedPathProceeds": true,
        "successProjection": "complete Branch",
        "newTargetMutationWouldBe": "CHANGESET_EMPTY"
      }
    },
    {
      "id": "validator-domain-witness-matrix",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "totalConsistencyValidator",
        "cases": [
          {
            "domain": "schema",
            "witness": "valid",
            "validation": "valid"
          },
          {
            "domain": "schema",
            "witness": "failing",
            "validation": "invalid",
            "issueClass": "SCHEMA",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "domain": "meta-schema",
            "witness": "valid",
            "validation": "valid"
          },
          {
            "domain": "meta-schema",
            "witness": "failing",
            "validation": "invalid",
            "issueClass": "SCHEMA",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "domain": "shared-schema",
            "witness": "valid",
            "validation": "valid"
          },
          {
            "domain": "shared-schema",
            "witness": "failing",
            "validation": "invalid",
            "issueClass": "SHARED_SCHEMA",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "domain": "rows",
            "witness": "valid",
            "validation": "valid"
          },
          {
            "domain": "rows",
            "witness": "failing",
            "validation": "invalid",
            "issueClass": "SCHEMA",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "domain": "foreign-keys",
            "witness": "valid",
            "validation": "valid"
          },
          {
            "domain": "foreign-keys",
            "witness": "failing",
            "validation": "invalid",
            "issueClass": "FK",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "domain": "formula-definitions",
            "witness": "valid",
            "validation": "valid"
          },
          {
            "domain": "formula-definitions",
            "witness": "failing",
            "validation": "invalid",
            "issueClass": "FORMULA",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "domain": "folded-system-state",
            "witness": "valid",
            "validation": "valid"
          },
          {
            "domain": "folded-system-state",
            "witness": "failing",
            "validation": "invalid",
            "issueClass": "VALIDATION",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "domain": "live-file-references",
            "witness": "valid",
            "validation": "valid"
          },
          {
            "domain": "live-file-references",
            "witness": "failing",
            "validation": "invalid",
            "issueClass": "FILE_REFERENCE",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          }
        ]
      },
      "observable": {
        "caseCount": 16,
        "domains": [
          "schema",
          "meta-schema",
          "shared-schema",
          "rows",
          "foreign-keys",
          "formula-definitions",
          "folded-system-state",
          "live-file-references"
        ]
      },
      "expected": {
        "allDomainsHaveValidAndFailingWitness": true,
        "failingCasesAreZeroEffect": true,
        "maximumCases": 16
      }
    },
    {
      "id": "discard-all-nonempty-valid",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "discardChangeSet",
        "selection": {
          "scope": "all"
        },
        "canonicalDelta": "dirty"
      },
      "observable": {
        "headValidation": "valid",
        "resultingDraftValidation": "valid"
      },
      "expected": {
        "committed": true,
        "stateEffect": "committed",
        "notificationAttempts": 1,
        "operation": "discard-all",
        "draftRevisionId": "rev-draft-1",
        "changeSetId": "changeset-alpha",
        "restoredExactHeadAssociations": true
      }
    },
    {
      "id": "discard-all-invalid-head-zero-effect",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "discardChangeSet",
        "selection": {
          "scope": "all"
        },
        "canonicalDelta": "dirty"
      },
      "observable": {
        "headValidation": "invalid"
      },
      "expected": {
        "code": "LEGACY_HEAD_INVALID",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "migration-interaction-matrix",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "cases": [
          {
            "operation": "discard-item",
            "status": "PENDING",
            "outcome": "MIGRATION_LOCKED"
          },
          {
            "operation": "discard-item",
            "status": "COPYING",
            "outcome": "MIGRATION_LOCKED"
          },
          {
            "operation": "discard-item",
            "status": "SWAPPING",
            "outcome": "MIGRATION_LOCKED"
          },
          {
            "operation": "commit",
            "status": "PENDING",
            "outcome": "MIGRATION_LOCKED"
          },
          {
            "operation": "commit",
            "status": "COPYING",
            "outcome": "MIGRATION_LOCKED"
          },
          {
            "operation": "commit",
            "status": "SWAPPING",
            "outcome": "MIGRATION_LOCKED"
          },
          {
            "operation": "discard-all",
            "status": "PENDING",
            "outcome": "cancel-and-discard"
          },
          {
            "operation": "discard-all",
            "status": "COPYING",
            "outcome": "cancel-and-discard"
          },
          {
            "operation": "discard-all",
            "status": "SWAPPING",
            "outcome": "MIGRATION_LOCKED"
          },
          {
            "operation": "discard-all",
            "status": "FAILED",
            "outcome": "inactive-proceed"
          }
        ]
      },
      "observable": {
        "caseCount": 10
      },
      "expected": {
        "cases": [
          {
            "operation": "discard-item",
            "status": "PENDING",
            "code": "MIGRATION_LOCKED",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "operation": "discard-item",
            "status": "COPYING",
            "code": "MIGRATION_LOCKED",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "operation": "discard-item",
            "status": "SWAPPING",
            "code": "MIGRATION_LOCKED",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "operation": "commit",
            "status": "PENDING",
            "code": "MIGRATION_LOCKED",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "operation": "commit",
            "status": "COPYING",
            "code": "MIGRATION_LOCKED",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "operation": "commit",
            "status": "SWAPPING",
            "code": "MIGRATION_LOCKED",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "operation": "discard-all",
            "status": "PENDING",
            "committed": true,
            "stateEffect": "cancelled-migration-and-discarded",
            "notificationAttempts": 1
          },
          {
            "operation": "discard-all",
            "status": "COPYING",
            "committed": true,
            "stateEffect": "cancelled-migration-and-discarded",
            "notificationAttempts": 1
          },
          {
            "operation": "discard-all",
            "status": "SWAPPING",
            "code": "MIGRATION_LOCKED",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "operation": "discard-all",
            "status": "FAILED",
            "activeMigration": false,
            "mayProceed": true
          }
        ],
        "maximumCases": 10
      }
    },
    {
      "id": "post-commit-delivery-delivered-and-not-configured",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "commitChangeSet",
        "cases": [
          {
            "delivery": "delivered"
          },
          {
            "delivery": "not-configured"
          }
        ]
      },
      "observable": {
        "caseCount": 2
      },
      "expected": {
        "cases": [
          {
            "delivery": "delivered",
            "committed": true,
            "stateEffect": "committed",
            "notificationAttempts": 1
          },
          {
            "delivery": "not-configured",
            "committed": true,
            "stateEffect": "committed",
            "notificationAttempts": 0
          }
        ],
        "maximumCases": 2
      }
    },
    {
      "id": "audit-healthy-dirty",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "auditBranchConsistency",
        "canonicalDelta": "dirty",
        "storedHasChanges": true
      },
      "observable": {
        "auditSnapshot": "repeatable"
      },
      "expected": {
        "status": "valid",
        "stateStatus": "valid",
        "cacheStatus": "in-sync",
        "findingCount": 0,
        "writes": 0,
        "repairs": 0,
        "notificationAttempts": 0
      }
    },
    {
      "id": "changeset-explicit-current-mode-success",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "changeSet",
        "precondition": {
          "mode": "current"
        }
      },
      "observable": {
        "resolution": "locked-current-singleton"
      },
      "expected": {
        "success": true,
        "priorChangeSetReadRequired": false,
        "current": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        },
        "isEmpty": false
      }
    },
    {
      "id": "query-filter-search-matrix",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "cases": [
          {
            "query": "changeSetItems",
            "itemScope": {
              "scope": "entity",
              "entity": "row"
            }
          },
          {
            "query": "changeSetItems",
            "itemScope": {
              "scope": "rows-in-table",
              "tableId": "products"
            }
          },
          {
            "query": "changeSetItems",
            "itemScope": {
              "scope": "all"
            },
            "kinds": [
              "renamed"
            ]
          },
          {
            "query": "changeSetItems",
            "itemScope": {
              "scope": "all"
            },
            "search": "old-products"
          },
          {
            "query": "changeSetItems",
            "itemScope": {
              "scope": "all"
            },
            "search": "new-products"
          },
          {
            "query": "changeSetItems",
            "itemScope": {
              "scope": "all"
            },
            "search": "NEW-PRODUCTS"
          },
          {
            "query": "changeSetItems",
            "itemScope": {
              "scope": "all"
            },
            "search": "   "
          },
          {
            "query": "auditBranchConsistencyFindings",
            "severities": [
              "error"
            ]
          },
          {
            "query": "changeSetItems",
            "itemScope": {
              "scope": "all"
            },
            "kinds": []
          },
          {
            "query": "changeSetItems",
            "itemScope": {
              "scope": "all"
            },
            "kinds": [
              "renamed",
              "renamed"
            ]
          },
          {
            "query": "changeSetItems",
            "itemScope": {
              "scope": "unknown"
            }
          }
        ]
      },
      "observable": {
        "caseCount": 11
      },
      "expected": {
        "cases": [
          {
            "case": "entity-scope",
            "filteredTotal": 3
          },
          {
            "case": "rows-in-table-scope",
            "filteredTotal": 2
          },
          {
            "case": "renamed-kind",
            "filteredTotal": 1
          },
          {
            "case": "before-id-search",
            "filteredTotal": 1
          },
          {
            "case": "after-id-search",
            "filteredTotal": 1
          },
          {
            "case": "case-sensitive-no-match",
            "filteredTotal": 0
          },
          {
            "case": "normalized-empty-search",
            "normalizedAs": "absent"
          },
          {
            "case": "audit-severity-filter",
            "filteredTotal": 2
          },
          {
            "case": "empty-kinds",
            "code": "CHANGESET_INVALID_INPUT",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "case": "duplicate-kinds",
            "code": "CHANGESET_INVALID_INPUT",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "case": "unknown-scope",
            "code": "CHANGESET_INVALID_INPUT",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          }
        ],
        "filteredFields": [
          "connection.totalCount",
          "connection.edges",
          "connection.pageInfo"
        ],
        "unfilteredFields": [
          "changeSet.id",
          "changeSet.version",
          "changeSet.isEmpty",
          "changeSet.facets",
          "commitEligibility"
        ],
        "maximumCases": 11
      }
    },
    {
      "id": "target-outcome-row-census",
      "context": {
        "projectId": "project-alpha",
        "branchName": "main",
        "headRevisionId": "rev-head-1",
        "draftRevisionId": "rev-draft-1",
        "current_or_null": {
          "id": "changeset-alpha",
          "version": "changeset-version-2"
        }
      },
      "input": {
        "operation": "targetOutcomeContract",
        "rows": [
          "CHANGESET_INVALID_INPUT",
          "CHANGESET_INVALID_CURSOR",
          "DRAFT_STATE_INVALID",
          "CHANGESET_BRANCH_NOT_FOUND",
          "CHANGESET_ITEM_NOT_FOUND",
          "AUDIT_NOT_FOUND",
          "CHANGESET_DIAGNOSTIC_NOT_FOUND",
          "CHANGESET_NOT_CURRENT",
          "CHANGESET_CHANGED",
          "CHANGESET_ITEM_CHANGED",
          "CHANGESET_EMPTY",
          "REVISION_CARDINALITY_INVALID",
          "LEGACY_HEAD_INVALID",
          "MIGRATION_LOCKED",
          "CHANGESET_TRANSACTION_ABORTED",
          "CHANGESET_OUTCOME_UNKNOWN",
          "delivery:delivered",
          "delivery:not-configured",
          "delivery:failed"
        ]
      },
      "observable": {
        "rowCount": 19
      },
      "expected": {
        "cases": [
          {
            "code": "CHANGESET_INVALID_INPUT",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "code": "CHANGESET_INVALID_CURSOR",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "code": "DRAFT_STATE_INVALID",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "code": "CHANGESET_BRANCH_NOT_FOUND",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "code": "CHANGESET_ITEM_NOT_FOUND",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "code": "AUDIT_NOT_FOUND",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "code": "CHANGESET_DIAGNOSTIC_NOT_FOUND",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "code": "CHANGESET_NOT_CURRENT",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "code": "CHANGESET_CHANGED",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "code": "CHANGESET_ITEM_CHANGED",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "code": "CHANGESET_EMPTY",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "code": "REVISION_CARDINALITY_INVALID",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "code": "LEGACY_HEAD_INVALID",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "code": "MIGRATION_LOCKED",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "code": "CHANGESET_TRANSACTION_ABORTED",
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "code": "CHANGESET_OUTCOME_UNKNOWN",
            "committed": "unknown",
            "stateEffect": "unknown",
            "notificationAttempts": "unknown"
          },
          {
            "code": "delivery:delivered",
            "committed": true,
            "stateEffect": "committed",
            "notificationAttempts": 1
          },
          {
            "code": "delivery:not-configured",
            "committed": true,
            "stateEffect": "committed",
            "notificationAttempts": 0
          },
          {
            "code": "delivery:failed",
            "committed": true,
            "stateEffect": "committed",
            "notificationAttempts": 1
          }
        ],
        "maximumCases": 20
      }
    }
  ]
}
```
