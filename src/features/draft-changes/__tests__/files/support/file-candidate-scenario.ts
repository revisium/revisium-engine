import objectHash from 'object-hash';
import type { JsonObjectSchema } from '@revisium/schema-toolkit/types';
import { createCache } from 'cache-manager';
import type { JsonValue } from 'src/engine-prisma-types';
import type {
  DraftRevisionState,
  DraftRevisionStateTable,
  DraftRevisionStateRow,
} from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import type {
  PrepareCandidateFilesQueryData,
  PrepareCandidateFilesResult,
} from 'src/features/draft-changes/queries/impl/prepare-candidate-files.query';
import type { CandidateSchemaProjectionBinding } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import { fingerprintSnapshot } from 'src/features/draft-changes/__tests__/snapshot/support/fingerprint-fixtures';
import { fingerprintDraftChangesSnapshot } from 'src/features/draft-changes/snapshot/fingerprint';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { prepareCandidateFiles } from 'src/features/draft-changes/files/prepare-candidate-files';
import type { FileUsageApiService } from 'src/features/file-usage/file-usage-api.service';
import { FileReferenceExtractorService } from 'src/features/file-usage/services/file-reference-extractor.service';

export interface FileValue {
  status: string;
  fileId: string;
  url: string;
  fileName: string;
  hash: string;
  extension: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
}

export interface FileBlob {
  id: string;
  hash: string;
  size: bigint;
}

export interface RoleFileSource {
  value: unknown;
  blobs?: FileBlob[];
}

export interface GivenFileCandidateOptions {
  head: RoleFileSource;
  draft: RoleFileSource;
  additionalFiles?: Record<
    string,
    { head: RoleFileSource; draft: RoleFileSource }
  >;
  caption?: string;
  headCaption?: string;
  draftCaption?: string;
  headMeta?: JsonValue;
  draftMeta?: JsonValue;
  snapshotHead?: RoleFileSource;
  snapshotDraft?: RoleFileSource;
}

export interface FileCandidateScenario {
  input: PrepareCandidateFilesQueryData;
  prepare(): Promise<PrepareCandidateFilesResult>;
  sourceRow(
    role: 'head' | 'draft',
  ): DraftChangesSnapshot['head']['tables'][number]['rows'][number];
  setFile(role: 'head' | 'draft', value: unknown, path?: string): void;
  setSourceFile(role: 'head' | 'draft', value: unknown, path?: string): void;
  setSourceBlobProject(
    role: 'head' | 'draft',
    blobId: string,
    projectId: string,
  ): void;
  clearSourceBlobAssociations(role: 'head' | 'draft'): void;
  setCandidateBlobIds(role: 'head' | 'draft', ids: string[]): void;
  setCandidateDocument(
    role: 'head' | 'draft',
    schema: JsonObjectSchema,
    data: JsonValue,
    blobIds: string[],
    updateSnapshot?: boolean,
  ): void;
  setCaption(row: DraftRevisionStateRow, caption: string): void;
}

const fixedDate = new Date('2026-01-01T00:00:00.000Z');
const fileHashLength = 64;
const defaultBlobSize = 12n;
const tableId = 'products';
const tableCreatedId = 'table-created';
const rowId = 'product-1';
const rowCreatedId = 'row-created';

export function uploadedFile(overrides: Partial<FileValue> = {}): FileValue {
  return {
    status: 'uploaded',
    fileId: 'file-id-0000000000000',
    url: 'https://example.com/files/file-id-0000000000000',
    fileName: 'photo.png',
    hash: 'a'.repeat(fileHashLength),
    extension: 'png',
    mimeType: 'image/png',
    size: 12,
    width: 2,
    height: 3,
    ...overrides,
  };
}

export function readyFile(overrides: Partial<FileValue> = {}): FileValue {
  return uploadedFile({
    status: 'ready',
    url: '',
    fileName: '',
    hash: '',
    extension: '',
    mimeType: '',
    size: 0,
    width: 0,
    height: 0,
    ...overrides,
  });
}

export function blob(
  id: string,
  hash: string,
  size = defaultBlobSize,
): FileBlob {
  return { id, hash, size };
}

