import type {
  JsonPatch,
  JsonSchema,
  Migration,
} from '@revisium/schema-toolkit/types';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { createExpressImageFile } from 'src/__tests__/utils/file';
import {
  type BranchGraph,
  prepareBranch,
} from 'src/__tests__/utils/prepareProject';
import type { InputJsonValue, Row } from 'src/engine-prisma-types';
import { ApiRevertChangesCommand } from 'src/features/draft/commands/impl/api-revert-changes.command';
import { InternalUpdateRowCommand } from 'src/features/draft/commands/impl/transactional/internal-update-row.command';
import type { ChangeOperation } from 'src/features/partial-changes/assembly/outcome-rules';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import type {
  ChangesBranch,
  ChangesSnapshot,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { HistoryPatches } from 'src/features/share/queries/impl';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';
import {
  type CatalogueView,
  readCatalogue,
  readWholeDraftCatalogue,
} from './catalogue-reading';
import { type ClosureView, readClosedDependencies } from './dependency-closing';
import {
  readScopedCatalogue,
  type ScopedCatalogueView,
} from './scoped-reading';
import {
  readSelectionResolution,
  type ResolutionView,
} from './selection-resolving';
import { readAssembledTarget, type TargetView } from './target-assembling';
import {
  type ChangedRowsView,
  readChangedRows,
  readInPlanningTransaction,
  type RevisionSide,
} from './snapshot-reading';

export interface TableFixture {
  readonly schema: JsonSchema;
  readonly rows?: Readonly<Record<string, InputJsonValue>>;
}

export interface RowColumnsEdit {
  readonly meta?: InputJsonValue;
  readonly schemaHash?: string;
}

export class ChangesScenario {
  private constructor(
    private readonly kit: PartialChangesTestKit,
    public readonly branch: ChangesBranch,
    public readonly branchId: string,
  ) {}

  public static async committed(
    kit: PartialChangesTestKit,
    tables: Readonly<Record<string, TableFixture>>,
  ): Promise<ChangesScenario> {
    return ChangesScenario.committedOn(
      kit,
      await prepareBranch(kit.prisma),
      tables,
    );
  }

  public static async committedWithoutLedger(
    kit: PartialChangesTestKit,
    tables: Readonly<Record<string, TableFixture>>,
  ): Promise<ChangesScenario> {
    const graph = await prepareBranch(kit.prisma);
    await kit.prisma.table.delete({
      where: { versionId: graph.migrationTableVersionId },
    });

    return ChangesScenario.committedOn(kit, graph, tables);
  }

  private static async committedOn(
    kit: PartialChangesTestKit,
    { projectId, branchName, branchId }: BranchGraph,
    tables: Readonly<Record<string, TableFixture>>,
  ): Promise<ChangesScenario> {
    const scenario = new ChangesScenario(
      kit,
      { projectId, branchName },
      branchId,
    );

    for (const [tableId, fixture] of Object.entries(tables)) {
      await scenario.createTable(tableId, fixture.schema);
      await scenario.createRows(tableId, fixture.rows ?? {});
    }

    await scenario.commit();

    return scenario;
  }

  public async commit(): Promise<void> {
    await this.kit.draftApi.apiCreateRevision(this.branch);
    await this.observeCommittedVersions();
  }

  public async revertNatively(): Promise<void> {
    await this.kit.commandBus.execute(new ApiRevertChangesCommand(this.branch));
  }

  public async createTable(tableId: string, schema: JsonSchema): Promise<void> {
    await this.kit.draftApi.apiCreateTable({
      revisionId: await this.draftRevisionId(),
      tableId,
      schema: schema as InputJsonValue,
    });
  }

  public async updateTable(
    tableId: string,
    patches: JsonPatch[],
  ): Promise<void> {
    await this.kit.draftApi.apiUpdateTable({
      revisionId: await this.draftRevisionId(),
      tableId,
      patches,
    });
  }

  public async renameTable(
    tableId: string,
    nextTableId: string,
  ): Promise<void> {
    await this.kit.draftApi.apiRenameTable({
      revisionId: await this.draftRevisionId(),
      tableId,
      nextTableId,
    });
  }

  public async removeTable(tableId: string): Promise<void> {
    await this.kit.draftApi.apiRemoveTable({
      revisionId: await this.draftRevisionId(),
      tableId,
    });
  }

  public async createRows(
    tableId: string,
    rows: Readonly<Record<string, InputJsonValue>>,
  ): Promise<void> {
    const entries = Object.entries(rows);

    if (entries.length === 0) {
      return;
    }

    await this.kit.draftApi.apiCreateRows({
      revisionId: await this.draftRevisionId(),
      tableId,
      rows: entries.map(([rowId, data]) => ({ rowId, data })),
    });
  }

  public async updateRow(
    tableId: string,
    rowId: string,
    data: InputJsonValue,
  ): Promise<void> {
    await this.kit.draftApi.apiUpdateRow({
      revisionId: await this.draftRevisionId(),
      tableId,
      rowId,
      data,
    });
  }

  public async renameRow(
    tableId: string,
    rowId: string,
    nextRowId: string,
  ): Promise<void> {
    await this.kit.draftApi.apiRenameRow({
      revisionId: await this.draftRevisionId(),
      tableId,
      rowId,
      nextRowId,
    });
  }

  public async removeRow(tableId: string, rowId: string): Promise<void> {
    await this.kit.draftApi.apiRemoveRow({
      revisionId: await this.draftRevisionId(),
      tableId,
      rowId,
    });
  }

  public async removeReferencedRows(
    tableId: string,
    rowIds: readonly string[],
  ): Promise<void> {
    await this.writeBelowNativeValidation((revisionId) =>
      this.kit.draftRevisionApi.removeRows({
        revisionId,
        tableId,
        rowIds: [...rowIds],
      }),
    );
  }

  public async writeDanglingReference(
    tableId: string,
    rowId: string,
    data: InputJsonValue,
  ): Promise<void> {
    await this.writeBelowNativeValidation((revisionId) =>
      this.kit.draftRevisionApi.updateRows({
        revisionId,
        tableId,
        rows: [{ rowId, data }],
      }),
    );
  }

  public async uploadFile(
    tableId: string,
    rowId: string,
    field: string,
  ): Promise<void> {
    const row = await this.row('draft', tableId, rowId);
    const data = row.data as Record<string, { fileId: string }>;

    await this.kit.draftApi.apiUploadFile({
      revisionId: await this.draftRevisionId(),
      tableId,
      rowId,
      fileId: data[field]?.fileId ?? '',
      file: createExpressImageFile(),
    });
  }

  public async writeRowColumns(
    tableId: string,
    rowId: string,
    columns: RowColumnsEdit,
  ): Promise<void> {
    const revisionId = await this.draftRevisionId();
    const row = await this.row('draft', tableId, rowId);

    await this.kit.draftWriteAdmission.runSerializableRevisionWrite(
      revisionId,
      () =>
        this.kit.commandBus.execute(
          new InternalUpdateRowCommand({
            revisionId,
            tableId,
            rowId,
            data: row.data as InputJsonValue,
            schemaHash: columns.schemaHash ?? row.schemaHash,
            meta: columns.meta,
          }),
        ),
    );
  }

  public async updateViews(
    tableId: string,
    viewsData: TableViewsData,
  ): Promise<void> {
    await this.kit.viewsApi.updateTableViews({
      revisionId: await this.draftRevisionId(),
      tableId,
      viewsData,
    });
  }

  public async createSharedSchema(
    id: string,
    schema: JsonSchema,
  ): Promise<void> {
    const hasSharedSchemas = await this.hasTable(
      'draft',
      SystemTables.SharedSchemas,
    );

    await this.writeBelowNativeValidation(async (revisionId) => {
      if (!hasSharedSchemas) {
        await this.kit.draftRevisionApi.createTable({
          revisionId,
          tableId: SystemTables.SharedSchemas,
          system: true,
        });
      }

      await this.kit.draftRevisionApi.createRows({
        revisionId,
        tableId: SystemTables.SharedSchemas,
        rows: [{ rowId: id, data: schema as InputJsonValue }],
      });
    });
  }

  public async updateSharedSchema(
    id: string,
    schema: JsonSchema,
  ): Promise<void> {
    await this.writeBelowNativeValidation((revisionId) =>
      this.kit.draftRevisionApi.updateRows({
        revisionId,
        tableId: SystemTables.SharedSchemas,
        rows: [{ rowId: id, data: schema as InputJsonValue }],
      }),
    );
  }

  public async renameSharedSchema(id: string, nextId: string): Promise<void> {
    await this.writeBelowNativeValidation((revisionId) =>
      this.kit.draftRevisionApi.renameRows({
        revisionId,
        tableId: SystemTables.SharedSchemas,
        renames: [{ rowId: id, nextRowId: nextId }],
      }),
    );
  }

  public async removeSharedSchema(id: string): Promise<void> {
    await this.writeBelowNativeValidation((revisionId) =>
      this.kit.draftRevisionApi.removeRows({
        revisionId,
        tableId: SystemTables.SharedSchemas,
        rowIds: [id],
      }),
    );
  }

  public async recordPendingMigration(migration: Migration): Promise<void> {
    const revisionId = await this.draftRevisionId();

    await this.kit.draftWriteAdmission.runSerializableRevisionWrite(
      revisionId,
      () =>
        this.kit.draftRevisionApi.createRows({
          revisionId,
          tableId: SystemTables.Migration,
          rows: [
            {
              rowId: migration.id,
              data: migration as unknown as InputJsonValue,
            },
          ],
        }),
    );
  }

  public async dropFromDraftLedger(
    changeType: Migration['changeType'],
    tableId: string,
  ): Promise<void> {
    const revisionId = await this.draftRevisionId();
    const migration = await this.draftMigrationOf(changeType, tableId);

    await this.kit.draftWriteAdmission.runSerializableRevisionWrite(
      revisionId,
      () =>
        this.kit.draftRevisionApi.removeRows({
          revisionId,
          tableId: SystemTables.Migration,
          rowIds: [migration.id],
        }),
    );
  }

  public async rewriteSchemaHistory(
    tableId: string,
    history: readonly HistoryPatches[],
  ): Promise<void> {
    await this.writeRowColumns(SystemTables.Schema, tableId, {
      meta: history as unknown as InputJsonValue,
    });
  }

  public readSnapshot(): Promise<ChangesSnapshot> {
    return readInPlanningTransaction(this.kit, () =>
      this.kit.snapshotReader.readSnapshot(this.branch),
    );
  }

  public readChangedRows(
    tableIds: readonly string[],
  ): Promise<ChangedRowsView> {
    return readChangedRows(this.kit, this.branch, tableIds);
  }

  public readCatalogue(tableIds: readonly string[]): Promise<CatalogueView> {
    return readCatalogue(this.kit, this.branch, tableIds);
  }

  public readWholeDraftCatalogue(): Promise<CatalogueView> {
    return readWholeDraftCatalogue(this.kit, this.branch);
  }

  public readScopedCatalogue(
    selection: Selection,
  ): Promise<ScopedCatalogueView> {
    return readScopedCatalogue(this.kit, this.branch, selection);
  }

  public resolveSelection(selection: Selection): Promise<ResolutionView> {
    return readSelectionResolution(this.kit, this.branch, selection);
  }

  public assembleTarget(
    operation: ChangeOperation,
    selection: Selection,
  ): Promise<TargetView> {
    return readAssembledTarget(this.kit, this.branch, operation, selection);
  }

  public closeDependencies(
    operation: ChangeOperation,
    selection: Selection,
  ): Promise<ClosureView> {
    return readClosedDependencies(this.kit, this.branch, operation, selection);
  }

  public async readDraftRowDigest(tableId: string): Promise<string> {
    const tableVersionId = await this.tableVersionId('draft', tableId);

    return readInPlanningTransaction(this.kit, () =>
      this.kit.snapshotReader.readRowDigest(tableVersionId),
    );
  }

  public async hasDraftVersion(
    tableId: string,
    rowId: string,
  ): Promise<boolean> {
    const head = await this.row('head', tableId, rowId);
    const draft = await this.row('draft', tableId, rowId);

    return head.versionId !== draft.versionId;
  }

  public async hasTable(side: RevisionSide, tableId: string): Promise<boolean> {
    const table = await this.kit.prisma.table.findFirst({
      where: {
        id: tableId,
        revisions: { some: { id: await this.revisionId(side) } },
      },
      select: { versionId: true },
    });

    return table !== null;
  }

  public async row(
    side: RevisionSide,
    tableId: string,
    rowId: string,
  ): Promise<Row> {
    return this.kit.prisma.row.findFirstOrThrow({
      where: {
        id: rowId,
        tables: {
          some: { versionId: await this.tableVersionId(side, tableId) },
        },
      },
    });
  }

  public async tableVersionId(
    side: RevisionSide,
    tableId: string,
  ): Promise<string> {
    const table = await this.kit.prisma.table.findFirstOrThrow({
      where: {
        id: tableId,
        revisions: { some: { id: await this.revisionId(side) } },
      },
      select: { versionId: true },
    });

    return table.versionId;
  }

  public async revisionId(side: RevisionSide): Promise<string> {
    const revision = await this.kit.prisma.revision.findFirstOrThrow({
      where: { branchId: this.branchId, ...revisionFlagOf(side) },
      select: { id: true },
    });

    return revision.id;
  }

  private draftRevisionId(): Promise<string> {
    return this.revisionId('draft');
  }

  private async writeBelowNativeValidation(
    write: (revisionId: string) => Promise<unknown>,
  ): Promise<void> {
    const revisionId = await this.draftRevisionId();

    await this.kit.draftWriteAdmission.runSerializableRevisionWrite(
      revisionId,
      () => write(revisionId),
    );
  }

  private async draftMigrationOf(
    changeType: Migration['changeType'],
    tableId: string,
  ): Promise<Migration> {
    const ledger = await this.draftLedger();
    const migration = ledger.find(
      (candidate) =>
        candidate.changeType === changeType && candidate.tableId === tableId,
    );

    if (!migration) {
      throw new Error(`The Draft ledger has no ${changeType} of ${tableId}`);
    }

    return migration;
  }

  private async draftLedger(): Promise<Migration[]> {
    const ledgerTableVersionId = await this.tableVersionId(
      'draft',
      SystemTables.Migration,
    );
    const rows = await this.kit.prisma.row.findMany({
      where: { tables: { some: { versionId: ledgerTableVersionId } } },
    });

    return rows.map(({ data }) => data as unknown as Migration);
  }

  private async observeCommittedVersions(): Promise<void> {
    this.kit.guard.track(this.branchId);
    await this.kit.guard.verify();
  }
}

function revisionFlagOf(side: RevisionSide) {
  if (side === 'head') {
    return { isHead: true };
  }

  return { isDraft: true };
}
