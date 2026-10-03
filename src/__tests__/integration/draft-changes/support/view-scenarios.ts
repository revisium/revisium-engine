import { givenRowChanges } from './row-scenario';
import type { ChangesTestKit } from './test-kit';
import { nanoid } from 'nanoid';
import hash from 'object-hash';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { tableViewsSchema } from 'src/features/share/schema/table-views-schema';

export async function givenViewChanges(kit: ChangesTestKit) {
  const f = await givenRowChanges(kit, {
    head: { price: 1 },
    draft: { price: 1 },
  });
  const baseline = {
    version: 1,
    defaultViewId: 'default',
    views: [
      { id: 'default', name: 'Head view', columns: [{ field: 'data.price' }] },
    ],
  };
  await kit.prismaService.table.create({
    data: {
      id: SystemTables.Views,
      versionId: nanoid(),
      createdId: nanoid(),
      system: true,
      readonly: true,
      revisions: {
        connect: [
          { id: f.initial.headRevisionId },
          { id: f.initial.draftRevisionId },
        ],
      },
      rows: {
        create: {
          id: f.tableId,
          versionId: nanoid(),
          createdId: nanoid(),
          readonly: true,
          data: baseline,
          hash: hash(baseline),
          schemaHash: hash(tableViewsSchema),
        },
      },
    },
  });
  await kit.views.updateTableViews({
    revisionId: f.initial.draftRevisionId,
    tableId: f.tableId,
    viewsData: {
      ...baseline,
      views: [
        {
          id: 'default',
          name: 'Draft view',
          columns: [{ field: 'data.price' }],
        },
      ],
    },
  });
  return f;
}

export async function givenRenamedViewField(kit: ChangesTestKit) {
  const f = await givenViewChanges(kit);
  await kit.views.updateTableViews({
    revisionId: f.initial.draftRevisionId,
    tableId: f.tableId,
    viewsData: {
      version: 1,
      defaultViewId: 'default',
      views: [
        {
          id: 'default',
          name: 'Draft view',
          columns: [{ field: 'data.price' }],
        },
      ],
    },
  });
  await f.patchSchema([
    { op: 'move', from: '/properties/price', path: '/properties/cost' },
  ]);
  return {
    f,
    async draftView() {
      const views = await kit.views.getTableViews({
        revisionId: await f.revisionId('draft'),
        tableId: f.tableId,
      });
      return views.views[0];
    },
  };
}
