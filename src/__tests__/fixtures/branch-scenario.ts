import type {
  JsonPatch,
  JsonSchema,
  Migration,
} from '@revisium/schema-toolkit/types';
import type { BranchScenarioTestKit } from 'src/__tests__/kit/create-branch-scenario-test-kit';
import { createExpressImageFile } from 'src/__tests__/utils/file';
import {
  type BranchGraph,
  prepareBranch,
} from 'src/__tests__/utils/prepareProject';
import type { InputJsonValue, Row } from 'src/engine-prisma-types';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl';
import { ApiRevertChangesCommand } from 'src/features/draft/commands/impl/api-revert-changes.command';
import { InternalUpdateRowCommand } from 'src/features/draft/commands/impl/transactional/internal-update-row.command';
import type { BranchRef } from 'src/features/share/branch-revisions/branch-revision-reader';
import type { HistoryPatches } from 'src/features/share/queries/impl';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import type { TableViewsData } from 'src/features/views/types';
import { draftMigrationOf, pendingMigrationOf } from './stored-ledger';

export interface TableFixture {
  readonly schema: JsonSchema;
  readonly rows?: Readonly<Record<string, InputJsonValue>>;
}

export interface TableIdentity {
  readonly id: string;
  readonly createdId: string;
}

export interface RowColumnsEdit {
  readonly meta?: InputJsonValue;
  readonly schemaHash?: string;
  readonly publishedAt?: string;
}

export class BranchScenario {
  protected constructor(
    protected readonly kit: BranchScenarioTestKit,
    public readonly branch: BranchRef,
    public readonly branchId: string,
  ) {}

  public static async committed(
    kit: BranchScenarioTestKit,
    tables: Readonly<Record<string, TableFixture>>,
  ): Promise<BranchScenario> {
    return BranchScenario.committedOn(
      kit,
      await prepareBranch(kit.prisma),
      tables,
    );
  }

  public static async committedWithoutLedger(
    kit: BranchScenarioTestKit,
    tables: Readonly<Record<string, TableFixture>>,
  ): Promise<BranchScenario> {
    const graph = await prepareBranch(kit.prisma);
    await kit.prisma.table.delete({
      where: { versionId: graph.migrationTableVersionId },
    });

    return BranchScenario.committedOn(kit, graph, tables);
  }

