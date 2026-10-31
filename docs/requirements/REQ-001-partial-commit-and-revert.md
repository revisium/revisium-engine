# REQ-001. Partial Commit and Revert of Draft Changes

| Property | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-10-22 |

These requirements define how revisium-engine commits or reverts a selected part of
a branch's uncommitted changes.

Terms:

- **Head** is the last committed revision of a branch.
- **Draft** is the working revision of a branch; it holds the changes that are not
  committed yet.
- **Commit** publishes Draft changes as the new Head.
- **Revert** discards Draft changes and returns the affected data to its Head state.
- **Change** is one unit of change as defined in REQ-001.BR-007.

## 1. Callers and situations

### 1.1 REQ-001.BR-001. Callers

People use the operations in the admin UI, programs use them through the API and
the CLI, and AI agents use them through MCP. Every caller gets the same
capabilities.

### 1.2 REQ-001.BR-002. Situations

The capability covers five situations; all of them occur in practice and are in
scope:

- **S1. Commit what is ready.** Some of the accumulated changes are ready to
  commit and the others are not.
- **S2. Fix a mistake.** A caller returns individual changes to their committed
  state and keeps the rest of the work.
- **S3. Several people in one branch.** Each person commits their own work
  independently of other people's unfinished work.
- **S4. Structure and content in parallel.** Content changes are committed without
  waiting for the work on the table structure to finish.
- **S5. Release on a date.** A set of changes is prepared in advance and committed
  together at a chosen moment, while current changes are committed separately.

## 2. Partial commit and revert

### 2.1 REQ-001.BR-003. Selected part

A caller commits or reverts a selected part of a branch's uncommitted changes. All
other changes stay in the Draft.

### 2.2 REQ-001.BR-004. Consistency

Every committed revision is consistent: table structures, data, references between
rows and the history of structure changes match each other. When a selection would
break this, the engine states the reason and names the changes to add to the
selection or remove from it. An environment that synchronizes through migration
export accepts a partial commit and every commit after it.

### 2.3 REQ-001.BR-005. Compatibility

The existing operations that commit the whole Draft and revert the whole Draft
behave as before.

### 2.4 REQ-001.BR-007. Unit of change

A data change is one field of a row; creating or deleting a row is one change of the
whole row. All structure changes of one table are one change, which also includes
the values of new or changed fields, including values filled in automatically. A
change to a field that the structure change left unchanged is a separate change,
even when the structure of the same table has changed. For example, when `color` is
added to `products` while editors change prices, the prices can be committed at once
and `color` with its values later. A new table is therefore committed whole, with
all its rows.

## 3. Scope

### 3.1 REQ-001.BR-009. Engine boundary

REQ-001 defines a capability of revisium-engine: partial commit and revert of Draft
changes that keeps every result consistent. The caller (admin UI, API, CLI or MCP)
passes the selected changes. Grouping changes into sets, scheduled commits and the
user interface are outside REQ-001: they belong to a layer above the engine that
builds on this capability. The engine supports S3 and S5 through the selections that
this layer passes.

## 4. Withdrawn requirements

Withdrawn IDs stay reserved and are not reused.

### 4.1 REQ-001.BR-006. Change sets

Withdrawn: named change sets in a shared Draft belong to the layer above the engine
(REQ-001.BR-009), not to the engine.

### 4.2 REQ-001.BR-008. One change in one set

Withdrawn for the same reason: keeping each change in exactly one set belongs to the
layer above the engine (REQ-001.BR-009).
