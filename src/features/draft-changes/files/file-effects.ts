import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type {
  CandidateFileEffect,
  CandidateFileBlocker,
} from 'src/features/draft-changes/queries/impl/prepare-candidate-files.query';

export function createInitializationEffect(
  role: 'head' | 'draft',
  ref: { tableCreatedId: string; rowCreatedId: string; path: string },
  fileId: string,
): CandidateFileEffect {
  return {
    role,
    tableCreatedId: ref.tableCreatedId,
    rowCreatedId: ref.rowCreatedId,
    path: ref.path,
    beforeBlobIds: [],
    afterBlobIds: [],
    initializedFileId: fileId,
  };
}

export function createCandidateFileBlocker(
  code: CandidateFileBlocker['code'],
  role: 'head' | 'draft',
  ref: { tableCreatedId: string; rowCreatedId: string; path: string },
  message: string,
): CandidateFileBlocker {
  return {
    code,
    role,
    tableCreatedId: ref.tableCreatedId,
    rowCreatedId: ref.rowCreatedId,
    path: ref.path,
    message,
  };
}

export function detachedSnapshotBlobIds(
  snapshot: DraftChangesSnapshot,
  states: DraftRevisionState[],
): string[] {
  const retained = collectRetainedBlobIds(states);
  const removed = new Set<string>();
  for (const revision of [snapshot.head, snapshot.draft]) {
    for (const table of revision.tables) {
      for (const row of table.rows) {
        for (const blob of row.fileBlobs) {
          if (!retained.has(blob.id)) {
            removed.add(blob.id);
          }
        }
      }
    }
  }
  return [...removed];
}

function collectRetainedBlobIds(states: DraftRevisionState[]): Set<string> {
  const retained = new Set<string>();
  for (const state of states) {
    for (const table of state.tables) {
      for (const row of table.rows) {
        for (const blob of row.fileBlobs) {
          retained.add(blob.id);
        }
      }
    }
  }
  return retained;
}