  private static async committedOn(
    kit: BranchScenarioTestKit,
    { projectId, branchName, branchId }: BranchGraph,
    tables: Readonly<Record<string, TableFixture>>,
  ): Promise<BranchScenario> {
    const scenario = new BranchScenario(
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

  public async renameDraftRowBelowNativeValidation(
    tableId: string,
    rowId: string,
    nextRowId: string,
  ): Promise<void> {
    const row = await this.row('draft', tableId, rowId);

    if (row.readonly) {
      throw new Error(`Row ${rowId} of ${tableId} is not owned by the Draft`);
    }

    await this.kit.prisma.row.update({
      where: { versionId: row.versionId },
      data: { id: nextRowId },
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

  public writeDanglingReference(
    tableId: string,
    rowId: string,
    data: InputJsonValue,
  ): Promise<void> {
    return this.writeRowBelowNativeValidation(tableId, rowId, data);
  }

  public writeInvalidRow(
    tableId: string,
    rowId: string,
    data: InputJsonValue,
  ): Promise<void> {
    return this.writeRowBelowNativeValidation(tableId, rowId, data);
  }

  public async writeRowBelowNativeValidation(
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
            publishedAt: columns.publishedAt,
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

  public async writeInvalidViews(
    tableId: string,
    viewsData: TableViewsData,
  ): Promise<void> {
    await this.writeBelowNativeValidation((revisionId) =>
      this.kit.draftRevisionApi.updateRows({
        revisionId,
        tableId: SystemTables.Views,
        rows: [
          { rowId: tableId, data: viewsData as unknown as InputJsonValue },
        ],
      }),
    );
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
    await this.writeBelowNativeValidation((revisionId) =>
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
    const migration = await draftMigrationOf(this, changeType, tableId);

    await this.removeLedgerRow(migration.id);
  }

  public async dropPendingMigration(
    changeType: Migration['changeType'],
    tableId: string,
  ): Promise<void> {
    const migration = await pendingMigrationOf(this, changeType, tableId);

    await this.removeLedgerRow(migration.id);
  }

  public async alterPublishedMigration(
    changeType: Migration['changeType'],
    tableId: string,
    alteration: Partial<Migration>,
  ): Promise<void> {
    const migration = await draftMigrationOf(this, changeType, tableId);

    await this.writeBelowNativeValidation((revisionId) =>
      this.kit.draftRevisionApi.updateRows({
        revisionId,
        tableId: SystemTables.Migration,
        rows: [
          {
            rowId: migration.id,
            data: { ...migration, ...alteration } as unknown as InputJsonValue,
          },
        ],
      }),
    );
  }

  public async exchangeMigrationIds(
    firstId: string,
    secondId: string,
  ): Promise<void> {
    const first = await this.row('draft', SystemTables.Migration, firstId);
    const second = await this.row('draft', SystemTables.Migration, secondId);

    await this.writeBelowNativeValidation((revisionId) =>
      this.kit.draftRevisionApi.updateRows({
        revisionId,
        tableId: SystemTables.Migration,
        rows: [
          { rowId: firstId, data: withMigrationId(first, secondId) },
          { rowId: secondId, data: withMigrationId(second, firstId) },
        ],
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

  public async hasDraftVersion(
    tableId: string,
    rowId: string,
  ): Promise<boolean> {
    const head = await this.row('head', tableId, rowId);
    const draft = await this.row('draft', tableId, rowId);

    return head.versionId !== draft.versionId;
  }

  public async hasChanges(): Promise<boolean> {
    const revision = await this.kit.prisma.revision.findUniqueOrThrow({
      where: { id: await this.draftRevisionId() },
      select: { hasChanges: true },
    });

    return revision.hasChanges;
  }

  public async linkedTableVersionIds(side: RevisionSide): Promise<string[]> {
    const tables = await this.kit.prisma.table.findMany({
      where: { revisions: { some: { id: await this.revisionId(side) } } },
      select: { versionId: true },
      orderBy: { versionId: 'asc' },
    });

    return tables.map(({ versionId }) => versionId);
  }

  public async userTables(side: RevisionSide): Promise<TableIdentity[]> {
    const tables = await this.kit.prisma.table.findMany({
      where: {
        system: false,
        revisions: { some: { id: await this.revisionId(side) } },
      },
      select: { id: true, createdId: true },
    });

    return tables.sort((left, right) => compareCodePoints(left.id, right.id));
  }

  public async rows(side: RevisionSide, tableId: string): Promise<Row[]> {
    const rows = await this.kit.prisma.row.findMany({
      where: {
        tables: {
          some: { versionId: await this.tableVersionId(side, tableId) },
        },
      },
    });

    return rows.sort((left, right) => compareCodePoints(left.id, right.id));
  }

  public async rowIds(side: RevisionSide, tableId: string): Promise<string[]> {
    const rows = await this.kit.prisma.row.findMany({
      where: {
        tables: {
          some: { versionId: await this.tableVersionId(side, tableId) },
        },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    return rows.map(({ id }) => id);
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

  protected async observeCommittedVersions(): Promise<void> {
    this.kit.guard.track(this.branchId);
    await this.kit.guard.verify();
  }

  private draftRevisionId(): Promise<string> {
    return this.revisionId('draft');
  }

  private async removeLedgerRow(rowId: string): Promise<void> {
    await this.writeBelowNativeValidation((revisionId) =>
      this.kit.draftRevisionApi.removeRows({
        revisionId,
        tableId: SystemTables.Migration,
        rowIds: [rowId],
      }),
    );
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
}

function withMigrationId(row: Row, id: string): InputJsonValue {
  return { ...(row.data as unknown as Migration), id } as InputJsonValue;
}

function revisionFlagOf(side: RevisionSide) {
  if (side === 'head') {
    return { isHead: true };
  }

  return { isDraft: true };
}
