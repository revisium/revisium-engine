import type {
  JsonPatch,
  JsonSchema,
  Migration,
} from '@revisium/schema-toolkit/types';
import type { InputJsonValue } from 'src/engine-prisma-types';
import { DraftRevisionApiService } from 'src/features/draft-revision/draft-revision-api.service';
import { GetMigrationsQuery } from 'src/features/revision/queries/impl/get-migrations.query';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';
import { ViewsApiService } from 'src/features/views/views-api.service';
import {
  createExpressFile,
  createExpressImageFile,
} from 'src/__tests__/utils/file';
import { prepareBranch } from 'src/__tests__/utils/prepareProject';
import { ApiRevertChangesCommand } from 'src/features/draft/commands/impl/api-revert-changes.command';
import {
  ApplyChangesResult,
  ChangeOperation,
  ChangesBranch,
  ListChangesResult,
  ListedUnit,
  PreviewChangesResult,
  Selection,
} from 'src/features/partial-changes-poc/partial-changes.types';
import type { PartialChangesTestKit } from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';

export type TableFixture = {
  schema: JsonSchema;
  rows?: Record<string, InputJsonValue>;
};

export type StoredRow = {
  versionId: string;
  createdId: string;
  id: string;
  readonly: boolean;
  data: Record<string, unknown>;
  hash: string;
  schemaHash: string;
};

type RevisionRole = 'head' | 'draft';

export class ChangesScenario {
  private constructor(
    private readonly kit: PartialChangesTestKit,
    public readonly branch: ChangesBranch & { branchId: string },
  ) {}

  static async committed(
    kit: PartialChangesTestKit,
    tables: Record<string, TableFixture>,
    beforeCommit?: (scenario: ChangesScenario) => Promise<void>,
  ): Promise<ChangesScenario> {
    const graph = await prepareBranch(kit.prisma);
    const scenario = new ChangesScenario(kit, {
      projectId: graph.projectId,
      branchName: graph.branchName,
      branchId: graph.branchId,
    });
    kit.guard.track(graph.branchId);

    for (const [tableId, fixture] of Object.entries(tables)) {
      await scenario.createTable(tableId, fixture.schema);
      for (const [rowId, data] of Object.entries(fixture.rows ?? {})) {
        await scenario.createRow(tableId, rowId, data);
      }
    }

    await beforeCommit?.(scenario);
    await scenario.commitNatively();
    return scenario;
  }

  async headRevisionId(): Promise<string> {
    return (await this.revision('head')).id;
  }

  async headComment(): Promise<string | null> {
    return (await this.revision('head')).comment;
  }

  async draftRevisionId(): Promise<string> {
    return (await this.revision('draft')).id;
  }

  async draftHasChanges(): Promise<boolean> {
    return (await this.revision('draft')).hasChanges;
  }

  async revisionCount(): Promise<number> {
    return this.kit.prisma.revision.count({
      where: { branchId: this.branch.branchId },
    });
  }

  async createTable(tableId: string, schema: JsonSchema): Promise<void> {
    await this.kit.draftApi.apiCreateTable({
      revisionId: await this.draftRevisionId(),
      tableId,
      schema: schema as InputJsonValue,
    });
  }

  async addField(
    tableId: string,
    field: string,
    schema: JsonSchema,
  ): Promise<void> {
    await this.kit.draftApi.apiUpdateTable({
      revisionId: await this.draftRevisionId(),
      tableId,
      patches: [{ op: 'add', path: `/properties/${field}`, value: schema }],
    });
  }

  async updateTable(tableId: string, patches: JsonPatch[]): Promise<void> {
    await this.kit.draftApi.apiUpdateTable({
      revisionId: await this.draftRevisionId(),
      tableId,
      patches,
    });
  }

  async startBackgroundUpdate(
    tableId: string,
    patches: JsonPatch[],
  ): Promise<string> {
    const result = await this.kit.draftApi.apiUpdateTable({
      revisionId: await this.draftRevisionId(),
      tableId,
      patches,
    });
    if (!result.migrationId) {
      throw new Error(`The update of ${tableId} did not start a migration`);
    }
    return result.migrationId;
  }

