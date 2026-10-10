import type {
  JsonPatch,
  JsonSchema,
  JsonValue,
} from '@revisium/schema-toolkit/types';
import { givenDraftProjectWithSchema } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import type { DraftChangesCatalogue } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { ReadDraftChangesQueryData } from 'src/features/draft-changes/queries/impl/read-draft-changes.query';
import type { DraftChangesApiService } from 'src/features/draft-changes/draft-changes-api.service';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { TableViewsData } from 'src/features/views/types';
import { createReadingMutations } from './reading-mutations';
import { type ReadingTestKit } from './reading-test-kit';
import {
  readCatalogue,
  readSnapshot,
  requireCatalogue,
} from './reading-catalogue';
import { tamperDraftRowKeepingHash } from './reading-corruption';

export interface ReadingScenario {
  branch: ReadDraftChangesQueryData;
  tableId: string;
  rowId: string;
  updateDraftRow(data: Record<string, JsonValue>): Promise<void>;
  patchDraftSchema(patches: JsonPatch[]): Promise<void>;
  renameDraftRow(nextRowId: string): Promise<void>;
  renameDraftTable(nextTableId: string): Promise<void>;
  createDraftRow(rowId: string, data: Record<string, JsonValue>): Promise<void>;
  createDraftTable(tableId: string, schema: JsonSchema): Promise<void>;
  tamperDraftRowKeepingHash(data: Record<string, JsonValue>): Promise<void>;
  reuseDraftRowId(data: Record<string, JsonValue>): Promise<void>;
  reuseDraftTableId(): Promise<void>;
  updateDraftViews(views: TableViewsData): Promise<void>;
  startMigration(): Promise<void>;
  readCatalogue(): Promise<DraftChangesCatalogue>;
  readSnapshot(): ReturnType<DraftChangesApiService['readSnapshot']>;
}

export async function givenReadingScenario(
  kit: ReadingTestKit,
  input: {
    head: Record<string, JsonValue>;
    draft?: Record<string, JsonValue>;
    schema?: JsonSchema;
    tableId?: string;
    rowId?: string;
  },
): Promise<ReadingScenario> {
  const schema =
    input.schema ?? schemaFor(input.head, input.draft ?? input.head);
  const initial = await givenDraftProjectWithSchema({
    prismaService: kit.prismaService,
    schema,
    tableId: input.tableId,
    row: {
      rowId: input.rowId,
      data: input.head,
      draftData: input.draft ?? input.head,
    },
  });
  const branch = {
    projectId: initial.projectId,
    branchName: initial.branchName,
  };
  const current = { tableId: initial.tableId, rowId: initial.rowId };
  const mutations = createReadingMutations({
    kit,
    branchId: initial.branchId,
    schema,
    current,
  });

  return {
    branch,
    get tableId() {
      return current.tableId;
    },
    get rowId() {
      return current.rowId;
    },
    updateDraftRow: mutations.updateRow,
    patchDraftSchema: mutations.patchSchema,
    renameDraftRow: mutations.renameRow,
    renameDraftTable: mutations.renameTable,
    createDraftRow: mutations.createRow,
    createDraftTable: mutations.createTable,
    tamperDraftRowKeepingHash: (data) =>
      tamperDraftRowKeepingHash({
        prisma: kit.prismaService,
        branchId: initial.branchId,
        tableId: current.tableId,
        rowId: current.rowId,
        data,
      }),
    reuseDraftRowId: mutations.reuseRowId,
    reuseDraftTableId: mutations.reuseTableId,
    updateDraftViews: mutations.updateViews,
    startMigration: mutations.startMigration,
    readCatalogue: async () =>
      requireCatalogue(await readCatalogue(kit.changes, branch)),
    readSnapshot: () => readSnapshot(kit.changes, branch),
  };
}

export function reverseSnapshotSourceOrder(
  snapshot: DraftChangesSnapshot,
): DraftChangesSnapshot {
  const reverseRevision = (
    revision: DraftChangesSnapshot['head'],
  ): DraftChangesSnapshot['head'] => ({
    ...revision,
    tables: [...revision.tables]
      .reverse()
      .map((table) => ({ ...table, rows: [...table.rows].reverse() })),
  });

  return {
    ...snapshot,
    head: reverseRevision(snapshot.head),
    draft: reverseRevision(snapshot.draft),
    fingerprint: snapshot.fingerprint,
  };
}

export async function withReversedSnapshotSourceOrder<T>(
  changes: DraftChangesApiService,
  snapshot: DraftChangesSnapshot,
  read: () => Promise<T>,
): Promise<T> {
  const snapshotRead = jest
    .spyOn(changes, 'readSnapshot')
    .mockResolvedValue(reverseSnapshotSourceOrder(snapshot));
  try {
    return await read();
  } finally {
    snapshotRead.mockRestore();
  }
}

function schemaFor(
  head: Record<string, JsonValue>,
  draft: Record<string, JsonValue>,
): JsonSchema {
  const values = { ...head, ...draft };
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(values),
    properties: Object.fromEntries(
      Object.entries(values).map(([name, value]) => [
        name,
        schemaForValue(value),
      ]),
    ),
  };
}

function schemaForValue(value: JsonValue): JsonSchema {
  if (typeof value === 'number') {
    return { type: 'number', default: 0 };
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean', default: false };
  }
  if (typeof value === 'string' || value === null) {
    return { type: 'string', default: '' };
  }
  if (Array.isArray(value)) {
    return {
      type: 'array',
      items: schemaForValue(value[0] ?? ''),
    };
  }
  const properties = Object.fromEntries(
    Object.entries(value).map(([name, child]) => [name, schemaForValue(child)]),
  );
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}
