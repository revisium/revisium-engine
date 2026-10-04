import objectHash from 'object-hash';
import {
  deepEqual,
  pluginRefs,
  SchemaTable,
} from '@revisium/schema-toolkit/lib';
import type {
  JsonArraySchema,
  JsonNumberSchema,
  JsonObjectSchema,
  JsonPatch,
  JsonSchema,
  JsonStringSchema,
  JsonValue,
} from '@revisium/schema-toolkit/types';
import { fingerprintSnapshot } from 'src/features/draft-changes/__tests__/snapshot/support/fingerprint-fixtures';
import { fingerprintDraftChangesSnapshot } from 'src/features/draft-changes/snapshot/fingerprint';
import type { DraftChangesFingerprintInput } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { HistoryPatches } from 'src/features/share/queries/impl/transactional/get-table-schema.query';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { ProjectDraftChangesSchemaQueryData } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';

type SnapshotTable = DraftChangesFingerprintInput['head']['tables'][number];
type SnapshotRow = SnapshotTable['rows'][number];
const SCHEMA_ROW_ID = 'products';
const TABLE_CREATED_ID = 'stable-products';
const SCHEMA_ROW_CREATED_ID = 'schema-products-created';
const HISTORY_DATE = '2026-01-01T00:00:00.000Z';

export interface SchemaHistoryStep {
  patches: JsonPatch[];
  schema: JsonSchema;
}

export interface ProjectionRowInput {
  createdId: string;
  data: JsonValue;
}

export interface GivenSchemaProjectionOptions {
  operation?: 'commit' | 'discard';
  tableCreatedId?: string;
  headTableId?: string;
  draftTableId?: string;
  headSchema: JsonSchema;
  draftSchema: JsonSchema;
  pending?: SchemaHistoryStep[];
  selectedEffects?: ProjectDraftChangesSchemaQueryData['effects'];
  headRows?: ProjectionRowInput[];
  draftRows?: ProjectionRowInput[];
  headHistory?: HistoryPatches[];
  draftHistory?: HistoryPatches[];
  discardedDataFields?: ProjectDraftChangesSchemaQueryData['discardedDataFields'];
  schemaRefs?: ProjectDraftChangesSchemaQueryData['schemaRefs'];
  duplicateHeadSchemaRow?: boolean;
  duplicateDraftSchemaRow?: boolean;
  missingHeadTable?: boolean;
  missingDraftTable?: boolean;
  missingHeadSchemaRow?: boolean;
  missingDraftSchemaRow?: boolean;
}

export function stringField(defaultValue = ''): JsonStringSchema {
  return { type: 'string', default: defaultValue };
}

export function numberField(defaultValue = 0): JsonNumberSchema {
  return { type: 'number', default: defaultValue };
}

export function objectSchema(
  properties: Record<string, JsonSchema>,
): JsonObjectSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties).sort(),
    properties,
  };
}

export function arraySchema(items: JsonSchema): JsonArraySchema {
  return { type: 'array', items };
}

export function moveField(from: string, path: string): JsonPatch {
  return { op: 'move', from, path };
}

export function removeField(path: string): JsonPatch {
  return { op: 'remove', path };
}

export function addField(path: string, value: JsonSchema): JsonPatch {
  return { op: 'add', path, value };
}

export function givenSchemaProjection(
  options: GivenSchemaProjectionOptions,
): ProjectDraftChangesSchemaQueryData {
  const base = structuredClone(fingerprintSnapshot());
  const templateTable = requiredArrayItem(
    base.head.tables,
    0,
    'Head table fixture',
  );
  const templateRow = requiredArrayItem(
    templateTable.rows,
    0,
    'Head row fixture',
  );
  const tableCreatedId = options.tableCreatedId ?? TABLE_CREATED_ID;
  const headTableId = options.headTableId ?? SCHEMA_ROW_ID;
  const draftTableId = options.draftTableId ?? SCHEMA_ROW_ID;
  const headHistory = options.headHistory ?? [rootHistory(options.headSchema)];
  const draftHistory = options.draftHistory ?? [
    ...headHistory,
    ...pendingHistory(options.headSchema, options.pending ?? [], {
      ...pluginRefs,
      ...(options.schemaRefs ?? {}),
    }),
  ];
  const headRows = options.headRows ?? [];
  const draftRows = options.draftRows ?? structuredClone(headRows);

  const headSchemaTable = createSchemaTable(
    templateTable,
    templateRow,
    'head',
    headTableId,
    options.headSchema,
    headHistory,
  );
  const draftSchemaTable = createSchemaTable(
    templateTable,
    templateRow,
    'draft',
    draftTableId,
    options.draftSchema,
    draftHistory,
  );
  if (options.missingHeadSchemaRow) {
    headSchemaTable.rows = [];
  }
  if (options.missingDraftSchemaRow) {
    draftSchemaTable.rows = [];
  }
  base.head.tables = [
    ...(!options.missingHeadSchemaRow ? [headSchemaTable] : []),
    ...(!options.missingHeadTable
      ? [
          createDataTable(
            templateTable,
            templateRow,
            'head',
            tableCreatedId,
            headTableId,
            headRows,
          ),
        ]
      : []),
  ];
  base.draft.tables = [
    ...(!options.missingDraftSchemaRow ? [draftSchemaTable] : []),
    ...(!options.missingDraftTable
      ? [
          createDataTable(
            templateTable,
            templateRow,
            'draft',
            tableCreatedId,
            draftTableId,
            draftRows,
          ),
        ]
      : []),
  ];

  if (options.duplicateHeadSchemaRow) {
    addDuplicateSchemaRow(
      requiredArrayItem(base.head.tables, 0, 'Head schema table fixture'),
      'head-schema-duplicate-row',
    );
  }
  if (options.duplicateDraftSchemaRow) {
    addDuplicateSchemaRow(
      requiredArrayItem(base.draft.tables, 0, 'Draft schema table fixture'),
      'draft-schema-duplicate-row',
    );
  }

  const fingerprintInput: DraftChangesFingerprintInput = {
    branch: base.branch,
    head: base.head,
    draft: base.draft,
  };
  const snapshot = {
    ...fingerprintInput,
    fingerprint: fingerprintDraftChangesSnapshot(fingerprintInput),
  };

  return {
    snapshot,
    tableCreatedId,
    operation: options.operation ?? 'commit',
    effects: options.selectedEffects ?? [],
    ...(options.discardedDataFields === undefined
      ? {}
      : { discardedDataFields: options.discardedDataFields }),
    ...(options.schemaRefs === undefined
      ? {}
      : { schemaRefs: options.schemaRefs }),
  };
}