export function givenFileCandidate(
  options: GivenFileCandidateOptions,
): FileCandidateScenario {
  const snapshotInput = structuredClone(fingerprintSnapshot());
  const headSource = options.snapshotHead ?? options.head;
  const draftSource = options.snapshotDraft ?? options.draft;
  const headTable = requiredSnapshotTable(snapshotInput.head.tables, tableId);
  const draftTable = requiredSnapshotTable(snapshotInput.draft.tables, tableId);
  const headSnapshotRow = requiredSnapshotRow(headTable.rows, rowId);
  const draftSnapshotRow = requiredSnapshotRow(draftTable.rows, rowId);
  const headSchema = schemaForFiles(options, 'head');
  const draftSchema = schemaForFiles(options, 'draft');
  const headFiles = roleFiles(options, 'head', headSource);
  const draftFiles = roleFiles(options, 'draft', draftSource);
  headSnapshotRow.data = rowData(
    headFiles,
    options.headCaption ?? options.caption ?? 'caption',
  );
  headSnapshotRow.fileBlobs = uniqueBlobs(headFiles).map(snapshotBlob);
  draftSnapshotRow.data = rowData(
    draftFiles,
    options.draftCaption ?? options.caption ?? 'caption',
  );
  draftSnapshotRow.fileBlobs = uniqueBlobs(draftFiles).map(snapshotBlob);
  headTable.rows = [headSnapshotRow];
  draftTable.rows = [draftSnapshotRow];
  snapshotInput.head.tables = [
    systemSchemaTable(headTable, headSnapshotRow, headSchema),
    headTable,
  ];
  snapshotInput.draft.tables = [
    systemSchemaTable(draftTable, draftSnapshotRow, draftSchema),
    draftTable,
  ];
  const snapshot = {
    ...snapshotInput,
    fingerprint: fingerprintDraftChangesSnapshot(snapshotInput),
  } satisfies DraftChangesSnapshot;

  const head = candidateState(
    headFiles,
    options.headCaption ?? options.caption,
    options.headMeta,
  );
  const draft = candidateState(
    draftFiles,
    options.draftCaption ?? options.caption,
    options.draftMeta,
  );
  const input = { snapshot, head, draft };
  const validator = new JsonSchemaValidatorService(createCache());
  const fileUsage: Pick<FileUsageApiService, 'getProjectFileBlobs'> = {
    getProjectFileBlobs: async ({ hashes }: { hashes: readonly string[] }) => {
      const byId = new Map<
        string,
        (typeof headSnapshotRow.fileBlobs)[number]
      >();
      for (const revision of [snapshot.head, snapshot.draft]) {
        for (const table of revision.tables) {
          for (const row of table.rows) {
            for (const item of row.fileBlobs) {
              if (hashes.includes(item.hash)) {
                byId.set(item.id, item);
              }
            }
          }
        }
      }
      return [...byId.values()].map(({ id, hash, size, deletedAt }) => ({
        id,
        hash,
        size,
        deletedAt,
      }));
    },
  };
  return {
    input,
    prepare: () =>
      prepareCandidateFiles(
        input,
        fileUsage,
        validator,
        new FileReferenceExtractorService(),
      ),
    sourceRow: (role) =>
      requiredSnapshotRow(
        requiredSnapshotTable(snapshot[role].tables, tableId).rows,
        rowId,
      ),
    setFile: (role, value, path = 'file') => {
      const row = candidateRow(input[role]);
      if (!isRecord(row.data)) {
        throw new Error(`Expected object data on ${role} candidate.`);
      }
      row.data[path] = value as JsonValue;
    },
    setSourceFile: (role, value, path = 'file') => {
      const row = requiredSnapshotRow(
        requiredSnapshotTable(input.snapshot[role].tables, tableId).rows,
        rowId,
      );
      if (!isRecord(row.data)) {
        throw new Error(`Expected object data on ${role} source row.`);
      }
      row.data[path] = value as JsonValue;
      input.snapshot.fingerprint = fingerprintDraftChangesSnapshot(
        input.snapshot,
      );
    },
    setSourceBlobProject: (role, blobId, projectId) => {
      const sourceBlob = scenarioBlob(input, role, blobId);
      sourceBlob.projectId = projectId;
    },
    clearSourceBlobAssociations: (role) => {
      const row = requiredSnapshotRow(
        requiredSnapshotTable(input.snapshot[role].tables, tableId).rows,
        rowId,
      );
      row.fileBlobs = [];
    },
    setCandidateBlobIds: (role, ids) => {
      candidateRow(input[role]).fileBlobs = ids.map((id) => ({ id }));
    },
    setCandidateDocument: (
      role,
      schema,
      data,
      blobIds,
      updateSnapshot = false,
    ) => {
      const state = input[role];
      const candidateSchemaRow = state.tables
        .find(({ id }) => id === SystemTables.Schema)
        ?.rows.find(({ id }) => id === tableId);
      if (!candidateSchemaRow) {
        throw new Error('Expected candidate schema row.');
      }
      candidateSchemaRow.data = schemaJson(schema);
      const candidate = candidateRow(state);
      candidate.data = structuredClone(data);
      candidate.fileBlobs = blobIds.map((id) => ({ id }));
      if (!updateSnapshot) {
        return;
      }
      const revision = input.snapshot[role];
      const schemaRow = revision.tables
        .find(({ id }) => id === SystemTables.Schema)
        ?.rows.find(({ id }) => id === tableId);
      const source = requiredSnapshotRow(
        requiredSnapshotTable(revision.tables, tableId).rows,
        rowId,
      );
      if (!schemaRow) {
        throw new Error('Expected source schema row.');
      }
      schemaRow.data = schemaJson(schema);
      source.data = structuredClone(data);
      source.fileBlobs = blobIds.map((id) => {
        const record = scenarioBlob(input, role, id);
        return record;
      });
      input.snapshot.fingerprint = fingerprintDraftChangesSnapshot(
        input.snapshot,
      );
    },
    setCaption: (row, caption) => {
      if (!isRecord(row.data)) {
        throw new Error('Expected object row data.');
      }
      row.data.caption = caption;
    },
  };
}

