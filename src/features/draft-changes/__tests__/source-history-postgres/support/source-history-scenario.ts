import type {
  JsonPatch,
  JsonSchema,
  JsonValue,
  Migration,
} from '@revisium/schema-toolkit/types';
import {
  createDraftTestKit,
  type DraftTestKit,
} from 'src/__tests__/kit/create-draft-test-kit';
import {
  prepareBranch,
  type BranchGraph,
} from 'src/__tests__/utils/prepareProject';
import { DraftChangesApiService } from 'src/features/draft-changes/draft-changes-api.service';
import { DraftChangesModule } from 'src/features/draft-changes/draft-changes.module';
import { traceSourceHistory } from 'src/features/draft-changes/schema/source-history/trace-source-history';
import type { SourceHistoryResult } from 'src/features/draft-changes/schema/source-history/source-history.types';
import { MigrationService } from 'src/features/migration/services/migration.service';
import { GetMigrationsQuery } from 'src/features/revision/queries/impl/get-migrations.query';
import { SystemTables } from 'src/features/share/system-tables.consts';

export const ASYNC_ROW_THRESHOLD = 3;

export interface SourceHistoryTestKit {
  close(): Promise<void>;
  givenProject(): Promise<SourceProject>;
  givenProjectWithoutDraftLedger(): Promise<SourceProject>;
  givenProjectWithoutHeadLedger(): Promise<SourceProject>;
}

export async function createSourceHistoryTestKit(): Promise<SourceHistoryTestKit> {
  const kit = await createDraftTestKit({
    imports: [DraftChangesModule],
    migrationOptions: {
      workerMode: 'disabled',
      threshold: ASYNC_ROW_THRESHOLD,
    },
  });

  return {
    close: () => kit.close(),
    givenProject: async () =>
      new SourceProject(kit, await prepareBranch(kit.prismaService)),
    givenProjectWithoutDraftLedger: async () => {
      const graph = await prepareBranch(kit.prismaService);
      await detachLedger(kit, graph, graph.draftRevisionId);
      return new SourceProject(kit, graph);
    },
    givenProjectWithoutHeadLedger: async () => {
      const graph = await prepareBranch(kit.prismaService);
      await detachLedger(kit, graph, graph.headRevisionId);
      return new SourceProject(kit, graph);
    },
  };
}

export class SourceProject {
  private draftRevisionId: string;

  constructor(
    private readonly kit: DraftTestKit,
    private readonly graph: BranchGraph,
  ) {
    this.draftRevisionId = graph.draftRevisionId;
  }

  async createTable(tableId: string, schema: JsonSchema): Promise<void> {
    await this.kit.draftApiService.apiCreateTable({
      revisionId: this.draftRevisionId,
      tableId,
      schema,
    });
  }

  async updateTable(tableId: string, patches: JsonPatch[]): Promise<void> {
    const result = await this.kit.draftApiService.apiUpdateTable({
      revisionId: this.draftRevisionId,
      tableId,
      patches,
    });
    expect(result.migrationId).toBeUndefined();
  }

  async updateTableInBackground(
    tableId: string,
    patches: JsonPatch[],
  ): Promise<void> {
    const result = await this.kit.draftApiService.apiUpdateTable({
      revisionId: this.draftRevisionId,
      tableId,
      patches,
    });
    expect(result.migrationId).toEqual(expect.any(String));
    await this.kit.module
      .get(MigrationService)
      .processMigration(result.migrationId ?? '');
  }

  async renameTable(tableId: string, nextTableId: string): Promise<void> {
    await this.kit.draftApiService.apiRenameTable({
      revisionId: this.draftRevisionId,
      tableId,
      nextTableId,
    });
  }

  async removeTable(tableId: string): Promise<void> {
    await this.kit.draftApiService.apiRemoveTable({
      revisionId: this.draftRevisionId,
      tableId,
    });
  }

  async createRows(
    tableId: string,
    rows: Array<{ rowId: string; data: JsonValue }>,
  ): Promise<void> {
    await this.kit.draftApiService.apiCreateRows({
      revisionId: this.draftRevisionId,
      tableId,
      rows: rows.map(({ rowId, data }) => ({ rowId, data: data as object })),
    });
  }

  async fillRowsToAsyncThreshold(
    tableId: string,
    data: JsonValue,
  ): Promise<void> {
    await this.createRows(
      tableId,
      Array.from({ length: ASYNC_ROW_THRESHOLD }, (_item, index) => ({
        rowId: thresholdRowId(tableId, index),
        data,
      })),
    );
  }

  async dropRowsBelowAsyncThreshold(tableId: string): Promise<void> {
    await this.kit.draftApiService.apiRemoveRows({
      revisionId: this.draftRevisionId,
      tableId,
      rowIds: [thresholdRowId(tableId, 0)],
    });
  }

  async importMigrations(migrations: Migration[]): Promise<void> {
    const results = await this.kit.draftApiService.applyMigrations({
      revisionId: this.draftRevisionId,
      migrations,
    });
    expect(results).toEqual(
      migrations.map(({ id }) => ({ id, status: 'applied' })),
    );
  }

  async removeFirstDraftLedgerRow(): Promise<void> {
    const [first] = await this.readDraftLedger();
    if (!first) {
      throw new Error('Expected a Draft ledger row.');
    }
    await this.kit.draftApiService.apiRemoveRow({
      revisionId: this.draftRevisionId,
      tableId: SystemTables.Migration,
      rowId: first.id,
      avoidCheckingSystemTable: true,
    });
  }

  async readTableCreatedId(tableId: string): Promise<string> {
    const table = await this.kit.prismaService.table.findFirstOrThrow({
      where: { id: tableId, revisions: { some: { id: this.draftRevisionId } } },
    });
    return table.createdId;
  }

  readDraftLedger(): Promise<Migration[]> {
    return this.kit.queryBus.execute(
      new GetMigrationsQuery({ revisionId: this.draftRevisionId }),
    );
  }

  async commit(): Promise<void> {
    await this.kit.draftApiService.apiCreateRevision({
      projectId: this.graph.projectId,
      branchName: this.graph.branchName,
    });
    const draft = await this.kit.prismaService.revision.findFirstOrThrow({
      where: { branchId: this.graph.branchId, isDraft: true },
    });
    this.draftRevisionId = draft.id;
  }

  async trace(): Promise<SourceHistoryResult> {
    const snapshot = await this.kit.module
      .get(DraftChangesApiService)
      .readSnapshot({
        projectId: this.graph.projectId,
        branchName: this.graph.branchName,
      });
    return traceSourceHistory({ snapshot });
  }
}

async function detachLedger(
  kit: DraftTestKit,
  graph: BranchGraph,
  revisionId: string,
): Promise<void> {
  await kit.prismaService.table.update({
    where: { versionId: graph.migrationTableVersionId },
    data: { revisions: { disconnect: { id: revisionId } } },
  });
}

function thresholdRowId(tableId: string, index: number): string {
  return `${tableId}-row-${index}`;
}
