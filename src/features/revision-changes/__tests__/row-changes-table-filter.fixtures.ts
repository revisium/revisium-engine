import type { RowChangesFilters } from '../types';
import type { Row, Table } from 'src/engine-prisma-types';
import { RevisionChangesApiService } from '../revision-changes-api.service';
import { GetRowChangesHandler } from '../queries/handlers/get-row-changes.handler';
import { RowChangeMapper } from '../mappers/row-change.mapper';
import { RowDiffService } from '../services/row-diff.service';
import { RevisionComparisonService } from '../services/revision-comparison.service';
import { PluginService } from 'src/features/plugin/plugin.service';
import {
  createRevisionChangesTestKit,
  type RevisionChangesTestKit,
} from './revision-changes-test-kit';
import {
  createRevision,
  createRevisionPair,
  createRowVersion,
  createTableVersion,
} from './revision-changes.fixtures';

const DEFAULT_PAGE_SIZE = 10;

interface TableFilterTestKit extends RevisionChangesTestKit {
  api: RevisionChangesApiService;
}

interface TableWithRows {
  table: Table;
  rows: Row[];
}

export async function createTableFilterTestKit(): Promise<TableFilterTestKit> {
  const kit = await createRevisionChangesTestKit({
    providers: [
      GetRowChangesHandler,
      RowDiffService,
      RevisionComparisonService,
      RowChangeMapper,
      RevisionChangesApiService,
      {
        provide: PluginService,
        useValue: { computeRows: jest.fn().mockResolvedValue(undefined) },
      },
    ],
  });
  await kit.module.init();
  return { ...kit, api: kit.module.get(RevisionChangesApiService) };
}

export async function givenTableRowChanges(
  kit: TableFilterTestKit,
  input: {
    from?: string;
    to?: string;
    recreated?: boolean;
    rows?: string[];
    intermediateParent?: boolean;
  },
) {
  const { branch, fromRevision, toRevision } = await createRevisionPair(
    kit.prismaService,
  );
  const rowIds = input.rows ?? ['row'];
  let fromTable;
  let toTable;

  if (input.from) {
    fromTable = await createTableWithRows(kit, fromRevision.id, {
      tableId: input.from,
      rowIds,
      value: 1,
    });
  }

  let previousIdentity = fromTable;
  if (input.recreated) {
    previousIdentity = undefined;
  }

  if (input.to) {
    toTable = await createTableWithRows(kit, toRevision.id, {
      tableId: input.to,
      rowIds,
      value: 2,
      previousIdentity,
    });
  }

  const unrelated = await createTableWithRows(kit, toRevision.id, {
    tableId: 'unrelated',
    rowIds: ['unrelated-row'],
    value: 2,
  });

  if (input.intermediateParent) {
    await insertEmptyParent(kit, branch.id, fromRevision.id, toRevision.id);
  }

  return {
    fromRevisionId: fromRevision.id,
    toRevisionId: toRevision.id,
    fromTable: fromTable?.table,
    toTable: toTable?.table,
    unrelated: unrelated.table,
    changes(
      options: RowChangesFilters & {
        first?: number;
        after?: string;
        compareWithRevisionId?: string;
      } = {},
    ) {
      const {
        first = DEFAULT_PAGE_SIZE,
        after,
        compareWithRevisionId,
        ...filters
      } = options;
      return kit.api.rowChanges({
        revisionId: toRevision.id,
        first,
        after,
        compareWithRevisionId,
        filters,
      });
    },
  };
}

async function createTableWithRows(
  kit: TableFilterTestKit,
  revisionId: string,
  input: {
    tableId: string;
    rowIds: string[];
    value: number;
    previousIdentity?: TableWithRows;
  },
): Promise<TableWithRows> {
  const { prismaService } = kit;
  const table = await createTableVersion({
    prismaService,
    revisionId,
    id: input.tableId,
    createdId: input.previousIdentity?.table.createdId,
  });
  const rows: Row[] = [];
  for (const [index, id] of input.rowIds.entries()) {
    rows.push(
      await createRowVersion({
        prismaService,
        tableVersionId: table.versionId,
        id,
        createdId: input.previousIdentity?.rows[index]?.createdId,
        data: { value: input.value },
      }),
    );
  }
  return { table, rows };
}

async function insertEmptyParent(
  kit: TableFilterTestKit,
  branchId: string,
  fromRevisionId: string,
  toRevisionId: string,
) {
  const parent = await createRevision(
    kit.prismaService,
    branchId,
    fromRevisionId,
  );
  await kit.prismaService.revision.update({
    where: { id: toRevisionId },
    data: { parentId: parent.id },
  });
}
