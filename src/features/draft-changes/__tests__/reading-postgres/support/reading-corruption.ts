import type { JsonValue } from '@revisium/schema-toolkit/types';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';

export async function tamperDraftRowKeepingHash({
  prisma,
  branchId,
  tableId,
  rowId,
  data,
}: {
  prisma: PrismaService;
  branchId: string;
  tableId: string;
  rowId: string;
  data: Record<string, JsonValue>;
}): Promise<void> {
  const revision = await prisma.revision.findFirstOrThrow({
    where: { branchId, isDraft: true },
    select: { id: true },
  });
  const row = await prisma.row.findFirstOrThrow({
    where: {
      id: rowId,
      tables: {
        some: {
          id: tableId,
          revisions: { some: { id: revision.id } },
        },
      },
    },
    select: { versionId: true },
  });
  await prisma.row.update({
    where: { versionId: row.versionId },
    data: { data },
  });
}
