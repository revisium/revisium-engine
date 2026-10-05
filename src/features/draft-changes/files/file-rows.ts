import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { JsonSchemaStore } from '@revisium/schema-toolkit/model';
import { FileStatus } from 'src/features/plugin/file/consts';
import type {
  CandidateFileBlocker,
  CandidateFileEffect,
} from 'src/features/draft-changes/queries/impl/prepare-candidate-files.query';
import type {
  CandidateFileReference,
  CandidateFileRow,
} from 'src/features/draft-changes/files/file-references';
import { createNativeFileRow } from 'src/features/draft-changes/files/file-validation';
import type {
  NativeFileRow,
  NativeFileCell,
  FileValidation,
} from 'src/features/draft-changes/files/file-validation';
import { matchFileSources } from 'src/features/draft-changes/files/file-sources';
import type {
  FileSourceIndex,
  MatchingFileSource,
} from 'src/features/draft-changes/files/file-sources';
import {
  prepareFileInitialization,
  initializedFileEffect,
} from 'src/features/draft-changes/files/file-initialization';
import type { FileInitializationContext } from 'src/features/draft-changes/files/file-initialization';
import { createCandidateFileBlocker } from 'src/features/draft-changes/files/file-effects';

export interface PreparedFileCell {
  reference: CandidateFileReference;
  native: NativeFileCell;
  sources: MatchingFileSource[];
}

export interface PreparedFileRow {
  candidate: CandidateFileRow;
  native?: NativeFileRow;
  cells: PreparedFileCell[];
}

export interface PreparedRoleFiles {
  role: 'head' | 'draft';
  rows: PreparedFileRow[];
  effects: CandidateFileEffect[];
  blockers: CandidateFileBlocker[];
}

export async function prepareRoleFiles(
  role: 'head' | 'draft',
  rows: CandidateFileRow[],
  validation: FileValidation,
  sources: FileSourceIndex,
  initialization: FileInitializationContext,
): Promise<PreparedRoleFiles> {
  const result: PreparedRoleFiles = {
    role,
    rows: [],
    effects: [],
    blockers: [],
  };
  const schemas = new Map<JsonSchema, JsonSchemaStore>();
  for (const row of rows) {
    const rawBlockers = await validateRawRowFiles(role, row, validation);
    result.blockers.push(...rawBlockers);
    if (rawBlockers.length > 0) {
      continue;
    }
    const native =
      row.references.length > 0 ? createNativeFileRow(row, schemas) : undefined;
    const prepared: PreparedFileRow = { candidate: row, native, cells: [] };
    result.rows.push(prepared);
    for (const reference of row.references) {
      await prepareRowFile(
        result,
        prepared,
        reference,
        validation,
        sources,
        initialization,
      );
    }
  }
  return result;
}

async function validateRawRowFiles(
  role: 'head' | 'draft',
  row: CandidateFileRow,
  validation: FileValidation,
): Promise<CandidateFileBlocker[]> {
  const blockers: CandidateFileBlocker[] = [];
  for (const reference of row.references) {
    const error = await validation.validateRaw(reference.value);
    if (error) {
      blockers.push(
        createCandidateFileBlocker(
          'INVALID_FILE_VALUE',
          role,
          reference,
          error,
        ),
      );
    }
  }
  return blockers;
}

async function prepareRowFile(
  result: PreparedRoleFiles,
  row: PreparedFileRow,
  reference: CandidateFileReference,
  validation: FileValidation,
  sources: FileSourceIndex,
  initialization: FileInitializationContext,
): Promise<void> {
  const native = row.native?.cells.get(reference.path);
  if (!row.native || !native) {
    result.blockers.push(
      createCandidateFileBlocker(
        'INVALID_FILE_VALUE',
        result.role,
        reference,
        'Native file occurrence is unavailable.',
      ),
    );
    return;
  }
  const birth = await initialization.getSource(result.role, reference);
  const initializationBlocker = prepareFileInitialization(
    result.role,
    row.candidate,
    reference,
    native,
    initialization,
    birth,
  );
  if (initializationBlocker) {
    result.blockers.push(initializationBlocker);
    return;
  }
  const nativeError = validation.validateNative(native, row.native);
  if (nativeError) {
    result.blockers.push(
      createCandidateFileBlocker(
        'INVALID_FILE_VALUE',
        result.role,
        reference,
        nativeError,
      ),
    );
    return;
  }
  if (
    birth.status === 'valid' &&
    initialization.matchesReady(native.file, birth.fileId)
  ) {
    const effect = initializedFileEffect(result.role, reference, birth);
    if (effect) {
      result.effects.push(effect);
    }
    row.cells.push({ reference, native, sources: [] });
    return;
  }
  const matched = await matchFileSources(sources, reference, native.file);
  if (matched.matches.length === 0) {
    const code =
      native.file.status !== FileStatus.uploaded ||
      !matched.hasIdentity ||
      matched.immutableViolation
        ? 'INVALID_FILE_VALUE'
        : 'FILE_BLOB_MISMATCH';
    result.blockers.push(
      createCandidateFileBlocker(
        code,
        result.role,
        reference,
        'No valid immutable source tuple authorizes this file value.',
      ),
    );
    return;
  }
  row.cells.push({ reference, native, sources: matched.matches });
}
