# File Usage Consumer Test Cases

Target: manual and automated consumer-style verification of the file-usage system on the current branch.

## Architecture Notes

- File bytes are tracked per opaque `projectId`, not per branch or revision.
- `Row.versionId` is immutable; updates and renames create new row versions and preserve old references until cleanup.
- `FileBlob` is unique per `(projectId, hash)`.
- `_FileBlobToRow` is the source of truth for reference existence inside a project.
- `ProjectFileUsage.fileBytes` is a denormalized counter that should equal the sum of active `FileBlob.size` values for the project.
- `deletedAt` is a tombstone for storage-side deletion coordination, not a hard delete.
- `confirmStorageDeleted({ hashes })` only hard-deletes tombstoned rows. Active rows with the same hash must survive stale confirmation attempts.

## High-Risk Scenarios

| Scenario | Why it matters | Expected result |
| --- | --- | --- |
| Same hash uploaded twice in one project | Dedup must be by `(projectId, hash)` | Counter increments once |
| Same hash exists in two projects | Storage object is shared physically but accounting is isolated logically | Each project keeps its own `FileBlob` and counter |
| Project cleanup while same hash is active elsewhere | Consumer must not delete shared storage too early | `orphanHashes` excludes hashes still active in another project |
| Tombstoned hash is re-uploaded before storage delete confirm | Race between cleanup and fresh usage | Existing `FileBlob` is reactivated, counter restored, stale `confirmStorageDeleted` does nothing |
| Pending storage deletions query after mixed tombstoned/active hashes | Consumer retry job depends on correctness | Only globally orphaned tombstones are returned |
| Project-scoped orphan cleanup | Consumer repair flow may target one project | Only that project counter changes |
| Rename row with file refs | Rename creates a new row version without new bytes | Counter unchanged, reference count increases until cleanup |
| Update row with same hash | Immutable row history keeps both row versions but dedup stays by hash | Counter unchanged, blob count unchanged |
| Update row from hash H1 to H2 | Old version still references H1 until orphan cleanup | Counter becomes `S1 + S2`, then drops to `S2` after cleanup |
| Remove renamed/updated row before orphan cleanup | Current row removal does not necessarily free bytes immediately | Bytes remain until old unreachable versions are swept |
| Revert after file upload in draft | Draft revert does not hard-delete row versions immediately | Counter stays as an upper bound until `cleanOrphanedData` runs |
| Cleanup after revert | Eventually consistent cleanup path | `cleanOrphanedData` tombstones orphaned blobs and frees bytes |
| Manual counter drift | Operational recovery path | `validateProjectFileBytes` reports drift, `restoreProjectFileBytes` fixes it |
| Legacy/fork backfill | Existing rows may predate `FileBlob` rows | Backfill recreates blobs and links idempotently |
| Re-running cleanup/confirm commands | Consumers may retry blindly after crashes | Repeated calls are safe no-ops or bounded idempotent actions |

## Calls To Exercise

- `getProjectStorageBytes`
- `getStorageBytesForProjects`
- `validateProjectFileBytes`
- `restoreProjectFileBytes`
- `backfillProjectFileBlobs`
- `cleanupOrphanedFileBlobs`
- `cleanupOrphanedFileBlobsForProject`
- `cleanupProjectFileUsage`
- `getPendingStorageDeletions`
- `confirmStorageDeleted`

## Manual Break Checks

- Call `cleanupProjectFileUsage`, then re-upload the same hash before calling `confirmStorageDeleted`.
- Call `confirmStorageDeleted` with a stale hash that has already been reactivated.
- Create the same hash in two projects, tombstone one side, and verify the hash is absent from pending deletions.
- Upload a file in a draft-only table, revert the draft, and verify cleanup is deferred until `cleanOrphanedData`.
- Rename a row with an uploaded file, then delete the renamed row and verify bytes are not freed until orphan cleanup.
- Update a row from one file hash to another and verify both hashes are billed until orphan cleanup removes the unreachable version.
