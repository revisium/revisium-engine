import type { JsonValue } from '@revisium/schema-toolkit/types';
import { FileStatus } from 'src/features/plugin/file/consts';
import type { FileReference } from 'src/features/file-usage/types';
import type { FileReferenceExtractorService } from 'src/features/file-usage/services/file-reference-extractor.service';
import type { GetProjectFileBlobsResult } from 'src/features/file-usage/queries/impl/get-project-file-blobs.query';
import type {
  CandidateFileBlocker,
  CandidateFileEffect,
} from 'src/features/draft-changes/queries/impl/prepare-candidate-files.query';
import type {
  PreparedFileCell,
  PreparedFileRow,
  PreparedRoleFiles,
} from 'src/features/draft-changes/files/file-rows';
import { createCandidateFileBlocker } from 'src/features/draft-changes/files/file-effects';

export interface RowFileAccounting {
  role: 'head' | 'draft';
  prepared: PreparedFileRow;
  references: FileReference[];
}

export function extractRowFileAccounting(
  roles: PreparedRoleFiles[],
  extractor: FileReferenceExtractorService,
  projectId: string,
): RowFileAccounting[] {
  return roles.flatMap(({ role, rows }) =>
    rows.map((prepared) => ({
      role,
      prepared,
      references: prepared.native
        ? extractor.extract({
            data: prepared.candidate.row.data as JsonValue,
            schemaStore: prepared.native.schemaStore,
            rowId: prepared.candidate.row.id,
            projectId,
          })
        : [],
    })),
  );
}

export function reconcileFileAssociations(
  rows: RowFileAccounting[],
  blobs: GetProjectFileBlobsResult,
  projectId: string,
): { effects: CandidateFileEffect[]; blockers: CandidateFileBlocker[] } {
  const canonical = new Map(blobs.map((blob) => [blob.id, blob]));
  const effects: CandidateFileEffect[] = [];
  const blockers: CandidateFileBlocker[] = [];
  for (const row of rows) {
    const authorizedByHash = new Map<string, string>();
    const rowBlockers: CandidateFileBlocker[] = [];
    for (const cell of row.prepared.cells) {
      if (cell.native.file.status !== FileStatus.uploaded) {
        continue;
      }
      const result = authorizedFileBlob(cell, canonical, projectId);
      if (typeof result === 'string') {
        authorizedByHash.set(cell.native.file.hash, result);
      } else {
        rowBlockers.push(
          createCandidateFileBlocker(
            result.code,
            row.role,
            cell.reference,
            result.message,
          ),
        );
      }
    }
    if (rowBlockers.length > 0) {
      blockers.push(...rowBlockers);
      continue;
    }
    const desired = row.references.map(({ hash }) => {
      const id = authorizedByHash.get(hash);
      if (!id) {
        throw new Error(
          'Native file accounting reference has no authorized source.',
        );
      }
      return id;
    });
    const effect = replaceRowAssociations(row, desired);
    if (effect) {
      effects.push(effect);
    }
  }
  return { effects, blockers };
}

function authorizedFileBlob(
  candidate: PreparedFileCell,
  canonical: Map<string, GetProjectFileBlobsResult[number]>,
  projectId: string,
): string | Pick<CandidateFileBlocker, 'code' | 'message'> {
  const file = candidate.native.file;
  let hasAssociation = false;
  for (const source of candidate.sources) {
    for (const blob of source.row.blobsByHash.get(file.hash) ?? []) {
      hasAssociation = true;
      const actual = canonical.get(blob.id);
      if (
        blob.projectId === projectId &&
        blob.size === BigInt(file.size) &&
        actual?.hash === blob.hash &&
        actual.size === blob.size
      ) {
        return blob.id;
      }
    }
  }
  return hasAssociation
    ? {
        code: 'FILE_BLOB_MISMATCH',
        message:
          'Source file association does not match a canonical project blob.',
      }
    : {
        code: 'FILE_SOURCE_NOT_FOUND',
        message: 'No original row association authorizes this upload.',
      };
}

function replaceRowAssociations(
  row: RowFileAccounting,
  desired: string[],
): CandidateFileEffect | undefined {
  const candidate = row.prepared.candidate;
  const before = candidate.row.fileBlobs.map(({ id }) => id).sort();
  const after = [...new Set(desired)].sort();
  if (
    before.length === after.length &&
    before.every((id, index) => id === after[index])
  ) {
    return undefined;
  }
  candidate.row.fileBlobs = after.map((id) => ({ id }));
  return {
    role: row.role,
    tableCreatedId: candidate.tableCreatedId,
    rowCreatedId: candidate.row.createdId,
    path: candidate.references[0]?.path ?? '',
    beforeBlobIds: before,
    afterBlobIds: after,
  };
}
