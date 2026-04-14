import { Prisma, type Row } from 'src/__generated__/client';
import { prepareProject } from 'src/__tests__/utils/prepareProject';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { SystemTables } from 'src/features/share/system-tables.consts';

export interface DraftMigrationProjectIds {
  headRevisionId: string;
  draftRevisionId: string;
  tableId: string;
}

export async function givenDraftMigrationProject(
  kit: DraftTestKit,
): Promise<DraftMigrationProjectIds> {
  const project = await prepareProject(kit.prismaService);

  return {
    headRevisionId: project.headRevisionId,
    draftRevisionId: project.draftRevisionId,
    tableId: project.tableId,
  };
}

export async function findLatestMigrationRowByTableId({
  kit,
  draftRevisionId,
  tableId,
}: {
  kit: DraftTestKit;
  draftRevisionId: string;
  tableId: string;
}): Promise<Row> {
  return kit.prismaService.row.findFirstOrThrow({
    where: {
      data: {
        path: ['tableId'],
        equals: tableId,
      },
      tables: {
        some: {
          id: SystemTables.Migration,
          revisions: {
            some: {
              id: draftRevisionId,
            },
          },
        },
      },
    },
    orderBy: {
      id: Prisma.SortOrder.desc,
    },
  });
}

export async function findMigrationRowById({
  kit,
  draftRevisionId,
  migrationId,
}: {
  kit: DraftTestKit;
  draftRevisionId: string;
  migrationId: string;
}): Promise<Row> {
  return kit.prismaService.row.findFirstOrThrow({
    where: {
      data: {
        path: ['id'],
        equals: migrationId,
      },
      tables: {
        some: {
          id: SystemTables.Migration,
          revisions: {
            some: {
              id: draftRevisionId,
            },
          },
        },
      },
    },
    orderBy: {
      id: Prisma.SortOrder.desc,
    },
  });
}
