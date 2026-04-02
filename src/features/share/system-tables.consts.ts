import { Schema } from 'ajv/dist/2020';
import { metaSchema } from 'src/features/share/schema/meta-schema';
import { sharedSchemasSchema } from 'src/features/share/schema/shared-schemas-schema';
import { tableMigrationsSchema } from 'src/features/share/schema/table-migrations-schema';
import { tableViewsSchema } from 'src/features/share/schema/table-views-schema';

export const SYSTEM_TABLE_PREFIX = 'revisium_';

export enum SystemTables {
  Schema = 'revisium_schema_table',
  Migration = 'revisium_migration_table',
  SharedSchemas = 'revisium_shared_schemas_table',
  Views = 'revisium_views_table',
}

export const systemTablesIds: string[] = [
  SystemTables.Schema,
  SystemTables.SharedSchemas,
  SystemTables.Migration,
  SystemTables.Views,
];

const systemTableSchemas: Record<string, Schema | undefined> = {
  [SystemTables.Schema]: metaSchema,
  [SystemTables.SharedSchemas]: sharedSchemasSchema,
  [SystemTables.Migration]: tableMigrationsSchema,
  [SystemTables.Views]: tableViewsSchema,
};

export const findSchemaForSystemTables = (
  tableId: string,
): Schema | undefined => systemTableSchemas[tableId];
