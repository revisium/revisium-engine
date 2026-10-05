import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { JsonSchemaStore } from '@revisium/schema-toolkit/model';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { FileValueStore } from 'src/features/plugin/file/file-value.store';
import {
  collectCandidateFileRows,
  fileRowKey,
  isRecord,
} from 'src/features/draft-changes/files/file-references';
import type {
  CandidateFileReference,
  CandidateFileRow,
} from 'src/features/draft-changes/files/file-references';
import { createNativeFileRow } from 'src/features/draft-changes/files/file-validation';
import type {
  FileValidation,
  NativeFileCell,
  NativeFileRow,
} from 'src/features/draft-changes/files/file-validation';

type SourceBlob =
  DraftChangesSnapshot['head']['tables'][number]['rows'][number]['fileBlobs'][number];

interface SourceFileRow extends CandidateFileRow {
  blobsByHash: Map<string, SourceBlob[]>;
  native?: NativeFileRow;
  validationByPath: Map<string, Promise<ValidatedFileSource>>;
  cellsByPath: Map<string, SourceFileCell>;
}

interface SourceFileCell {
  reference: CandidateFileReference;
  row: SourceFileRow;
}

export type ValidatedFileSource =
  | { status: 'valid'; cell: NativeFileCell; row: SourceFileRow }
  | { status: 'invalid'; message: string };

export interface FileSourceIndex {
  cellsByFile: Map<string, SourceFileCell[]>;
  fileIdsByRow: Map<string, Set<string>>;
  draftRows: Map<string, SourceFileRow>;
  schemaStores: Map<JsonSchema, JsonSchemaStore>;
  validation: FileValidation;
}

export type MatchingFileSource = Extract<
  ValidatedFileSource,
  { status: 'valid' }
>;

export function buildFileSourceIndex(
  snapshot: DraftChangesSnapshot,
  validation: FileValidation,
): FileSourceIndex {
  const index: FileSourceIndex = {
    cellsByFile: new Map(),
    fileIdsByRow: new Map(),
    draftRows: new Map(),
    schemaStores: new Map(),
    validation,
  };
  for (const role of ['head', 'draft'] as const) {
    const blobsByRow = new Map(
      snapshot[role].tables.flatMap((table) =>
        table.rows.map(
          (row) =>
            [
              fileRowKey(table.createdId, row.createdId),
              row.fileBlobs,
            ] as const,
        ),
      ),
    );
    for (const candidate of collectCandidateFileRows(snapshot[role])) {
      const rowKey = fileRowKey(
        candidate.tableCreatedId,
        candidate.row.createdId,
      );
      const source = createSourceRow(candidate, blobsByRow.get(rowKey) ?? []);
      if (role === 'draft') {
        index.draftRows.set(rowKey, source);
      }
      indexSourceCells(index, source);
    }
  }
  return index;
}

function createSourceRow(
  candidate: CandidateFileRow,
  blobs: SourceBlob[],
): SourceFileRow {
  const blobsByHash = new Map<string, SourceBlob[]>();
  for (const blob of blobs) {
    const matches = blobsByHash.get(blob.hash) ?? [];
    matches.push(blob);
    blobsByHash.set(blob.hash, matches);
  }
  const source: SourceFileRow = {
    ...candidate,
    blobsByHash,
    validationByPath: new Map(),
    cellsByPath: new Map(),
  };
  for (const reference of candidate.references) {
    source.cellsByPath.set(reference.path, { reference, row: source });
  }
  return source;
}

function indexSourceCells(index: FileSourceIndex, row: SourceFileRow): void {
  const rowKey = fileRowKey(row.tableCreatedId, row.row.createdId);
  const ids = index.fileIdsByRow.get(rowKey) ?? new Set<string>();
  for (const cell of row.cellsByPath.values()) {
    const value = cell.reference.value;
    if (!isRecord(value) || typeof value.fileId !== 'string') {
      continue;
    }
    ids.add(value.fileId);
    const key = `${rowKey}:${value.fileId}`;
    const cells = index.cellsByFile.get(key) ?? [];
    cells.push(cell);
    index.cellsByFile.set(key, cells);
  }
  index.fileIdsByRow.set(rowKey, ids);
}

export async function matchFileSources(
  index: FileSourceIndex,
  reference: CandidateFileReference,
  candidate: FileValueStore,
): Promise<{
  matches: MatchingFileSource[];
  hasIdentity: boolean;
  immutableViolation: boolean;
}> {
  const rowKey = fileRowKey(reference.tableCreatedId, reference.rowCreatedId);
  const alternatives =
    index.cellsByFile.get(`${rowKey}:${candidate.fileId}`) ?? [];
  const matches: MatchingFileSource[] = [];
  let immutableViolation = false;
  for (const alternative of alternatives) {
    const source = await validateSourceCell(index, alternative);
    if (source.status === 'invalid') {
      continue;
    }
    try {
      candidate.checkImmutable(source.cell.file);
      matches.push(source);
    } catch {
      immutableViolation = true;
    }
  }
  return {
    matches,
    immutableViolation,
    hasIdentity: index.fileIdsByRow.get(rowKey)?.has(candidate.fileId) ?? false,
  };
}

export async function resolveInitializationSource(
  index: FileSourceIndex,
  tableCreatedId: string,
  rowCreatedId: string,
  path: string,
): Promise<ValidatedFileSource | undefined> {
  const row = index.draftRows.get(fileRowKey(tableCreatedId, rowCreatedId));
  const cell = row?.cellsByPath.get(path);
  return cell ? validateSourceCell(index, cell) : undefined;
}

function validateSourceCell(
  index: FileSourceIndex,
  cell: SourceFileCell,
): Promise<ValidatedFileSource> {
  const cached = cell.row.validationByPath.get(cell.reference.path);
  if (cached) {
    return cached;
  }
  const result = validateOriginalSourceCell(index, cell);
  cell.row.validationByPath.set(cell.reference.path, result);
  return result;
}

async function validateOriginalSourceCell(
  index: FileSourceIndex,
  source: SourceFileCell,
): Promise<ValidatedFileSource> {
  const rawError = await index.validation.validateRaw(source.reference.value);
  if (rawError) {
    return { status: 'invalid', message: rawError };
  }
  source.row.native ??= createNativeFileRow(source.row, index.schemaStores);
  const native = source.row.native;
  const cell = native?.cells.get(source.reference.path);
  if (!native || !cell) {
    return {
      status: 'invalid',
      message: 'Source file occurrence is unavailable.',
    };
  }
  const error = index.validation.validateNative(cell, native);
  return error
    ? { status: 'invalid', message: error }
    : { status: 'valid', cell, row: source.row };
}