export function pendingHistory(
  initialSchema: JsonSchema,
  steps: SchemaHistoryStep[],
  refs: Record<string, JsonSchema> = pluginRefs,
): HistoryPatches[] {
  let table = new SchemaTable(structuredClone(initialSchema), refs);
  return steps.map(({ patches, schema }) => {
    table.applyPatches(structuredClone(patches));
    const nextSchema = table.getSchema();
    if (!deepEqual(nextSchema, schema)) {
      throw new Error(
        'Pending schema step does not match its recorded patches.',
      );
    }
    table = new SchemaTable(structuredClone(nextSchema), refs);
    return {
      patches: structuredClone(patches),
      hash: objectHash(nextSchema),
      date: HISTORY_DATE,
    };
  });
}

export function rowInput(
  createdId: string,
  data: JsonValue,
): ProjectionRowInput {
  return { createdId, data };
}

export function replaySchemaHistory(
  initialSchema: JsonSchema,
  history: HistoryPatches[],
  firstHistoryIndex = 1,
): JsonSchema {
  const table = new SchemaTable(initialSchema);
  for (const entry of history.slice(firstHistoryIndex)) {
    table.applyPatches(entry.patches);
  }
  return table.getSchema();
}

export function requiredArrayItem<T>(
  items: T[],
  index: number,
  label: string,
): T {
  const item = items[index];
  if (!item) {
    throw new Error(`Expected ${label} at index ${index}.`);
  }
  return item;
}

export function rootHistory(schema: JsonSchema): HistoryPatches {
  return {
    patches: [{ op: 'add', path: '', value: structuredClone(schema) }],
    hash: objectHash(schema),
    date: HISTORY_DATE,
  };
}

function createSchemaTable(
  tableTemplate: SnapshotTable,
  rowTemplate: SnapshotRow,
  revisionRole: 'head' | 'draft',
  tableId: string,
  schema: JsonSchema,
  history: HistoryPatches[],
): SnapshotTable {
  const schemaRow: SnapshotRow = {
    ...structuredClone(rowTemplate),
    id: tableId,
    createdId: SCHEMA_ROW_CREATED_ID,
    versionId: `${revisionRole}-schema-row-${tableId}`,
    data: structuredClone(schema) as SnapshotRow['data'],
    meta: structuredClone(history) as SnapshotRow['meta'],
    hash: objectHash(schema),
    schemaHash: 'schema-row-hash',
    fileBlobs: [],
  };
  return {
    ...structuredClone(tableTemplate),
    id: SystemTables.Schema,
    createdId: 'schema-table',
    versionId: `${revisionRole}-schema-table`,
    readonly: true,
    system: true,
    rows: [schemaRow],
  };
}

function createDataTable(
  tableTemplate: SnapshotTable,
  rowTemplate: SnapshotRow,
  revisionRole: 'head' | 'draft',
  tableCreatedId: string,
  tableId: string,
  rows: ProjectionRowInput[],
): SnapshotTable {
  return {
    ...structuredClone(tableTemplate),
    id: tableId,
    createdId: tableCreatedId,
    versionId: `${revisionRole}-table-${tableId}`,
    readonly: revisionRole === 'head',
    system: false,
    rows: rows.map(({ createdId, data }, index) => ({
      ...structuredClone(rowTemplate),
      id: createdId,
      createdId,
      versionId: `${revisionRole}-row-${index}-${createdId}`,
      readonly: revisionRole === 'head',
      data: structuredClone(data) as SnapshotRow['data'],
      meta: {},
      hash: objectHash(data),
      schemaHash: 'row-schema-hash',
      fileBlobs: [],
    })),
  };
}

function addDuplicateSchemaRow(table: SnapshotTable, versionId: string): void {
  table.rows.push({
    ...structuredClone(
      requiredArrayItem(table.rows, 0, 'Schema row to duplicate'),
    ),
    versionId,
  });
}
