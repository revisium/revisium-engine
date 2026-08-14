> Status: non-normative future design; PDR-008 is not accepted; no runtime API.

# Partial Commit Design

This document describes a possible future partial-commit protocol. It is not a
VE-011 v1 requirement, does not accept PDR-008, and does not add package types,
exports, stubs, handlers, or callable methods. Normative v1 ChangeSet types and
shared consistency rules live in
[Consistency and ChangeSet Contract](../consistency.md).

Capitalized requirement words in this document describe internal consistency
of the proposal only; they do not bind the current runtime.

## Design objective

The future protocol separates five concepts:

1. requested selector realization;
2. deterministic required dependency closure;
3. the candidate committed state;
4. items excluded from that candidate; and
5. the freshly classified remainder after the candidate commit.

It plans before it mutates. Planning and every preview are read-only. Commit
accepts an opaque authoritative handle and an accepted closure hash; it never
accepts a dependency array or trusts an echoed summary.

## Shared target types

`BranchRef`, `ChangeSetPrecondition`, `ChangeSetCurrent`, `ChangeSetItemRef`,
`ChangeSet`, `Branch`, `Delivery`, `Edge`, and `PageInfo` have the exact meanings
defined by the [normative target documentation schema](../consistency.md#target-documentation-schema).
All IDs, versions, hashes, handles, and cursors are opaque echo-only strings.
No algorithm, preimage, encoding, prefix, or parsing behavior is public.

## Selector grammar

The proposal has exactly seven selector scopes and no generic `groups`
selector.

```typescript
type CommitMode = 'strict' | 'expand';

type CommitSelector =
  | { scope: 'all' }
  | { scope: 'table-change'; tableId: string }
  | { scope: 'table-all-changes'; tableId: string }
  | {
      scope: 'tables-all-changes';
      tableIds: string[]; // 1..100 unique ordinary table IDs
    }
  | { scope: 'row'; tableId: string; rowId: string }
  | {
      scope: 'rows';
      rows: Array<{ tableId: string; rowId: string }>; // 1..100 unique pairs
    }
  | {
      scope: 'items';
      items: Array<{ itemId: string; itemVersion: string }>; // 1..100 unique pairs
    };
```

Ordinary table-scoped selectors resolve in two stages. First, collect logical
table identities from table and row semantic items whose before- or after-side
external `tableId` matches the requested value, then deduplicate by internal
logical table identity. Internal identities never enter a public DTO. Zero
logical tables returns `COMMIT_PLAN_SELECTION_NOT_FOUND`; more than one returns
`COMMIT_PLAN_SELECTION_AMBIGUOUS`; exactly one establishes the table group.

After the unique group is resolved, `table-change` selects its table item and
returns not-found when the group has no table item. `table-all-changes` selects
the optional table item plus every row item in that one logical table. Multiple
rows are expected and never create ambiguity. `tables-all-changes` resolves
each input ID independently and atomically before deduplicating the union.

Row selectors first resolve one logical table by the same rule, then resolve
the before- or after-side ordinary `rowId` to one logical row within that table.
Zero rows is not-found and more than one is ambiguous. `rows` applies the rule
to every pair atomically. `items` bypasses ordinary-ID ambiguity but requires
every opaque item/version pair to match. A rename's two external IDs resolve
the same logical identity, a deletion resolves by its before ID, and
delete/create ID reuse resolves multiple logical identities and is ambiguous.
Ambiguity responses never return an unbounded candidate list; callers page
bounded ChangeSet items and retry with opaque item/version pairs.

Selector realization occurs before dependency closure and is atomic:

| Scope | Exact realization | Empty, missing, ambiguity, and item-CAS behavior |
| --- | --- | --- |
| `all` | All current semantic ChangeSet items | Canonical empty returns a successful blocked plan with one bounded `CHANGESET_EMPTY` issue |
| `table-change` | Resolve one logical table, then select its table item | Missing logical table or table item: `COMMIT_PLAN_SELECTION_NOT_FOUND`; multiple logical tables: `COMMIT_PLAN_SELECTION_AMBIGUOUS` |
| `table-all-changes` | Resolve one logical table, then select its optional table item and all row items | The resolved group must contribute at least one item; multiple rows are expected, while zero or multiple logical tables reject the selection |
| `tables-all-changes` | Resolve every logical table independently, then deduplicate their `table-all-changes` union | Every ID must resolve one contributing table group; one miss or ambiguity rejects the whole request |
| `row` | Resolve one logical table, then exactly one logical row by before or after `rowId` | Missing or multiple logical tables/rows reject the whole request |
| `rows` | Deduplicated union for 1..100 unique ordinary pairs | Any missing or ambiguous pair rejects the whole request; there is no partial plan |
| `items` | Exact 1..100 unique opaque `(itemId,itemVersion)` pairs | Any missing item or item-version mismatch rejects the whole request; there is no partial plan |

A schema or table item does not implicitly select or require every row. Only a
documented `*-all-changes` selector includes the table's row items during
selector realization. Dependency closure then adds only whole logical items
needed to make both complete resulting states valid.

## Candidate, remainder, and closure

Let `H` be the old Head, `D` the old Draft, `C` the candidate committed state,
and `R` the new remaining Draft after `C` becomes Head.

- `selected` is the exact selector realization.
- `required` is deterministic dependency closure minus `selected`.
- In `strict` mode, nonempty `required` blocks and candidate contains only the
  selected set for explanation.
- In `expand` mode, candidate is the deduplicated union of selected and
  required.
- `excluded` is the old ChangeSet items outside candidate.
- `remainder` is freshly classified from `C` to `R`; its kinds and item
  versions need not equal the old excluded items.

The candidate and remainder deltas partition the old `H`-to-`D` semantic
effects without loss or duplication. `R` is semantically equal to old `D`, but
that equality alone does not establish validity. Planning always computes both
`candidateValidation` and `remainderValidation`.

A plan is `blocked` exactly when at least one of these conditions holds:

- `all` realizes an empty canonical ChangeSet;
- strict mode has a nonempty required closure;
- candidate validation is invalid;
- remainder validation is invalid; or
- the canonical blocking issue set is nonempty.

A plan is `ready` only when none holds. A blocked plan is read-only explanatory
output and may report either validation as invalid. Only a ready handle may
reach Commit, and Commit revalidates both complete states. Physical
copy-on-write representation may differ. Full `{scope:'all'}` is exactly v1
full Commit.

Strict mode reports required closure without inclusion. Expand mode previews
the closure, but nothing is included silently at Commit. When `required` is
nonempty, Commit requires the exact accepted required-set hash; when it is
empty, the accepted hash is null.

## Bounded plan schema

The TypeScript below is documentation schema for this non-normative design.

```typescript
type OpaquePlanToken = string;
type PlanPartition =
  | 'selected'
  | 'required'
  | 'candidate'
  | 'excluded'
  | 'remainder';
type CommitPlanHandle = OpaquePlanToken; // opaque, at most 64 KiB, sole authority

interface SetSummary<T> {
  count: number;
  hash: OpaquePlanToken;
  preview: T[]; // at most 20
  truncated: boolean; // exactly count > preview.length
}

interface CommitPlanIssue {
  issueId: OpaquePlanToken;
  partition: 'candidate' | 'remainder';
  code: string;
  dependent: ChangeSetItemRef | null;
  required: SetSummary<ChangeSetItemRef>;
  tableId: string | null;
  rowId: string | null;
  path: string | null; // at most 1,024 UTF-8 bytes
}

interface CommitPlanItem {
  ref: ChangeSetItemRef;
  itemVersion: string;
  source: 'selected' | 'required' | 'excluded' | 'remainder';
  reasons: SetSummary<{ issueId: OpaquePlanToken }>;
  intrinsicEffects: Array<
    'schema' | 'migration' | 'views' | 'formula-definition' | 'file-reference'
  >; // at most 5 unique values
}

interface PlanChangeSetCommitInput extends BranchRef {
  precondition?: ChangeSetPrecondition;
  selector: CommitSelector;
  mode: 'strict' | 'expand';
}

interface CommitPlanResult {
  status: 'ready' | 'blocked';
  planId: OpaquePlanToken;
  handle: CommitPlanHandle;
  current: ChangeSetCurrent;
  mode: CommitMode;
  selectorScope: CommitSelector['scope'];
  selected: SetSummary<ChangeSetItemRef>;
  required: SetSummary<ChangeSetItemRef>;
  candidate: SetSummary<ChangeSetItemRef>;
  excluded: SetSummary<ChangeSetItemRef>;
  remainder: SetSummary<ChangeSetItemRef>;
  issues: SetSummary<{ issueId: OpaquePlanToken }>;
  candidateValidation: 'valid' | 'invalid';
  remainderValidation: 'valid' | 'invalid';
}

interface PreviewPlanItemsInput {
  handle: CommitPlanHandle;
  partition: PlanPartition;
  first: number; // integer 0..100 inclusive
  after?: OpaquePlanToken;
}

interface PreviewPlanIssuesInput {
  handle: CommitPlanHandle;
  itemId?: string; // opaque ChangeSet item ID; query filter only
  partition?: 'candidate' | 'remainder';
  first: number; // integer 0..100 inclusive
  after?: OpaquePlanToken;
}

interface PreviewPlanIssueRequiredInput {
  handle: CommitPlanHandle;
  issueId: OpaquePlanToken;
  first: number; // integer 0..100 inclusive
  after?: OpaquePlanToken;
}

interface PlanConnection<T> {
  planId: OpaquePlanToken;
  totalCount: number;
  edges: Edge<T>[]; // at most first, therefore at most 100
  pageInfo: PageInfo;
}

interface CommitPlannedChangeSetInput {
  handle: CommitPlanHandle;
  acceptedExpandedItemsHash: OpaquePlanToken | null;
  message?: string; // at most 4,096 UTF-8 bytes
}

interface CommitPlannedChangeSetResult {
  committed: true;
  operation: 'commit-plan';
  planId: OpaquePlanToken;
  selectedCount: number;
  requiredCount: number;
  committedItemCount: number;
  remainingItemCount: number;
  branch: Branch;
  previousHeadRevisionId: string;
  committedRevisionId: string;
  nextDraftRevisionId: string;
  changeSet: ChangeSet;
  delivery: Delivery;
}
```

Every requested, selected, required, candidate, excluded, remainder, issue,
and reason set uses exact count, opaque content hash, a preview capped at 20,
and a pageable connection when complete traversal is needed. Connections use
integer `first` from 0 through 100 inclusive; `first:0` returns no edges with
truthful page information. Cursors are opaque and query-bound.

Every preview is exactly the first `min(count,20)` nodes of the corresponding
complete connection after identical normalization and filters. It follows that
connection's deterministic order; summaries of item references use the
normative ChangeSet item order. `truncated` is exactly
`count > preview.length`, and paging reproduces the preview prefix without loss
or duplicates. This applies to selected, required, candidate, excluded,
remainder, issue, and reason summaries.

Without `itemId`, `previewChangeSetCommitIssues` pages the canonical plan issue
set, optionally intersected with `partition`. With `itemId`, it resolves one
`CommitPlanItem` in the handle-bound plan and pages exactly the canonical
issues referenced by that item's complete `reasons` set, optionally
intersected with `partition`. `CommitPlanItem.reasons.count` and `.hash`
describe the complete unfiltered per-item issue-ID set. Its preview is the
`issueId` projection of the first `min(count,20)` nodes from the same query
with `partition` omitted. An existing item with zero reasons returns a
successful empty connection; an unknown item returns
`COMMIT_PLAN_ITEM_NOT_FOUND`, false / zero / 0.

Stale, expired, or consumed handle validation precedes item lookup. After a
current handle and item lookup, cursor validation applies. A cursor binds plan
identity, `itemId` or null, `partition` or null, connection kind, and page
position. Changing either filter is a cross-query invalid cursor and returns
no partial page. `itemId` is a read filter, not a selector or CAS input; the
handle already binds ChangeSet and item versions, so an intervening semantic
change makes the plan stale before lookup. No raw reason array is exposed.

Planning may use a cache, but the opaque stateless handle is the sole authority.
Cache loss causes deterministic streaming recomputation, not loss of truth.
Planning and Commit consume large sets pagewise and do not fully materialize
closure arrays under the branch lock. Commit sends only the opaque handle, the
accepted expanded-items hash, and the optional bounded message. It never sends
or accepts a dependency array. The handle binds all plan inputs and state
needed for verification internally, but callers parse none of it. Expired,
stale, or consumed handles cannot create a second Revision.

## Planning precondition

`precondition` is optional. Omission and `{mode:'current'}` both resolve and
plan the locked current singleton atomically; neither requires a preceding
`changeSet` read. `{mode:'version',current:{id,version}}` requires both opaque
values to match atomically before selector resolution. A partial current object
is invalid.

Failure priority is exactly:

1. `CHANGESET_NOT_CURRENT`;
2. `CHANGESET_CHANGED`;
3. selection missing or ambiguous; and
4. `CHANGESET_ITEM_CHANGED`.

## Exact future method inventory

The design contains these five methods and no others. Every referenced type is
defined above or linked to the normative target. These signatures are not
implemented.

```typescript
planChangeSetCommit(
  input: PlanChangeSetCommitInput,
): Promise<CommitPlanResult>;
previewChangeSetCommitItems(
  input: PreviewPlanItemsInput,
): Promise<PlanConnection<CommitPlanItem>>;
previewChangeSetCommitIssues(
  input: PreviewPlanIssuesInput,
): Promise<PlanConnection<CommitPlanIssue>>;
previewChangeSetCommitIssueRequired(
  input: PreviewPlanIssueRequiredInput,
): Promise<PlanConnection<ChangeSetItemRef>>;
commitPlannedChangeSet(
  input: CommitPlannedChangeSetInput,
): Promise<CommitPlannedChangeSetResult>;
```

## Closed future protocol outcomes

The table below is closed for future plan/selector state outcomes after shared
request and branch validation. Input-domain violations — including `first`
outside 0..100, selector collections outside 1..100, duplicates, or a partial
version precondition — reuse the normative `CHANGESET_INVALID_INPUT` failure.
Shared branch lookup, topology, migration, rollback-confirmed transaction, and
unknown post-commit connection outcomes also retain their normative
[classification](../consistency.md#outcomes); they are not additional plan-state
outcomes.

| Method | Success outcomes | Future protocol failure outcomes |
| --- | --- | --- |
| `planChangeSetCommit` | Ready plan; blocked plan with bounded issues, including empty `all` | `COMMIT_PLAN_SELECTION_NOT_FOUND`, `COMMIT_PLAN_SELECTION_AMBIGUOUS`, `CHANGESET_NOT_CURRENT`, `CHANGESET_CHANGED`, `CHANGESET_ITEM_CHANGED` |
| `previewChangeSetCommitItems` | Bounded page; empty page | `COMMIT_PLAN_STALE`, `COMMIT_PLAN_EXPIRED`, `COMMIT_PLAN_CONSUMED`, `COMMIT_PLAN_INVALID_CURSOR` |
| `previewChangeSetCommitIssues` | Bounded page; empty page, including an existing item with zero reasons | `COMMIT_PLAN_ITEM_NOT_FOUND` when item-filtered; `COMMIT_PLAN_STALE`; `COMMIT_PLAN_EXPIRED`; `COMMIT_PLAN_CONSUMED`; `COMMIT_PLAN_INVALID_CURSOR` |
| `previewChangeSetCommitIssueRequired` | Bounded page; empty page | `COMMIT_PLAN_ISSUE_NOT_FOUND`, `COMMIT_PLAN_STALE`, `COMMIT_PLAN_EXPIRED`, `COMMIT_PLAN_CONSUMED`, `COMMIT_PLAN_INVALID_CURSOR` |
| `commitPlannedChangeSet` | Committed with delivery `delivered`, `not-configured`, or `failed` | `COMMIT_PLAN_NOT_READY`, `COMMIT_PLAN_STALE`, `COMMIT_PLAN_EXPIRED`, `COMMIT_PLAN_CONSUMED`, `COMMIT_PLAN_EXPANSION_NOT_ACCEPTED` |

Every plan or preview success is read-only: committed is not applicable, state
effect is zero, and notification attempts are 0. Every listed failure is
pre-commit with `committed:false`, zero state effect, and notification attempts
0. No failure or preview returns a partial selector realization or unbounded
collection.

Successful planned Commit has `committed:true` and committed state effect.
Delivery attempts for `delivered`, `not-configured`, and `failed` are 1, 0, and
1. Delivery `failed` is a committed success, never a failure row.

`all` on an empty ChangeSet intentionally differs from v1 mutation behavior:
planning succeeds with `status:'blocked'` and a bounded issue whose code is
`CHANGESET_EMPTY`; v1 `commitChangeSet` returns `CHANGESET_EMPTY` as a
pre-commit failure.

## Non-normative future golden vectors

This strict-JSON block is a mechanical design sample, not v1 acceptance or a
runtime claim. It prescribes no token or hash algorithm. Every vector has
exactly `id`, `context`, `input`, `observable`, and `expected`, and every
collection is bounded.

Within this block, `context.current_or_null` is the fixture's actual computed
current ChangeSet identity, not an input precondition. It is non-null for every
structurally valid topology and null only when topology prevents the singleton
projection.

```json
{
  "schema": "ve011-future-plan-doc-goldens-v1",
  "contextAxes": {
    "selector": [
      "all",
      "table-change",
      "table-all-changes",
      "tables-all-changes",
      "row",
      "rows",
      "items"
    ],
    "mode": [
      "strict",
      "expand"
    ],
    "plan_status": [
      "ready",
      "blocked",
      "stale",
      "expired",
      "consumed"
    ],
    "dependency_size": [
      "within-preview",
      "beyond-preview",
      "beyond-one-page"
    ],
    "partition": [
      "selected",
      "required",
      "candidate",
      "excluded",
      "remainder"
    ]
  },
  "contextCoverage": {
    "selector": {
      "all": [
        "candidate-and-remainder-valid-R-semantically-equals-D"
      ],
      "table-change": [
        "table-change-does-not-imply-all-rows"
      ],
      "table-all-changes": [
        "table-all-changes-includes-table-rows-before-closure"
      ],
      "tables-all-changes": [
        "plural-selector-realization"
      ],
      "row": [
        "large-required-count-hash-preview-page"
      ],
      "rows": [
        "selector-rows-one-missing-atomic-failure"
      ],
      "items": [
        "selector-items-version-mismatch-atomic-failure"
      ]
    },
    "mode": {
      "strict": [
        "table-change-does-not-imply-all-rows"
      ],
      "expand": [
        "large-required-count-hash-preview-page"
      ]
    },
    "plan_status": {
      "ready": [
        "table-change-does-not-imply-all-rows"
      ],
      "blocked": [
        "selector-all-empty-blocked"
      ],
      "stale": [
        "plan-stale"
      ],
      "expired": [
        "plan-expired"
      ],
      "consumed": [
        "plan-consumed"
      ]
    },
    "dependency_size": {
      "within-preview": [
        "table-change-does-not-imply-all-rows"
      ],
      "beyond-preview": [
        "preview-required-pagination"
      ],
      "beyond-one-page": [
        "large-required-count-hash-preview-page"
      ]
    },
    "partition": {
      "selected": [
        "table-change-does-not-imply-all-rows"
      ],
      "required": [
        "large-required-count-hash-preview-page"
      ],
      "candidate": [
        "candidate-and-remainder-valid-R-semantically-equals-D"
      ],
      "excluded": [
        "candidate-and-remainder-valid-R-semantically-equals-D"
      ],
      "remainder": [
        "candidate-and-remainder-valid-R-semantically-equals-D"
      ]
    }
  },
  "vectors": [
    {
      "id": "table-change-does-not-imply-all-rows",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "table-change",
          "tableId": "products"
        },
        "mode": "strict"
      },
      "observable": {
        "selectorRealization": "before-closure",
        "logicalTableMatchCount": 1
      },
      "expected": {
        "selected": [
          {
            "entity": "table",
            "itemId": "item-table-products"
          }
        ],
        "selectedCount": 1,
        "rowItemsSelected": 0,
        "requiredCount": 0,
        "status": "ready"
      }
    },
    {
      "id": "table-all-changes-includes-table-rows-before-closure",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "table-all-changes",
          "tableId": "products"
        },
        "mode": "strict"
      },
      "observable": {
        "selectorRealization": "before-closure",
        "logicalTableMatchCount": 1
      },
      "expected": {
        "selectedItemIds": [
          "item-table-products",
          "item-row-p-1",
          "item-row-p-2"
        ],
        "selectedCount": 3,
        "requiredCount": 0,
        "status": "ready"
      }
    },
    {
      "id": "plural-selector-realization",
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
        "method": "planChangeSetCommit",
        "cases": [
          {
            "selector": {
              "scope": "tables-all-changes",
              "tableIds": [
                "products",
                "orders"
              ]
            },
            "expectedItemIds": [
              "item-table-products",
              "item-row-p-1",
              "item-row-o-1"
            ]
          },
          {
            "selector": {
              "scope": "rows",
              "rows": [
                {
                  "tableId": "products",
                  "rowId": "p-1"
                },
                {
                  "tableId": "orders",
                  "rowId": "o-1"
                }
              ]
            },
            "expectedItemIds": [
              "item-row-p-1",
              "item-row-o-1"
            ]
          },
          {
            "selector": {
              "scope": "items",
              "items": [
                {
                  "itemId": "item-table-products",
                  "itemVersion": "item-version-table-products"
                },
                {
                  "itemId": "item-shared",
                  "itemVersion": "item-version-shared"
                }
              ]
            },
            "expectedItemIds": [
              "item-table-products",
              "item-shared"
            ]
          }
        ],
        "mode": "strict"
      },
      "observable": {
        "selectorRealization": "deduplicated-atomic"
      },
      "expected": {
        "allCasesReady": true,
        "partialPlans": 0,
        "maximumSelectorMembers": 100
      }
    },
    {
      "id": "large-required-count-hash-preview-page",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "row",
          "tableId": "products",
          "rowId": "p-1"
        },
        "mode": "expand"
      },
      "observable": {
        "partition": "required",
        "completeCount": 121
      },
      "expected": {
        "required": {
          "count": 121,
          "hash": "required-set-large",
          "previewCount": 20,
          "truncated": true
        },
        "completeTraversal": {
          "method": "previewChangeSetCommitItems",
          "partition": "required",
          "firstMaximum": 100
        },
        "dependencyArrayReturned": false,
        "previewIsCanonicalPrefix": true
      }
    },
    {
      "id": "candidate-and-remainder-valid-R-semantically-equals-D",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "all"
        },
        "mode": "expand"
      },
      "observable": {
        "states": [
          "H",
          "D",
          "C",
          "R"
        ],
        "partitions": [
          "selected",
          "required",
          "candidate",
          "excluded",
          "remainder"
        ]
      },
      "expected": {
        "candidateValidation": "valid",
        "remainderValidation": "valid",
        "remainderStateSemanticallyEqualsOldDraft": true,
        "candidateAndRemainderEffectsDisjoint": true,
        "candidateAndRemainderEffectsExhaustive": true,
        "status": "ready"
      }
    },
    {
      "id": "preview-required-pagination",
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
        "method": "previewChangeSetCommitIssueRequired",
        "handle": "plan-handle-alpha",
        "issueId": "issue-1",
        "first": 100,
        "after": "plan-cursor-page-1"
      },
      "observable": {
        "futurePreviewMethods": [
          "previewChangeSetCommitItems",
          "previewChangeSetCommitIssues",
          "previewChangeSetCommitIssueRequired"
        ],
        "requiredCount": 21
      },
      "expected": {
        "successOutcomes": [
          "bounded-page",
          "empty-page"
        ],
        "failureOutcomes": {
          "previewChangeSetCommitItems": [
            "COMMIT_PLAN_STALE",
            "COMMIT_PLAN_EXPIRED",
            "COMMIT_PLAN_CONSUMED",
            "COMMIT_PLAN_INVALID_CURSOR"
          ],
          "previewChangeSetCommitIssues": [
            "COMMIT_PLAN_ITEM_NOT_FOUND",
            "COMMIT_PLAN_STALE",
            "COMMIT_PLAN_EXPIRED",
            "COMMIT_PLAN_CONSUMED",
            "COMMIT_PLAN_INVALID_CURSOR"
          ],
          "previewChangeSetCommitIssueRequired": [
            "COMMIT_PLAN_ISSUE_NOT_FOUND",
            "COMMIT_PLAN_STALE",
            "COMMIT_PLAN_EXPIRED",
            "COMMIT_PLAN_CONSUMED",
            "COMMIT_PLAN_INVALID_CURSOR"
          ]
        },
        "maximumEdges": 100,
        "required": {
          "count": 21,
          "hash": "required-set-21",
          "previewCount": 20,
          "truncated": true
        },
        "previewIsCanonicalPrefix": true,
        "beyondPreview": true
      }
    },
    {
      "id": "commit-consent-does-not-echo-dependencies",
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
        "method": "commitPlannedChangeSet",
        "handle": "plan-handle-alpha",
        "acceptedExpandedItemsHash": "required-set-alpha",
        "message": "commit selected work"
      },
      "observable": {
        "requestFieldCensus": true
      },
      "expected": {
        "requestFields": [
          "handle",
          "acceptedExpandedItemsHash",
          "message"
        ],
        "dependencyArrayPresent": false,
        "failureOutcomes": [
          "COMMIT_PLAN_NOT_READY",
          "COMMIT_PLAN_STALE",
          "COMMIT_PLAN_EXPIRED",
          "COMMIT_PLAN_CONSUMED",
          "COMMIT_PLAN_EXPANSION_NOT_ACCEPTED"
        ],
        "successDeliveries": [
          {
            "status": "delivered",
            "committed": true,
            "stateEffect": "committed",
            "notificationAttempts": 1
          },
          {
            "status": "not-configured",
            "committed": true,
            "stateEffect": "committed",
            "notificationAttempts": 0
          },
          {
            "status": "failed",
            "committed": true,
            "stateEffect": "committed",
            "notificationAttempts": 1
          }
        ]
      }
    },
    {
      "id": "plan-precondition-omitted-current",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "all"
        },
        "mode": "strict"
      },
      "observable": {
        "precondition": "omitted"
      },
      "expected": {
        "priorChangeSetReadRequired": false,
        "resolution": "locked-current-singleton",
        "status": "ready"
      }
    },
    {
      "id": "plan-precondition-explicit-current",
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
        "method": "planChangeSetCommit",
        "precondition": {
          "mode": "current"
        },
        "selector": {
          "scope": "all"
        },
        "mode": "strict"
      },
      "observable": {
        "precondition": "current"
      },
      "expected": {
        "priorChangeSetReadRequired": false,
        "resolution": "locked-current-singleton",
        "status": "ready"
      }
    },
    {
      "id": "plan-precondition-version-not-current",
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
        "method": "planChangeSetCommit",
        "precondition": {
          "mode": "version",
          "current": {
            "id": "changeset-old",
            "version": "changeset-version-1"
          }
        },
        "selector": {
          "scope": "all"
        },
        "mode": "strict"
      },
      "observable": {
        "failurePriority": 1
      },
      "expected": {
        "code": "CHANGESET_NOT_CURRENT",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "plan-precondition-version-changed",
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
        "method": "planChangeSetCommit",
        "precondition": {
          "mode": "version",
          "current": {
            "id": "changeset-alpha",
            "version": "changeset-version-1"
          }
        },
        "selector": {
          "scope": "all"
        },
        "mode": "strict"
      },
      "observable": {
        "failurePriority": 2
      },
      "expected": {
        "code": "CHANGESET_CHANGED",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "selector-before-id-resolves",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "row",
          "tableId": "products",
          "rowId": "old-row"
        },
        "mode": "strict"
      },
      "observable": {
        "matchedSides": [
          "before",
          "after"
        ]
      },
      "expected": {
        "status": "ready",
        "selected": [
          {
            "itemId": "item-row-renamed",
            "matchedSide": "before"
          }
        ],
        "selectedCount": 1
      }
    },
    {
      "id": "selector-after-id-resolves",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "table-change",
          "tableId": "catalog"
        },
        "mode": "strict"
      },
      "observable": {
        "matchedSides": [
          "before",
          "after"
        ]
      },
      "expected": {
        "status": "ready",
        "selected": [
          {
            "itemId": "item-table-renamed",
            "matchedSide": "after"
          }
        ],
        "selectedCount": 1
      }
    },
    {
      "id": "selector-id-reuse-ambiguous",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "row",
          "tableId": "products",
          "rowId": "reused"
        },
        "mode": "strict"
      },
      "observable": {
        "logicalTableMatchCount": 1,
        "logicalRowMatchCount": 2
      },
      "expected": {
        "code": "COMMIT_PLAN_SELECTION_AMBIGUOUS",
        "retryWith": "opaque itemId and itemVersion",
        "candidateListReturned": false,
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "selector-all-empty-blocked",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "all"
        },
        "mode": "strict"
      },
      "observable": {
        "canonicalDelta": "empty"
      },
      "expected": {
        "success": true,
        "status": "blocked",
        "issues": {
          "count": 1,
          "hash": "issue-set-empty",
          "preview": [
            {
              "issueId": "issue-empty",
              "code": "CHANGESET_EMPTY"
            }
          ],
          "truncated": false
        },
        "committed": "not_applicable",
        "stateEffect": "zero",
        "notificationAttempts": 0,
        "previewIsCanonicalPrefix": true
      }
    },
    {
      "id": "selector-table-change-missing",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "table-change",
          "tableId": "rows-only-table"
        },
        "mode": "strict"
      },
      "observable": {
        "logicalTableMatchCount": 1,
        "semanticTableItemPresent": false
      },
      "expected": {
        "code": "COMMIT_PLAN_SELECTION_NOT_FOUND",
        "partialPlan": false,
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "selector-table-all-rows-without-table-item",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "table-all-changes",
          "tableId": "products"
        },
        "mode": "strict"
      },
      "observable": {
        "semanticTableItemPresent": false,
        "semanticRowItemCount": 2,
        "logicalTableMatchCount": 1
      },
      "expected": {
        "status": "ready",
        "selectedItemIds": [
          "item-row-p-1",
          "item-row-p-2"
        ],
        "selectedCount": 2
      }
    },
    {
      "id": "selector-tables-all-one-missing-atomic-failure",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "tables-all-changes",
          "tableIds": [
            "products",
            "missing"
          ]
        },
        "mode": "strict"
      },
      "observable": {
        "perMemberSemanticItemMatches": [
          2,
          0
        ]
      },
      "expected": {
        "code": "COMMIT_PLAN_SELECTION_NOT_FOUND",
        "selectedCountReturned": 0,
        "partialPlan": false,
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "selector-rows-one-missing-atomic-failure",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "rows",
          "rows": [
            {
              "tableId": "products",
              "rowId": "p-1"
            },
            {
              "tableId": "products",
              "rowId": "missing"
            }
          ]
        },
        "mode": "strict"
      },
      "observable": {
        "perMemberSemanticItemMatches": [
          1,
          0
        ]
      },
      "expected": {
        "code": "COMMIT_PLAN_SELECTION_NOT_FOUND",
        "selectedCountReturned": 0,
        "partialPlan": false,
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "selector-items-version-mismatch-atomic-failure",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "items",
          "items": [
            {
              "itemId": "item-row-p-1",
              "itemVersion": "item-version-row-p-1"
            },
            {
              "itemId": "item-table-products",
              "itemVersion": "item-version-old"
            }
          ]
        },
        "mode": "strict"
      },
      "observable": {
        "firstMismatch": "item-table-products"
      },
      "expected": {
        "code": "CHANGESET_ITEM_CHANGED",
        "selectedCountReturned": 0,
        "partialPlan": false,
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "plan-stale",
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
        "method": "previewChangeSetCommitItems",
        "handle": "plan-handle-stale",
        "partition": "candidate",
        "first": 20
      },
      "observable": {
        "planStatus": "stale"
      },
      "expected": {
        "code": "COMMIT_PLAN_STALE",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "plan-expired",
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
        "method": "previewChangeSetCommitIssues",
        "handle": "plan-handle-expired",
        "first": 20
      },
      "observable": {
        "planStatus": "expired"
      },
      "expected": {
        "code": "COMMIT_PLAN_EXPIRED",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "plan-consumed",
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
        "method": "previewChangeSetCommitIssueRequired",
        "handle": "plan-handle-consumed",
        "issueId": "issue-1",
        "first": 20
      },
      "observable": {
        "planStatus": "consumed"
      },
      "expected": {
        "code": "COMMIT_PLAN_CONSUMED",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "preview-invalid-cursor",
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
        "methods": [
          "previewChangeSetCommitItems",
          "previewChangeSetCommitIssues",
          "previewChangeSetCommitIssueRequired"
        ],
        "handle": "plan-handle-alpha",
        "first": 20,
        "after": "plan-cursor-invalid"
      },
      "observable": {
        "methods": [
          "previewChangeSetCommitItems",
          "previewChangeSetCommitIssues",
          "previewChangeSetCommitIssueRequired"
        ]
      },
      "expected": {
        "code": "COMMIT_PLAN_INVALID_CURSOR",
        "partialPage": false,
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0,
        "previewIsCanonicalPrefix": true
      }
    },
    {
      "id": "commit-expansion-consent-mismatch",
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
        "method": "commitPlannedChangeSet",
        "handle": "plan-handle-alpha",
        "acceptedExpandedItemsHash": "required-set-old"
      },
      "observable": {
        "currentRequiredHash": "required-set-current"
      },
      "expected": {
        "code": "COMMIT_PLAN_EXPANSION_NOT_ACCEPTED",
        "dependencyArrayReturned": false,
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "plan-precondition-partial-version-invalid",
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
        "method": "planChangeSetCommit",
        "precondition": {
          "mode": "version",
          "current": {
            "id": "changeset-alpha"
          }
        },
        "selector": {
          "scope": "all"
        },
        "mode": "strict"
      },
      "observable": {
        "inputValidation": "before-plan-resolution"
      },
      "expected": {
        "code": "CHANGESET_INVALID_INPUT",
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "selector-delete-before-id-resolves",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "table-change",
          "tableId": "deleted-table"
        },
        "mode": "strict"
      },
      "observable": {
        "logicalTableMatchCount": 1,
        "matchedSide": "before",
        "afterSide": null
      },
      "expected": {
        "status": "ready",
        "selected": [
          {
            "itemId": "item-table-deleted",
            "kind": "deleted"
          }
        ],
        "selectedCount": 1
      }
    },
    {
      "id": "selector-table-change-ambiguous",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "table-change",
          "tableId": "reused-table"
        },
        "mode": "strict"
      },
      "observable": {
        "logicalTableMatchCount": 2,
        "itemCountInsideGroups": 4
      },
      "expected": {
        "code": "COMMIT_PLAN_SELECTION_AMBIGUOUS",
        "ambiguityBasis": "logical-table",
        "partialPlan": false,
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "selector-table-all-missing",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "table-all-changes",
          "tableId": "missing-table"
        },
        "mode": "strict"
      },
      "observable": {
        "logicalTableMatchCount": 0
      },
      "expected": {
        "code": "COMMIT_PLAN_SELECTION_NOT_FOUND",
        "partialPlan": false,
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "selector-table-all-ambiguous",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "table-all-changes",
          "tableId": "reused-table"
        },
        "mode": "strict"
      },
      "observable": {
        "logicalTableMatchCount": 2,
        "itemCountInsideGroups": 5
      },
      "expected": {
        "code": "COMMIT_PLAN_SELECTION_AMBIGUOUS",
        "ambiguityBasis": "logical-table",
        "partialPlan": false,
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "selector-tables-all-one-ambiguous-atomic-failure",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "tables-all-changes",
          "tableIds": [
            "products",
            "reused-table"
          ]
        },
        "mode": "strict"
      },
      "observable": {
        "logicalTableMatchCount": 2,
        "perMemberLogicalTableMatches": [
          1,
          2
        ]
      },
      "expected": {
        "code": "COMMIT_PLAN_SELECTION_AMBIGUOUS",
        "selectedCountReturned": 0,
        "partialPlan": false,
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "selector-row-missing",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "row",
          "tableId": "products",
          "rowId": "missing"
        },
        "mode": "strict"
      },
      "observable": {
        "logicalTableMatchCount": 1,
        "logicalRowMatchCount": 0
      },
      "expected": {
        "code": "COMMIT_PLAN_SELECTION_NOT_FOUND",
        "partialPlan": false,
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "selector-rows-one-ambiguous-atomic-failure",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "rows",
          "rows": [
            {
              "tableId": "products",
              "rowId": "p-1"
            },
            {
              "tableId": "products",
              "rowId": "reused"
            }
          ]
        },
        "mode": "strict"
      },
      "observable": {
        "perPairLogicalTableMatches": [
          1,
          1
        ],
        "perPairLogicalRowMatches": [
          1,
          2
        ]
      },
      "expected": {
        "code": "COMMIT_PLAN_SELECTION_AMBIGUOUS",
        "selectedCountReturned": 0,
        "partialPlan": false,
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "selector-items-one-missing-atomic-failure",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "items",
          "items": [
            {
              "itemId": "item-row-p-1",
              "itemVersion": "item-version-row-p-1"
            },
            {
              "itemId": "item-missing",
              "itemVersion": "item-version-missing"
            }
          ]
        },
        "mode": "strict"
      },
      "observable": {
        "missingItemId": "item-missing"
      },
      "expected": {
        "code": "COMMIT_PLAN_SELECTION_NOT_FOUND",
        "distinctFromVersionMismatch": "CHANGESET_ITEM_CHANGED",
        "selectedCountReturned": 0,
        "partialPlan": false,
        "committed": false,
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    },
    {
      "id": "item-reasons-bounded-page",
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
        "method": "previewChangeSetCommitIssues",
        "cases": [
          {
            "name": "twenty-one-reasons",
            "handle": "plan-handle-alpha",
            "itemId": "changeset-item-21-reasons",
            "first": 20
          },
          {
            "name": "zero-reasons",
            "handle": "plan-handle-alpha",
            "itemId": "changeset-item-zero-reasons",
            "first": 100
          },
          {
            "name": "unknown-item-current-handle",
            "handle": "plan-handle-alpha",
            "itemId": "changeset-item-unknown",
            "first": 100
          },
          {
            "name": "stale-handle-unknown-item",
            "handle": "plan-handle-stale",
            "itemId": "changeset-item-unknown",
            "first": 100
          },
          {
            "name": "cursor-item-filter-mismatch",
            "handle": "plan-handle-alpha",
            "itemId": "changeset-item-other",
            "first": 100,
            "after": "plan-cursor-item-21-reasons"
          },
          {
            "name": "cursor-partition-filter-mismatch",
            "handle": "plan-handle-alpha",
            "itemId": "changeset-item-21-reasons",
            "partition": "remainder",
            "first": 100,
            "after": "plan-cursor-candidate-partition"
          }
        ]
      },
      "observable": {
        "caseCount": 6,
        "handleBoundItemExistence": {
          "changeset-item-other": true
        },
        "reasonSummary": {
          "itemId": "changeset-item-21-reasons",
          "count": 21,
          "hash": "item-reason-set-alpha",
          "preview": [
            {
              "issueId": "issue-reason-01"
            },
            {
              "issueId": "issue-reason-02"
            },
            {
              "issueId": "issue-reason-03"
            },
            {
              "issueId": "issue-reason-04"
            },
            {
              "issueId": "issue-reason-05"
            },
            {
              "issueId": "issue-reason-06"
            },
            {
              "issueId": "issue-reason-07"
            },
            {
              "issueId": "issue-reason-08"
            },
            {
              "issueId": "issue-reason-09"
            },
            {
              "issueId": "issue-reason-10"
            },
            {
              "issueId": "issue-reason-11"
            },
            {
              "issueId": "issue-reason-12"
            },
            {
              "issueId": "issue-reason-13"
            },
            {
              "issueId": "issue-reason-14"
            },
            {
              "issueId": "issue-reason-15"
            },
            {
              "issueId": "issue-reason-16"
            },
            {
              "issueId": "issue-reason-17"
            },
            {
              "issueId": "issue-reason-18"
            },
            {
              "issueId": "issue-reason-19"
            },
            {
              "issueId": "issue-reason-20"
            }
          ],
          "truncated": true
        }
      },
      "expected": {
        "cases": [
          {
            "name": "twenty-one-reasons",
            "connection": {
              "totalCount": 21,
              "firstPageCount": 20,
              "hasNextPage": true
            },
            "previewIssueIdsEqualFirstPageProjection": true,
            "completeTraversal": {
              "method": "previewChangeSetCommitIssues",
              "itemId": "changeset-item-21-reasons",
              "firstMaximum": 100,
              "lossless": true,
              "duplicates": false
            },
            "committed": "not_applicable",
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "name": "zero-reasons",
            "connection": {
              "totalCount": 0,
              "edgeCount": 0,
              "hasNextPage": false,
              "endCursor": null
            },
            "committed": "not_applicable",
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "name": "unknown-item-current-handle",
            "code": "COMMIT_PLAN_ITEM_NOT_FOUND",
            "pageReturned": false,
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "name": "stale-handle-unknown-item",
            "code": "COMMIT_PLAN_STALE",
            "validationOrder": "handle-before-item",
            "itemLookupAttempted": false,
            "pageReturned": false,
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "name": "cursor-item-filter-mismatch",
            "code": "COMMIT_PLAN_INVALID_CURSOR",
            "reason": "QUERY_MISMATCH",
            "mismatchedFilter": "itemId",
            "partialPage": false,
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          },
          {
            "name": "cursor-partition-filter-mismatch",
            "code": "COMMIT_PLAN_INVALID_CURSOR",
            "reason": "QUERY_MISMATCH",
            "mismatchedFilter": "partition",
            "partialPage": false,
            "committed": false,
            "stateEffect": "zero",
            "notificationAttempts": 0
          }
        ],
        "maximumCases": 6,
        "previewIsCanonicalPrefix": true
      }
    },
    {
      "id": "future-five-method-outcome-matrix",
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
        "contract": "future-five-method-outcomes",
        "methods": [
          "planChangeSetCommit",
          "previewChangeSetCommitItems",
          "previewChangeSetCommitIssues",
          "previewChangeSetCommitIssueRequired",
          "commitPlannedChangeSet"
        ]
      },
      "observable": {
        "rowCount": 5
      },
      "expected": {
        "cases": [
          {
            "method": "planChangeSetCommit",
            "success": [
              "ready-plan",
              "blocked-plan-with-bounded-issues"
            ],
            "failures": [
              "COMMIT_PLAN_SELECTION_NOT_FOUND",
              "COMMIT_PLAN_SELECTION_AMBIGUOUS",
              "CHANGESET_NOT_CURRENT",
              "CHANGESET_CHANGED",
              "CHANGESET_ITEM_CHANGED"
            ],
            "successEffect": {
              "committed": "not_applicable",
              "stateEffect": "zero",
              "notificationAttempts": 0
            },
            "failureEffect": {
              "committed": false,
              "stateEffect": "zero",
              "notificationAttempts": 0
            }
          },
          {
            "method": "previewChangeSetCommitItems",
            "success": [
              "bounded-page",
              "empty-page"
            ],
            "failures": [
              "COMMIT_PLAN_STALE",
              "COMMIT_PLAN_EXPIRED",
              "COMMIT_PLAN_CONSUMED",
              "COMMIT_PLAN_INVALID_CURSOR"
            ],
            "successEffect": {
              "committed": "not_applicable",
              "stateEffect": "zero",
              "notificationAttempts": 0
            },
            "failureEffect": {
              "committed": false,
              "stateEffect": "zero",
              "notificationAttempts": 0
            }
          },
          {
            "method": "previewChangeSetCommitIssues",
            "success": [
              "bounded-page",
              "empty-page"
            ],
            "failures": [
              "COMMIT_PLAN_ITEM_NOT_FOUND",
              "COMMIT_PLAN_STALE",
              "COMMIT_PLAN_EXPIRED",
              "COMMIT_PLAN_CONSUMED",
              "COMMIT_PLAN_INVALID_CURSOR"
            ],
            "successEffect": {
              "committed": "not_applicable",
              "stateEffect": "zero",
              "notificationAttempts": 0
            },
            "failureEffect": {
              "committed": false,
              "stateEffect": "zero",
              "notificationAttempts": 0
            }
          },
          {
            "method": "previewChangeSetCommitIssueRequired",
            "success": [
              "bounded-page",
              "empty-page"
            ],
            "failures": [
              "COMMIT_PLAN_ISSUE_NOT_FOUND",
              "COMMIT_PLAN_STALE",
              "COMMIT_PLAN_EXPIRED",
              "COMMIT_PLAN_CONSUMED",
              "COMMIT_PLAN_INVALID_CURSOR"
            ],
            "successEffect": {
              "committed": "not_applicable",
              "stateEffect": "zero",
              "notificationAttempts": 0
            },
            "failureEffect": {
              "committed": false,
              "stateEffect": "zero",
              "notificationAttempts": 0
            }
          },
          {
            "method": "commitPlannedChangeSet",
            "success": [
              "delivery:delivered",
              "delivery:not-configured",
              "delivery:failed"
            ],
            "failures": [
              "COMMIT_PLAN_NOT_READY",
              "COMMIT_PLAN_STALE",
              "COMMIT_PLAN_EXPIRED",
              "COMMIT_PLAN_CONSUMED",
              "COMMIT_PLAN_EXPANSION_NOT_ACCEPTED"
            ],
            "successEffects": [
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
              },
              {
                "delivery": "failed",
                "committed": true,
                "stateEffect": "committed",
                "notificationAttempts": 1
              }
            ],
            "failureEffect": {
              "committed": false,
              "stateEffect": "zero",
              "notificationAttempts": 0
            }
          }
        ],
        "maximumCases": 5
      }
    },
    {
      "id": "blocked-plan-invalid-state",
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
        "method": "planChangeSetCommit",
        "selector": {
          "scope": "all"
        },
        "mode": "expand",
        "cases": [
          {
            "candidateValidation": "invalid",
            "remainderValidation": "valid"
          },
          {
            "candidateValidation": "valid",
            "remainderValidation": "invalid"
          }
        ]
      },
      "observable": {
        "blockingPredicate": "candidate-or-remainder-invalid"
      },
      "expected": {
        "status": "blocked",
        "cases": [
          {
            "candidateValidation": "invalid",
            "remainderValidation": "valid"
          },
          {
            "candidateValidation": "valid",
            "remainderValidation": "invalid"
          }
        ],
        "issues": {
          "count": 2,
          "hash": "blocking-issue-set-invalid-state",
          "preview": [
            {
              "issueId": "issue-candidate-invalid"
            },
            {
              "issueId": "issue-remainder-invalid"
            }
          ],
          "truncated": false
        },
        "previewIsCanonicalPrefix": true,
        "committed": "not_applicable",
        "stateEffect": "zero",
        "notificationAttempts": 0
      }
    }
  ]
}
```
