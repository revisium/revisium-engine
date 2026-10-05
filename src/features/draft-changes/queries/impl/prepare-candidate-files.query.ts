import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { CandidateSchemaProjectionBinding } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';

export interface CandidateFileEffect {
  role: 'head' | 'draft';
  tableCreatedId: string;
  rowCreatedId: string;
  path: string;
  beforeBlobIds: string[];
  afterBlobIds: string[];
  initializedFileId?: string;
}

export interface CandidateFileBlocker {
  code:
    | 'UNINITIALIZED_FILE_VALUE'
    | 'INVALID_FILE_VALUE'
    | 'FILE_SOURCE_NOT_FOUND'
    | 'FILE_BLOB_NOT_FOUND'
    | 'FILE_BLOB_MISMATCH';
  role: 'head' | 'draft';
  tableCreatedId: string;
  rowCreatedId: string;
  path: string;
  message: string;
}

export interface PrepareCandidateFilesQueryData {
  snapshot: DraftChangesSnapshot;
  head: DraftRevisionState;
  draft: DraftRevisionState;
  schemaProjectionBindings?: CandidateSchemaProjectionBinding[];
}

export type PrepareCandidateFilesResult =
  | {
      status: 'prepared';
      head: DraftRevisionState;
      draft: DraftRevisionState;
      effects: CandidateFileEffect[];
      cleanupBlobIds: string[];
    }
  | { status: 'blocked'; blockers: CandidateFileBlocker[] };

export class PrepareCandidateFilesQuery {
  constructor(public readonly data: PrepareCandidateFilesQueryData) {}
}
