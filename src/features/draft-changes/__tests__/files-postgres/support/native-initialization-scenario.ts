import { Readable } from 'node:stream';
import type { JsonSchema, JsonValue } from '@revisium/schema-toolkit/types';
import {
  getObjectSchema,
  getRefSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { givenDraftProjectWithSchema } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { DraftChangesApiService } from 'src/features/draft-changes/draft-changes-api.service';
import { DraftChangesModule } from 'src/features/draft-changes/draft-changes.module';
import { DraftRevisionApiService } from 'src/features/draft-revision/draft-revision-api.service';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { setJsonPath } from 'src/features/draft-changes/schema/json-value-path';
import type {
  BuildDraftChangesCatalogueResult,
  DraftChangesCatalogue,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { ResolveCandidateDependenciesResult } from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import type { PrepareCandidateFilesResult } from 'src/features/draft-changes/queries/impl/prepare-candidate-files.query';
import type { HistoryPatches } from 'src/features/share/queries/impl/transactional/get-table-schema.query';
import { STORAGE_SERVICE } from 'src/infrastructure/storage/storage.interface';
import type { createStorageMock } from 'src/__tests__/kit/storage.mock';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { formulaField } from 'src/features/draft-changes/__tests__/formulas/support/formula-candidate';

export async function createNativeFileInitializationScenario() {
  const kit = await createDraftTestKit({
    imports: [DraftChangesModule],
    migrationOptions: { workerMode: 'disabled' },
  });
  const changes = kit.module.get(DraftChangesApiService);
  const draftRevisionApi = kit.module.get(DraftRevisionApiService);
  const storage =
    kit.module.get<ReturnType<typeof createStorageMock>>(STORAGE_SERVICE);
  const fixture = await givenDraftProjectWithSchema({
    prismaService: kit.prismaService,
    schema: getObjectSchema({ caption: getStringSchema() }),
    tableId: 'documents',
    row: { rowId: 'document', data: { caption: 'Head caption' } },
  });

  const location: { revisionId: string; tableId: string } = {
    revisionId: fixture.draftRevisionId,
    tableId: fixture.tableId,
  };

  async function addAttachment() {
    await kit.draftApiService.apiUpdateTable({
      ...location,
      patches: [
        {
          op: 'add',
          path: '/properties/attachment',
          value: getRefSchema(SystemSchemaIds.File),
        },
      ],
    });
    return readDraftAttachment();
  }

  async function addAttachmentStatusFormula() {
    const ready = await addAttachment();
    await kit.draftApiService.apiUpdateTable({
      ...location,
      patches: [
        {
          op: 'add',
          path: '/properties/fileStatus',
          value: formulaField('string', 'attachment.status', '') as JsonSchema,
        },
      ],
    });
    return ready;
  }

  async function moveAttachment() {
    await kit.draftApiService.apiUpdateTable({
      ...location,
      patches: [
        {
          op: 'move',
          from: '/properties/attachment',
          path: '/properties/asset',
        },
      ],
    });
    return readDraftAsset();
  }

  async function uploadAttachment(fileId: string) {
    await kit.draftApiService.apiUploadFile({
      ...location,
      rowId: fixture.rowId,
      fileId,
      file: {
        fieldname: 'file',
        originalname: 'proof.txt',
        encoding: '7bit',
        mimetype: 'text/plain',
        size: 5,
        buffer: Buffer.from('proof'),
        destination: '',
        filename: 'proof.txt',
        path: '',
        stream: Readable.from(Buffer.from('proof')),
      },
    });
    return readDraftAttachment();
  }

  async function uploadFileAtPath(
    fileId: string,
    path: 'attachment' | 'asset',
    contents = 'proof',
  ) {
    const buffer = Buffer.from(contents);
    await kit.draftApiService.apiUploadFile({
      ...location,
      rowId: fixture.rowId,
      fileId,
      file: {
        fieldname: 'file',
        originalname: 'proof.txt',
        encoding: '7bit',
        mimetype: 'text/plain',
        size: buffer.length,
        buffer,
        destination: '',
        filename: 'proof.txt',
        path: '',
        stream: Readable.from(buffer),
      },
    });
    const snapshot = await readSnapshot();
    const row = findRow(snapshot.draft, fixture.tableId, fixture.rowId);
    return { row, value: readFileValue(row.data, path) };
  }

  async function promoteCurrentDraftToHead() {
    const snapshot = await readSnapshot();
    return kit.transactionService.runSerializable(async () => {
      await draftRevisionApi.writeState({
        revisionId: location.revisionId,
        candidate: { tables: snapshot.draft.tables } as DraftRevisionState,
        sources: {
          head: { tables: snapshot.head.tables } as DraftRevisionState,
          others: [{ tables: snapshot.draft.tables } as DraftRevisionState],
        },
      });
      const committed = await draftRevisionApi.commit({
        branchId: fixture.branchId,
        comment: 'Stage 8 source alternative fixture',
      });
      location.revisionId = committed.nextDraftRevisionId;
      fixture.draftRevisionId = committed.nextDraftRevisionId;
      return readSnapshot();
    });
  }

  async function readDraftAttachment() {
    const snapshot = await readSnapshot();
    const row = findRow(snapshot.draft, fixture.tableId, fixture.rowId);
    return {
      row,
      value: readFileValue(row.data, 'attachment'),
    };
  }

  async function readDraftAsset() {
    const snapshot = await readSnapshot();
    const row = findRow(snapshot.draft, fixture.tableId, fixture.rowId);
    return { row, value: readFileValue(row.data, 'asset') };
  }

  async function readSnapshot(): Promise<DraftChangesSnapshot> {
    return changes.readSnapshot({
      projectId: fixture.projectId,
      branchName: fixture.branchName,
    });
  }

  async function projectSchemaAndCandidates(
    path: string | string[],
    excludedRowPath?: string,
  ) {
    const snapshot = await readSnapshot();
    const table = findTable(snapshot.draft.tables, fixture.tableId);
    const catalogueProjection = await changes.projectSchema({
      snapshot,
      tableCreatedId: table.createdId,
      operation: 'commit',
      effects: [],
    });
    if (catalogueProjection.status !== 'projected') {
      return {
        snapshot,
        projection: catalogueProjection,
        catalogue: undefined,
        selection: undefined,
        candidates: undefined,
        dependencies: undefined,
      };
    }

    const built = await changes.buildCatalogue({
      snapshot,
      schemaProjections: [
        { tableCreatedId: table.createdId, projection: catalogueProjection },
      ],
    });
    const catalogue = requireCatalogue(built);
    const resolved = await changes.resolveSelection({
      catalogue,
      selection: {
        include: [
          {
            kind: 'schemaFields',
            tableId: fixture.tableId,
            paths: Array.isArray(path) ? path : [path],
          },
        ],
        ...(excludedRowPath
          ? {
              exclude: [
                {
                  kind: 'rowFields' as const,
                  tableId: fixture.tableId,
                  rowId: fixture.rowId,
                  paths: [excludedRowPath],
                },
              ],
            }
          : {}),
      },
    });
    if (resolved.status !== 'resolved') {
      return {
        snapshot,
        projection: catalogueProjection,
        catalogue,
        selection: resolved,
        candidates: undefined,
        dependencies: undefined,
      };
    }

    const selectedEffects = resolved.selected.flatMap(
      ({ effectRefs }) => effectRefs ?? [],
    );
    const projection = await changes.projectSchema({
      snapshot,
      tableCreatedId: table.createdId,
      operation: 'commit',
      effects: selectedEffects,
    });

    const input = {
      snapshot,
      operation: 'commit' as const,
      mode: 'selected' as const,
      catalogue,
      selection: resolved,
    };
    const candidates = await changes.calculateDataCandidates(input);
    const dependencies = await changes.resolveCandidateDependencies(input);
    return {
      snapshot,
      projection,
      catalogue,
      selection: resolved,
      candidates,
      dependencies,
    };
  }

  async function discardCandidatesAtRowPath(path: string) {
    const snapshot = await readSnapshot();
    const table = findTable(snapshot.draft.tables, fixture.tableId);
    const catalogueProjection = await changes.projectSchema({
      snapshot,
      tableCreatedId: table.createdId,
      operation: 'commit',
      effects: [],
    });
    if (catalogueProjection.status !== 'projected') {
      throw new Error('Expected the current schema projection.');
    }
    const catalogue = requireCatalogue(
      await changes.buildCatalogue({
        snapshot,
        schemaProjections: [
          { tableCreatedId: table.createdId, projection: catalogueProjection },
        ],
      }),
    );
    const selection = await changes.resolveSelection({
      catalogue,
      selection: {
        include: [
          {
            kind: 'rowFields',
            tableId: fixture.tableId,
            rowId: fixture.rowId,
            paths: [path],
          },
        ],
      },
    });
    if (selection.status !== 'resolved') {
      throw new Error('Expected the native row selection to resolve.');
    }
    const input = {
      snapshot,
      operation: 'discard' as const,
      mode: 'selected' as const,
      catalogue,
      selection,
    };
    return {
      snapshot,
      candidates: await changes.calculateDataCandidates(input),
      dependencies: await changes.resolveCandidateDependencies(input),
    };
  }

  async function readSchemaHistory(): Promise<HistoryPatches[]> {
    const snapshot = await readSnapshot();
    const schemaTable = findTable(snapshot.draft.tables, SystemTables.Schema);
    const schemaRow = schemaTable.rows.find(({ id }) => id === fixture.tableId);
    if (!schemaRow || !Array.isArray(schemaRow.meta)) {
      throw new Error('Expected persisted Draft schema history.');
    }
    return schemaRow.meta as unknown as HistoryPatches[];
  }

  async function projectNativeAddOnly() {
    const snapshot = await readSnapshot();
    const history = await readSchemaHistory();
    const addHistoryIndex = history.findIndex(({ patches }) =>
      patches.some(
        (patch) =>
          patch.op === 'add' && patch.path === '/properties/attachment',
      ),
    );
    if (addHistoryIndex < 0) {
      throw new Error('Expected native ADD effect in persisted history.');
    }
    const addPatchIndex = history[addHistoryIndex]?.patches.findIndex(
      (patch) => patch.op === 'add' && patch.path === '/properties/attachment',
    );
    if (addPatchIndex === undefined || addPatchIndex < 0) {
      throw new Error('Expected persisted native ADD patch.');
    }
    const table = findTable(snapshot.draft.tables, fixture.tableId);
    return {
      snapshot,
      history,
      effect: { historyIndex: addHistoryIndex, patchIndex: addPatchIndex },
      projection: await changes.projectSchema({
        snapshot,
        tableCreatedId: table.createdId,
        operation: 'commit',
        effects: [{ historyIndex: addHistoryIndex, patchIndex: addPatchIndex }],
      }),
    };
  }

  async function prepareMovedAddOnlySlot(): Promise<
    Extract<PrepareCandidateFilesResult, { status: 'prepared' }>
  > {
    const added = await projectNativeAddOnly();
    if (added.projection.status !== 'projected') {
      throw new Error('Expected the persisted file ADD projection.');
    }

    const head: DraftRevisionState = {
      tables: structuredClone(added.snapshot.head.tables),
    };
    const draft: DraftRevisionState = {
      tables: structuredClone(added.snapshot.draft.tables),
    };
    const schemaRow = findRow(head, SystemTables.Schema, fixture.tableId);
    schemaRow.data = structuredClone(added.projection.head.schema) as JsonValue;
    const headTable = findTable(head.tables, fixture.tableId);
    for (const projectedRow of added.projection.head.rows) {
      const row = headTable.rows.find(
        ({ createdId }) => createdId === projectedRow.createdId,
      );
      if (!row) {
        throw new Error(
          `Expected projected Head row '${projectedRow.createdId}'.`,
        );
      }
      row.data = structuredClone(projectedRow.data);
    }

    const headRow = findRow(head, fixture.tableId, fixture.rowId);
    const emptySlot = setJsonPath(
      headRow.data as JsonValue,
      '/attachment/fileId',
      '',
    );
    if (!emptySlot.representable) {
      throw new Error('Expected projected Head file slot at /attachment.');
    }
    headRow.data = emptySlot.value;

    const prepared = await changes.prepareCandidateFiles({
      snapshot: added.snapshot,
      head,
      draft,
      schemaProjectionBindings: [
        {
          tableCreatedId: findTable(draft.tables, fixture.tableId).createdId,
          sourceFingerprint: added.projection.sourceFingerprint,
          operation: 'commit',
          selectedEffects: added.projection.selectedEffects,
          fileSlots: added.projection.fileSlots ?? [],
          rowFieldMappings: added.projection.rowFieldMappings,
          rowTargetFieldMappings: added.projection.rowTargetFieldMappings,
        },
      ],
    });
    if (prepared.status !== 'prepared') {
      throw new Error('Expected the projected file slot to initialize.');
    }
    return prepared;
  }

  return {
    fixture,
    kit,
    storage,
    changes,
    addAttachment,
    addAttachmentStatusFormula,
    moveAttachment,
    uploadAttachment,
    uploadFileAtPath,
    promoteCurrentDraftToHead,
    readSnapshot,
    projectSchemaAndCandidates,
    discardCandidatesAtRowPath,
    readSchemaHistory,
    projectNativeAddOnly,
    prepareMovedAddOnlySlot,
    prepareCandidateFiles(
      snapshot: DraftChangesSnapshot,
      result: ResolveCandidateDependenciesResult,
    ) {
      if (result.status !== 'resolved') {
        throw new Error('Expected resolved candidates for file preparation.');
      }
      return changes.prepareCandidateFiles({
        snapshot,
        head: result.head,
        draft: result.draft,
        schemaProjectionBindings: result.schemaProjectionBindings,
      });
    },
    async close() {
      await kit.close();
    },
  };
}

function findTable<T extends { id: string }>(tables: T[], tableId: string): T {
  const table = tables.find(({ id }) => id === tableId);
  if (!table) {
    throw new Error(`Expected table '${tableId}'.`);
  }
  return table;
}

function findRow<T extends { id: string }>(
  state: { tables: Array<{ id: string; rows: T[] }> },
  tableId: string,
  rowId: string,
): T {
  const table = findTable(state.tables, tableId);
  const row = table.rows.find(({ id }) => id === rowId);
  if (!row) {
    throw new Error(`Expected row '${rowId}'.`);
  }
  return row;
}

function readFileValue(data: unknown, key: string) {
  const value = (data as Record<string, unknown>)[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected file value at '${key}'.`);
  }
  return value as Record<string, unknown>;
}

function requireCatalogue(
  result: BuildDraftChangesCatalogueResult,
): DraftChangesCatalogue {
  if (result.status !== 'catalogued') {
    throw new Error(`Expected catalogue: ${JSON.stringify(result.blockers)}`);
  }
  return result.catalogue;
}
