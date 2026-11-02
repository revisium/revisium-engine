import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ChangesScenario } from './changes-scenario';

export interface ReadonlyDraftVersion {
  readonly tableId: string;
  readonly versionId: string;
  readonly rowVersionIds: readonly string[];
}

export async function givenReadonlyDraftVersion(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  tableId: string,
): Promise<ReadonlyDraftVersion> {
  const versionId = await draft.tableVersionId('draft', tableId);

  await kit.prisma.table.update({
    where: { versionId },
    data: { readonly: true },
  });

  return {
    tableId,
    versionId,
    rowVersionIds: await rowVersionIdsOf(kit, versionId),
  };
}

export async function expectCopiedInsteadOfEdited(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  readonlyVersion: ReadonlyDraftVersion,
): Promise<void> {
  const versionId = await draft.tableVersionId(
    'draft',
    readonlyVersion.tableId,
  );
  const written = await kit.prisma.table.findUniqueOrThrow({
    where: { versionId },
  });

  expect(versionId).not.toBe(readonlyVersion.versionId);
  expect(written.readonly).toBe(false);
  expect(await rowVersionIdsOf(kit, readonlyVersion.versionId)).toEqual(
    readonlyVersion.rowVersionIds,
  );
}

async function rowVersionIdsOf(
  kit: PartialChangesTestKit,
  tableVersionId: string,
): Promise<string[]> {
  const rows = await kit.prisma.row.findMany({
    where: { tables: { some: { versionId: tableVersionId } } },
    select: { versionId: true },
    orderBy: { versionId: 'asc' },
  });

  return rows.map(({ versionId }) => versionId);
}