  async removeField(tableId: string, field: string): Promise<void> {
    await this.updateTable(tableId, [
      { op: 'remove', path: `/properties/${field}` },
    ]);
  }

  async renameTable(tableId: string, nextTableId: string): Promise<void> {
    await this.kit.draftApi.apiRenameTable({
      revisionId: await this.draftRevisionId(),
      tableId,
      nextTableId,
    });
  }

  async removeTable(tableId: string): Promise<void> {
    await this.kit.draftApi.apiRemoveTable({
      revisionId: await this.draftRevisionId(),
      tableId,
    });
  }

  async updateViews(tableId: string, viewsData: TableViewsData): Promise<void> {
    await this.kit.module.get(ViewsApiService).updateTableViews({
      revisionId: await this.draftRevisionId(),
      tableId,
      viewsData,
    });
  }

  async putSharedSchema(id: string, schema: JsonSchema): Promise<void> {
    const revisionId = await this.draftRevisionId();
    const existing = await this.systemRows('draft', SystemTables.SharedSchemas);
    const transactions = this.kit.module.get(TransactionPrismaService);
    const draftRevisions = this.kit.module.get(DraftRevisionApiService);
    const rows = [{ rowId: id, data: schema as InputJsonValue }];

    await transactions.run(async () => {
      if (!(await this.hasTable('draft', SystemTables.SharedSchemas))) {
        await draftRevisions.createTable({
          revisionId,
          tableId: SystemTables.SharedSchemas,
          system: true,
        });
      }
      if (existing.some((row) => row.id === id)) {
        await draftRevisions.updateRows({
          revisionId,
          tableId: SystemTables.SharedSchemas,
          rows,
        });
      } else {
        await draftRevisions.createRows({
          revisionId,
          tableId: SystemTables.SharedSchemas,
          rows,
        });
      }
    });
  }

  async sharedSchemas(role: RevisionRole): Promise<Record<string, unknown>> {
    const rows = await this.systemRows(role, SystemTables.SharedSchemas);
    return Object.fromEntries(rows.map((row) => [row.id, row.data]));
  }

  async views(
    role: RevisionRole,
    tableId: string,
  ): Promise<TableViewsData | undefined> {
    const rows = await this.systemRows(role, SystemTables.Views);
    return rows.find((row) => row.id === tableId)?.data as
      | TableViewsData
      | undefined;
  }

  async ledger(role: RevisionRole): Promise<Migration[]> {
    return this.kit.queryBus.execute(
      new GetMigrationsQuery({ revisionId: await this.roleRevisionId(role) }),
    );
  }

  async schemas(role: RevisionRole): Promise<Record<string, JsonSchema>> {
    const rows = await this.systemRows(role, SystemTables.Schema);
    return Object.fromEntries(
      rows.map((row) => [row.id, row.data as JsonSchema]),
    );
  }

