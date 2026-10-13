import objectHash from 'object-hash';
import {
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import type { Migration } from '@revisium/schema-toolkit/types';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import {
  prepareBranch,
  type BranchGraph,
} from 'src/__tests__/utils/prepareProject';
import { GetMigrationsQuery } from 'src/features/revision/queries/impl/get-migrations.query';
import { SystemTables } from 'src/features/share/system-tables.consts';

export const nativeSchema = getObjectSchema({ name: getStringSchema() });

export function readNativeLedger(
  kit: DraftTestKit,
  revisionId: string,
): Promise<Migration[]> {
  return kit.queryBus.execute(new GetMigrationsQuery({ revisionId }));
}

export async function importNativeLedger(
  kit: DraftTestKit,
  migrations: Migration[],
) {
  const project = await prepareBranch(kit.prismaService);
  const results = await kit.draftApiService.applyMigrations({
    revisionId: project.draftRevisionId,
    migrations,
  });
  expect(results).toEqual(
    migrations.map(({ id }) => ({ id, status: 'applied' })),
  );
  return project;
}

export function givenNativeTable(kit: DraftTestKit, id: string) {
  return importNativeLedger(kit, [
    {
      id,
      changeType: 'init',
      tableId: 'products',
      schema: nativeSchema,
      hash: objectHash(nativeSchema),
    },
  ]);
}

export async function commitNativeHistory(
  kit: DraftTestKit,
  project: BranchGraph,
) {
  await kit.draftApiService.apiCreateRevision(project);
  const draft = await kit.prismaService.revision.findFirstOrThrow({
    where: { branchId: project.branchId, isDraft: true },
  });
  return { headRevisionId: project.draftRevisionId, draftRevisionId: draft.id };
}

export async function readNativeTableCreation(
  kit: DraftTestKit,
  revisionId: string,
  tableId: string,
) {
  const table = await kit.prismaService.table.findFirst({
    where: { id: tableId, revisions: { some: { id: revisionId } } },
  });
  const schema = await kit.prismaService.row.findFirst({
    where: {
      id: tableId,
      tables: {
        some: {
          id: SystemTables.Schema,
          revisions: { some: { id: revisionId } },
        },
      },
    },
  });
  return { table, schema };
}

export const nativeWriters = [
  {
    name: 'init',
    write: (kit: DraftTestKit, revisionId: string) =>
      kit.draftApiService.apiCreateTable({
        revisionId,
        tableId: 'other-products',
        schema: nativeSchema,
      }),
  },
  {
    name: 'update',
    write: (kit: DraftTestKit, revisionId: string) =>
      kit.draftApiService.apiUpdateTable({
        revisionId,
        tableId: 'products',
        patches: [
          { op: 'add', path: '/properties/extra', value: getStringSchema() },
        ],
      }),
  },
  {
    name: 'rename',
    write: (kit: DraftTestKit, revisionId: string) =>
      kit.draftApiService.apiRenameTable({
        revisionId,
        tableId: 'products',
        nextTableId: 'renamed-products',
      }),
  },
  {
    name: 'remove',
    write: (kit: DraftTestKit, revisionId: string) =>
      kit.draftApiService.apiRemoveTable({
        revisionId,
        tableId: 'products',
      }),
  },
];

export function freezeNativeClock(now: string) {
  jest.useFakeTimers({
    now: new Date(now),
    doNotFake: [
      'nextTick',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'performance',
      'hrtime',
      'queueMicrotask',
    ],
  });
}