export function proveAddedFileSlot(scenario: FileCandidateScenario): void {
  const effect = { historyIndex: 1, patchIndex: 0 };
  const binding: CandidateSchemaProjectionBinding = {
    tableCreatedId,
    sourceFingerprint: scenario.input.snapshot.fingerprint,
    operation: 'commit',
    selectedEffects: [effect],
    fileSlots: (['head', 'draft'] as const).map((role) => ({
      role,
      introducedBy: effect,
      sourceDraftPath: '/file',
      projectedPath: '/file',
    })),
    rowFieldMappings: [],
    rowTargetFieldMappings: [],
  };
  scenario.input.schemaProjectionBindings = [binding];
}

function formatBlockers(
  blockers: Array<{ code: string; message: string }>,
): string {
  return blockers.map(({ code, message }) => `${code}: ${message}`).join(', ');
}

export function requirePrepared(result: PrepareCandidateFilesResult) {
  if (result.status !== 'prepared') {
    throw new Error(
      `Expected prepared candidates; received ${formatBlockers(result.blockers)}`,
    );
  }
  return result;
}

export function requireBlocked(result: PrepareCandidateFilesResult) {
  if (result.status !== 'blocked') {
    throw new Error('Expected candidate file preparation to be blocked.');
  }
  return result;
}

export function candidateRow(state: DraftRevisionState): DraftRevisionStateRow {
  const table = state.tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  const row = table?.rows.find(({ createdId }) => createdId === rowCreatedId);
  if (!row) {
    throw new Error(`Expected file candidate row '${rowCreatedId}'.`);
  }
  return row;
}

export function preparedRow(
  state: DraftRevisionState,
  role: 'head' | 'draft',
): DraftRevisionStateRow {
  const table = state.tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  const row = table?.rows.find(({ createdId }) => createdId === rowCreatedId);
  if (!row) {
    throw new Error(`Expected prepared ${role} row '${rowCreatedId}'.`);
  }
  return row;
}

function scenarioBlob(
  input: PrepareCandidateFilesQueryData,
  role: 'head' | 'draft',
  blobId: string,
) {
  const row = requiredSnapshotRow(
    requiredSnapshotTable(input.snapshot[role].tables, tableId).rows,
    rowId,
  );
  const record = row.fileBlobs.find(({ id }) => id === blobId);
  if (!record) {
    throw new Error(`Expected source blob '${blobId}' in ${role}.`);
  }
  return record;
}

export function readFile(data: JsonValue, path = 'file'): FileValue {
  if (!isRecord(data) || !isRecord(data[path])) {
    throw new Error(`Expected file value at '${path}'.`);
  }
  return data[path] as unknown as FileValue;
}

export function blobIds(row: DraftRevisionStateRow): string[] {
  return row.fileBlobs.map(({ id }) => id).sort();
}