  async tableIds(role: RevisionRole): Promise<string[]> {
    const revisionId = await this.roleRevisionId(role);
    const tables = await this.kit.prisma.table.findMany({
      where: { system: false, revisions: { some: { id: revisionId } } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return tables.map((table) => table.id);
  }

  async tableVersions(role: RevisionRole): Promise<string[]> {
    const revisionId = await this.roleRevisionId(role);
    const tables = await this.kit.prisma.table.findMany({
      where: { revisions: { some: { id: revisionId } } },
      select: { versionId: true },
    });
    return tables.map((table) => table.versionId).sort();
  }

  async userContent(
    role: RevisionRole,
  ): Promise<
    Record<string, Array<{ id: string; data: unknown; hash: string }>>
  > {
    const revisionId = await this.roleRevisionId(role);
    const tables = await this.kit.prisma.table.findMany({
      where: { system: false, revisions: { some: { id: revisionId } } },
      include: { rows: { orderBy: { id: 'asc' } } },
      orderBy: { id: 'asc' },
    });
    return Object.fromEntries(
      tables.map((table) => [
        table.id,
        table.rows.map((row) => ({
          id: row.id,
          data: row.data,
          hash: row.hash,
        })),
      ]),
    );
  }

  async createRow(
    tableId: string,
    rowId: string,
    data: InputJsonValue,
  ): Promise<void> {
    await this.kit.draftApi.apiCreateRow({
      revisionId: await this.draftRevisionId(),
      tableId,
      rowId,
      data,
    });
  }

  async createRows(
    tableId: string,
    rows: Record<string, InputJsonValue>,
  ): Promise<void> {
    await this.kit.draftApi.apiCreateRows({
      revisionId: await this.draftRevisionId(),
      tableId,
      rows: Object.entries(rows).map(([rowId, data]) => ({ rowId, data })),
    });
  }

  async patchRow(
    tableId: string,
    rowId: string,
    valuesByNativePath: Record<string, InputJsonValue>,
  ): Promise<void> {
    await this.kit.draftApi.apiPatchRow({
      revisionId: await this.draftRevisionId(),
      tableId,
      rowId,
      patches: Object.entries(valuesByNativePath).map(([path, value]) => ({
        op: 'replace' as const,
        path,
        value: value as never,
      })),
    });
  }

  async updateRow(
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

  async renameRow(
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

  async removeRow(tableId: string, rowId: string): Promise<void> {
    await this.kit.draftApi.apiRemoveRow({
      revisionId: await this.draftRevisionId(),
      tableId,
      rowId,
    });
  }

  async uploadFile(
    tableId: string,
    rowId: string,
    field: string,
    content: 'text' | 'image' = 'text',
  ): Promise<void> {
    const row = await this.draftRow(tableId, rowId);
    const file = row.data[field] as { fileId: string };
    await this.kit.draftApi.apiUploadFile({
      revisionId: await this.draftRevisionId(),
      tableId,
      rowId,
      fileId: file.fileId,
      file: content === 'text' ? createExpressFile() : createExpressImageFile(),
    });
  }

  async projectFileBytes(): Promise<bigint> {
    const usage = await this.kit.prisma.projectFileUsage.findUnique({
      where: { projectId: this.branch.projectId },
    });
    return usage?.fileBytes ?? BigInt(0);
  }

  async blobHashes(
    role: RevisionRole,
    tableId: string,
    rowId: string,
  ): Promise<string[]> {
    const { versionId } = await this.storedRow(role, tableId, rowId);
    const row = await this.kit.prisma.row.findUniqueOrThrow({
      where: { versionId },
      select: { fileBlobs: { select: { hash: true, deletedAt: true } } },
    });
    return row.fileBlobs
      .filter((blob) => blob.deletedAt === null)
      .map((blob) => blob.hash)
      .sort();
  }

  commitNatively(): Promise<unknown> {
    return this.guarded(() =>
      this.kit.draftApi.apiCreateRevision({
        projectId: this.branch.projectId,
        branchName: this.branch.branchName,
      }),
    );
  }

  revertNatively(): Promise<unknown> {
    return this.guarded(() =>
      this.kit.commandBus.execute(
        new ApiRevertChangesCommand({
          projectId: this.branch.projectId,
          branchName: this.branch.branchName,
        }),
      ),
    );
  }

  listChanges(
    page: { cursor?: string; limit?: number } = {},
  ): Promise<ListChangesResult> {
    return this.guarded(() =>
      this.kit.changes.listChanges({ branch: this.publicBranch, ...page }),
    );
  }

  async listAllChanges(limit?: number): Promise<ListedUnit[]> {
    const units: ListedUnit[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.listChanges({ cursor, limit });
      units.push(...page.units);
      cursor = page.nextCursor;
    } while (cursor);
    return units;
  }

  preview(
    operation: ChangeOperation,
    selection: Selection,
    includeRequired?: boolean,
  ): Promise<PreviewChangesResult> {
    return this.guarded(() =>
      this.kit.changes.previewChanges({
        branch: this.publicBranch,
        operation,
        selection,
        includeRequired,
      }),
    );
  }

  commit(
    selection: Selection,
    options: {
      includeRequired?: boolean;
      expected?: string;
      comment?: string;
    } = {},
  ): Promise<ApplyChangesResult> {
    return this.guarded(() =>
      this.kit.changes.commitChanges({
        branch: this.publicBranch,
        selection,
        ...options,
      }),
    );
  }

  revert(
    selection: Selection,
    options: { includeRequired?: boolean; expected?: string } = {},
  ): Promise<ApplyChangesResult> {
    return this.guarded(() =>
      this.kit.changes.revertChanges({
        branch: this.publicBranch,
        selection,
        ...options,
      }),
    );
  }

  async commitWithRequired(selection: Selection): Promise<ApplyChangesResult> {
    const { fingerprint } = await this.preview('commit', selection, true);
    return this.commit(selection, {
      includeRequired: true,
      expected: fingerprint,
    });
  }

  async revertWithRequired(selection: Selection): Promise<ApplyChangesResult> {
    const { fingerprint } = await this.preview('revert', selection, true);
    return this.revert(selection, {
      includeRequired: true,
      expected: fingerprint,
    });
  }

  headRow(tableId: string, rowId: string): Promise<StoredRow> {
    return this.storedRow('head', tableId, rowId);
  }

  draftRow(tableId: string, rowId: string): Promise<StoredRow> {
    return this.storedRow('draft', tableId, rowId);
  }

  async headRowIds(tableId: string): Promise<string[]> {
    return this.rowIds(await this.headRevisionId(), tableId);
  }

  async draftRowIds(tableId: string): Promise<string[]> {
    return this.rowIds(await this.draftRevisionId(), tableId);
  }

  async danglingReferences(
    role: RevisionRole,
    tableId: string,
    field: string,
    targetTableId: string,
  ): Promise<string[]> {
    const revisionId = await this.roleRevisionId(role);
    const targets = new Set(await this.rowIds(revisionId, targetTableId));
    const rows = await this.kit.prisma.row.findMany({
      where: {
        tables: {
          some: { id: tableId, revisions: { some: { id: revisionId } } },
        },
      },
    });
    return rows
      .filter((row) => {
        const value = (row.data as Record<string, unknown>)[field];
        return typeof value === 'string' && !targets.has(value);
      })
      .map((row) => row.id);
  }

  async readRow(role: RevisionRole, tableId: string, rowId: string) {
    const revisionId = await this.roleRevisionId(role);
    return this.kit.rowApi.getRow({ revisionId, tableId, rowId });
  }

  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    await this.kit.guard.verify();
    try {
      return await operation();
    } finally {
      await this.kit.guard.verify();
    }
  }

  private get publicBranch(): ChangesBranch {
    return {
      projectId: this.branch.projectId,
      branchName: this.branch.branchName,
    };
  }

  private async roleRevisionId(role: RevisionRole): Promise<string> {
    return (await this.revision(role)).id;
  }

  private revision(role: RevisionRole) {
    return this.kit.prisma.revision.findFirstOrThrow({
      where:
        role === 'head'
          ? { branchId: this.branch.branchId, isHead: true }
          : { branchId: this.branch.branchId, isDraft: true },
    });
  }

  private async storedRow(
    role: RevisionRole,
    tableId: string,
    rowId: string,
  ): Promise<StoredRow> {
    const revisionId = await this.roleRevisionId(role);
    const row = await this.kit.prisma.row.findFirst({
      where: {
        id: rowId,
        tables: {
          some: { id: tableId, revisions: { some: { id: revisionId } } },
        },
      },
    });

    if (!row) {
      throw new Error(`Row ${tableId}/${rowId} is absent in ${role}`);
    }

    return {
      versionId: row.versionId,
      createdId: row.createdId,
      id: row.id,
      readonly: row.readonly,
      data: row.data as Record<string, unknown>,
      hash: row.hash,
      schemaHash: row.schemaHash,
    };
  }

  private async hasTable(role: RevisionRole, tableId: string) {
    const revisionId = await this.roleRevisionId(role);
    const count = await this.kit.prisma.table.count({
      where: { id: tableId, revisions: { some: { id: revisionId } } },
    });
    return count > 0;
  }

  private async systemRows(role: RevisionRole, tableId: SystemTables) {
    const revisionId = await this.roleRevisionId(role);
    return this.kit.prisma.row.findMany({
      where: {
        tables: {
          some: { id: tableId, revisions: { some: { id: revisionId } } },
        },
      },
      orderBy: { id: 'asc' },
    });
  }

  private async rowIds(revisionId: string, tableId: string): Promise<string[]> {
    const rows = await this.kit.prisma.row.findMany({
      where: {
        tables: {
          some: { id: tableId, revisions: { some: { id: revisionId } } },
        },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => row.id);
  }
}
