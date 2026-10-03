import {
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import {
  prepareRow,
  prepareTableWithSchema,
} from 'src/__tests__/utils/prepareProject';
import { SystemTables } from 'src/features/share/system-tables.consts';
import hash from 'object-hash';
import { nanoid } from 'nanoid';
import { givenRowChanges, RowChangesScenario } from './row-scenario';
import type { ChangesTestKit } from './test-kit';

export async function givenLinkedRows(kit: ChangesTestKit) {
  const target = await givenRowChanges(kit, {
    head: { value: 1 },
    draft: { value: 1 },
  });
  const systemTables = await kit.prismaService.table.findMany({
    where: {
      system: true,
      revisions: { some: { id: target.initial.headRevisionId } },
    },
  });
  const schemaTable = systemTables.find(
    (table) => table.id === SystemTables.Schema,
  );
  const migrationTable = systemTables.find(
    (table) => table.id === SystemTables.Migration,
  );
  if (!schemaTable || !migrationTable) {
    throw new Error('The branch fixture is missing its system tables.');
  }
  const schema = getObjectSchema({
    target: getStringSchema({ foreignKey: target.tableId }),
    label: getStringSchema(),
  });
  const table = await prepareTableWithSchema({
    prismaService: kit.prismaService,
    headRevisionId: target.initial.headRevisionId,
    draftRevisionId: target.initial.draftRevisionId,
    schemaTableVersionId: schemaTable.versionId,
    migrationTableVersionId: migrationTable.versionId,
    schema,
  });
  const row = await prepareRow({
    prismaService: kit.prismaService,
    headTableVersionId: table.headTableVersionId,
    draftTableVersionId: table.draftTableVersionId,
    data: { target: target.rowId, label: target.rowId },
    dataDraft: { target: target.rowId, label: target.rowId },
    schema,
  });
  const migration = await kit.prismaService.row.findFirstOrThrow({
    where: {
      tables: { some: { versionId: migrationTable.versionId } },
      data: { path: ['tableId'], equals: table.tableId },
    },
  });
  const id = new Date().toISOString();
  const data = { ...(migration.data as Record<string, unknown>), id };
  await kit.prismaService.row.update({
    where: { versionId: migration.versionId },
    data: { id, data, hash: hash(data), publishedAt: new Date(id) },
  });
  const source = new RowChangesScenario(kit, {
    ...target.initial,
    ...table,
    ...row,
  });
  return { target, source };
}

export async function givenRequiredDependency(kit: ChangesTestKit) {
  const graph = await givenLinkedRows(kit);
  const requiredRowId = 'required';
  const requiredValue = 2;
  await graph.target.createRow(requiredRowId, { value: requiredValue });
  await graph.source.updateDraftRow({
    target: requiredRowId,
    label: graph.target.rowId,
  });
  return {
    ...graph,
    requiredRowId,
    requiredChoice: graph.target.rows(requiredRowId),
  };
}

export async function givenDependencyGraph(
  kit: ChangesTestKit,
  links: Record<string, string>,
) {
  const tableId = `links-${nanoid()}`;
  const schema = getObjectSchema({
    link: getStringSchema({ foreignKey: tableId }),
  });
  const f = await givenRowChanges(kit, {
    tableId,
    rowId: 'base',
    schema,
    head: { link: 'base' },
    draft: { link: 'base' },
  });
  for (const [rowId, link] of Object.entries(links)) {
    const data = { link };
    await kit.prismaService.row.create({
      data: {
        id: rowId,
        versionId: nanoid(),
        createdId: nanoid(),
        readonly: false,
        data,
        hash: hash(data),
        schemaHash: hash(schema),
        tables: { connect: { versionId: f.initial.draftTableVersionId } },
      },
    });
  }
  return f;
}