function candidateState(
  files: Record<string, RoleFileSource>,
  caption = 'caption',
  meta: JsonValue = { label: 'kept', nested: { value: 'before' } },
): DraftRevisionState {
  const sourceBlobs = uniqueBlobs(files);
  const schema = schemaForFilesFromPaths(Object.keys(files));
  const row: DraftRevisionStateRow = {
    id: rowId,
    createdId: rowCreatedId,
    versionId: `${rowCreatedId}-version`,
    readonly: false,
    createdAt: fixedDate,
    updatedAt: fixedDate,
    publishedAt: fixedDate,
    data: rowData(files, caption),
    meta: structuredClone(meta),
    hash: 'row-hash',
    schemaHash: 'schema-hash',
    fileBlobs: sourceBlobs.map(({ id }) => ({ id })),
  };
  return {
    tables: [
      candidateSchemaTable(schema),
      {
        id: tableId,
        createdId: tableCreatedId,
        versionId: `${tableCreatedId}-version`,
        readonly: false,
        createdAt: fixedDate,
        updatedAt: fixedDate,
        system: false,
        rows: [row],
      },
    ],
  };
}

function schemaForFiles(
  options: GivenFileCandidateOptions,
  role: 'head' | 'draft',
) {
  return schemaForFilesFromPaths(
    Object.keys(roleFiles(options, role, options[role])),
  );
}

function schemaForFilesFromPaths(paths: string[]): JsonObjectSchema {
  const properties: JsonObjectSchema['properties'] = Object.fromEntries([
    ...paths.map((path) => [path, { $ref: SystemSchemaIds.File }]),
    ['caption', { type: 'string', default: '' }],
  ]);
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function candidateSchemaTable(
  schema: JsonObjectSchema,
): DraftRevisionStateTable {
  return {
    id: SystemTables.Schema,
    createdId: 'system-schema-created',
    versionId: 'system-schema-version',
    readonly: true,
    createdAt: fixedDate,
    updatedAt: fixedDate,
    system: true,
    rows: [
      {
        id: tableId,
        createdId: 'products-schema-row',
        versionId: 'products-schema-version',
        readonly: true,
        createdAt: fixedDate,
        updatedAt: fixedDate,
        publishedAt: fixedDate,
        data: schemaJson(schema),
        meta: schemaHistory(schema),
        hash: 'products-schema-row-hash',
        schemaHash: 'schema-schema-hash',
        fileBlobs: [],
      },
    ],
  };
}

function systemSchemaTable(
  templateTable: DraftChangesSnapshot['head']['tables'][number],
  templateRow: DraftChangesSnapshot['head']['tables'][number]['rows'][number],
  schema: JsonObjectSchema,
) {
  return {
    ...templateTable,
    id: SystemTables.Schema,
    createdId: 'system-schema-created',
    versionId: 'system-schema-version',
    system: true,
    rows: [
      {
        ...templateRow,
        id: tableId,
        createdId: 'products-schema-row',
        versionId: 'products-schema-version',
        data: schemaJson(schema),
        meta: schemaHistory(schema),
        fileBlobs: [],
      },
    ],
  };
}

function schemaHistory(schema: JsonObjectSchema): JsonValue {
  const value = schemaJson(schema);
  return [
    {
      patches: [{ op: 'add', path: '', value }],
      hash: objectHash(value),
      date: fixedDate.toISOString(),
    },
  ] as unknown as JsonValue;
}

function schemaJson(schema: JsonObjectSchema): JsonValue {
  return JSON.parse(JSON.stringify(schema));
}

function rowData(
  files: Record<string, RoleFileSource>,
  caption: string,
): JsonValue {
  return {
    ...Object.fromEntries(
      Object.entries(files).map(([path, source]) => [
        path,
        structuredClone(source.value),
      ]),
    ),
    caption,
  } as unknown as JsonValue;
}

function roleFiles(
  options: GivenFileCandidateOptions,
  role: 'head' | 'draft',
  source: RoleFileSource,
): Record<string, RoleFileSource> {
  return {
    file: source,
    ...Object.fromEntries(
      Object.entries(options.additionalFiles ?? {}).map(([path, pair]) => [
        path,
        pair[role],
      ]),
    ),
  };
}

function uniqueBlobs(files: Record<string, RoleFileSource>): FileBlob[] {
  const byId = new Map<string, FileBlob>();
  for (const { blobs = [] } of Object.values(files)) {
    for (const item of blobs) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

function snapshotBlob(item: FileBlob) {
  return {
    id: item.id,
    projectId: 'project',
    hash: item.hash,
    size: item.size,
    deletedAt: null,
    createdAt: fixedDate,
  };
}

function requiredSnapshotTable<T extends { id: string }>(
  tables: T[],
  id: string,
): T {
  const table = tables.find((candidate) => candidate.id === id);
  if (!table) {
    throw new Error(`Expected snapshot table '${id}'.`);
  }
  return table;
}

function requiredSnapshotRow<T extends { id: string }>(
  rows: T[],
  id: string,
): T {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) {
    throw new Error(`Expected snapshot row '${id}'.`);
  }
  return row;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
