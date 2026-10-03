import { SchemaTable } from '@revisium/schema-toolkit/lib';
import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { RowChangesScenario } from './row-scenario';

interface RecordedMigration {
  id: string;
  tableId: string;
  changeType: string;
  schema?: JsonSchema;
  patches?: JsonPatch[];
}

export async function replayedSchema(
  f: RowChangesScenario,
  role: 'head' | 'draft',
) {
  const revisionId = await f.revisionId(role);
  const rows = await f.kit.prismaService.row.findMany({
    where: {
      tables: {
        some: {
          id: SystemTables.Migration,
          revisions: { some: { id: revisionId } },
        },
      },
    },
  });
  const migrations = rows
    .map((row) => row.data as unknown as RecordedMigration)
    .filter((item) => item.tableId === f.tableId)
    .sort((a, b) => a.id.localeCompare(b.id));
  const init = migrations.find((item) => item.changeType === 'init');
  if (!init?.schema) {
    throw new Error('Exported migration history has no initial schema.');
  }
  let schema = init.schema;
  for (const migration of migrations.filter(
    (item) => item.changeType === 'update',
  )) {
    const table = new SchemaTable(schema);
    table.applyPatches(migration.patches ?? []);
    schema = table.getSchema();
  }
  return schema;
}
