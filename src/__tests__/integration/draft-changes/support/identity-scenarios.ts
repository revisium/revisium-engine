import { givenRowChanges } from './row-scenario';
import type { ChangesTestKit } from './test-kit';
import { prepareRow } from 'src/__tests__/utils/prepareProject';

export async function givenReusedRowId(kit: ChangesTestKit) {
  const f = await givenRowChanges(kit, {
    head: { value: 1 },
    draft: { value: 1 },
  });
  await f.removeRow();
  const replacementValue = 9;
  await f.createRow(f.rowId, { value: replacementValue });
  return f;
}

export async function givenRowSwap(kit: ChangesTestKit) {
  const f = await givenRowChanges(kit, {
    rowId: 'first',
    head: { value: 1 },
    draft: { value: 1 },
  });
  const secondValue = 2;
  await prepareRow({
    prismaService: kit.prismaService,
    headTableVersionId: f.initial.headTableVersionId,
    draftTableVersionId: f.initial.draftTableVersionId,
    rowId: 'second',
    data: { value: secondValue },
    dataDraft: { value: secondValue },
    schema: await f.schema('head'),
  });
  await f.renameRow('temporary');
  await kit.draftApiService.apiRenameRow({
    revisionId: await f.revisionId('draft'),
    tableId: f.tableId,
    rowId: 'second',
    nextRowId: 'first',
  });
  await f.renameRow('second');
  const page = await f.browseRows();
  const choices = page.edges
    .flatMap(({ node }) => node.refs)
    .filter((leaf) => leaf.kind === 'renamed')
    .map((leaf) => ({ kind: 'change' as const, ref: leaf.ref }));
  return { f, selection: { include: choices } };
}
