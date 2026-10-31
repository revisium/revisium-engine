import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { prepareBranch } from 'src/__tests__/utils/prepareProject';
import type { InputJsonValue, Row } from 'src/engine-prisma-types';
import { InternalUpdateRowCommand } from 'src/features/draft/commands/impl/transactional/internal-update-row.command';
import type {
  ChangesBranch,
  ChangesSnapshot,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';
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
    const { projectId, branchName, branchId } = await prepareBranch(kit.prisma);
    const scenario = new ChangesScenario(
      kit,
      { projectId, branchName },
      branchId,
    );

    for (const [tableId, fixture] of Object.entries(tables)) {
      await scenario.createTable(tableId, fixture.schema);
      await scenario.createRows(tableId, fixture.rows ?? {});
    }

    await scenario.commitNatively();
    await scenario.observeCommittedVersions();

    return scenario;
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
    const revisionId = await this.draftRevisionId();

    await this.kit.draftWriteAdmission.runSerializableRevisionWrite(
      revisionId,
      async () => {
        await this.kit.draftRevisionApi.createTable({
          revisionId,
          tableId: SystemTables.SharedSchemas,
          system: true,
        });
        await this.kit.draftRevisionApi.createRows({
          revisionId,
          tableId: SystemTables.SharedSchemas,
          rows: [{ rowId: id, data: schema as InputJsonValue }],
        });
      },
    );
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

  private draftRevisionId(): Promise<string> {
    return this.revisionId('draft');
  }

  private async revisionId(side: RevisionSide): Promise<string> {
    const revision = await this.kit.prisma.revision.findFirstOrThrow({
      where: { branchId: this.branchId, ...revisionFlagOf(side) },
      select: { id: true },
    });

    return revision.id;
  }

  private async commitNatively(): Promise<void> {
    await this.kit.draftApi.apiCreateRevision(this.branch);
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
