import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  JsonSchemaTypeName,
  type JsonObjectSchema,
  type JsonSchema,
} from '@revisium/schema-toolkit/types';
import type { InputJsonValue, Row } from 'src/engine-prisma-types';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { ChangesScenario, TableIdentity } from './changes-scenario';

export interface HeadTable extends TableIdentity {
  readonly rows: readonly Row[];
}

export interface TableShape {
  readonly id: string;
  readonly schema: JsonObjectSchema;
}

export interface DraftTable extends HeadTable, TableShape {}

export interface TableRow {
  readonly table: DraftTable;
  readonly row: Row;
}

export async function readHeadTables(
  draft: ChangesScenario,
): Promise<ReadonlyMap<string, HeadTable>> {
  const tables = new Map<string, HeadTable>();

  for (const table of await draft.userTables('head')) {
    tables.set(table.id, {
      ...table,
      rows: await draft.rows('head', table.id),
    });
  }

  return tables;
}

export class DraftTables {
  private constructor(public readonly all: readonly DraftTable[]) {}

  public static async read(draft: ChangesScenario): Promise<DraftTables> {
    const tables: DraftTable[] = [];

    for (const table of await draft.userTables('draft')) {
      const schemaRow = await draft.row('draft', SystemTables.Schema, table.id);

      tables.push({
        ...table,
        schema: schemaRow.data as unknown as JsonObjectSchema,
        rows: await draft.rows('draft', table.id),
      });
    }

    return new DraftTables(tables);
  }

  public withRows(): DraftTable[] {
    return this.all.filter(({ rows }) => rows.length > 0);
  }

  public withPlainValues(): DraftTable[] {
    return this.withRows().filter((table) => plainFieldsOf(table).length > 0);
  }

  public withReplaceableReferences(): DraftTable[] {
    return this.withRows().filter((table) =>
      referenceFieldsOf(table).some(
        (field) => this.referenceTargetsOf(table, field).length > 1,
      ),
    );
  }

  public withFiles(): DraftTable[] {
    return this.withRows().filter((table) => fileFieldsOf(table).length > 0);
  }

  public withSeveralFields(): DraftTable[] {
    return this.all.filter((table) => fieldsOf(table).length > 1);
  }

  public acceptingRows(): DraftTable[] {
    return this.all.filter((table) =>
      referenceFieldsOf(table).every(
        (field) => this.referenceTargetsOf(table, field).length > 0,
      ),
    );
  }

  public unreferenced(): DraftTable[] {
    const referenced = new Set(
      this.all.flatMap((table) =>
        referenceFieldsOf(table)
          .map((field) => foreignKeyOf(fieldSchemaOf(table, field)))
          .filter((tableId) => tableId !== table.id),
      ),
    );

    return this.all.filter(({ id }) => !referenced.has(id));
  }

  public referenceTargetsOf(table: TableShape, field: string): string[] {
    return this.rowIdsOf(foreignKeyOf(fieldSchemaOf(table, field)));
  }

  public isReferenced(tableId: string, rowId: string): boolean {
    return this.all.some((table) =>
      referenceFieldsOf(table)
        .filter(
          (field) => foreignKeyOf(fieldSchemaOf(table, field)) === tableId,
        )
        .some((field) =>
          table.rows.some((row) => dataOf(row)[field] === rowId),
        ),
    );
  }

  private rowIdsOf(tableId: string): string[] {
    const table = this.all.find(({ id }) => id === tableId);

    return (table?.rows ?? []).map(({ id }) => id);
  }
}

export function fieldsOf(table: TableShape): string[] {
  return Object.keys(table.schema.properties).sort(compareCodePoints);
}

export function plainFieldsOf(table: TableShape): string[] {
  return fieldsOf(table).filter((field) =>
    isPlainValue(fieldSchemaOf(table, field)),
  );
}

export function referenceFieldsOf(table: TableShape): string[] {
  return fieldsOf(table).filter((field) =>
    isReference(fieldSchemaOf(table, field)),
  );
}

export function publishedAtFieldsOf(table: TableShape): string[] {
  return fieldsOf(table).filter((field) =>
    isPublishedAt(fieldSchemaOf(table, field)),
  );
}

export function fileFieldsOf(table: TableShape): string[] {
  return fieldsOf(table).filter((field) => isFile(fieldSchemaOf(table, field)));
}

export function fieldSchemaOf(table: TableShape, field: string): JsonSchema {
  const schema = table.schema.properties[field];

  if (!schema) {
    throw new Error(`${table.id} has no field ${field}`);
  }

  return schema;
}

export function isNumber(schema: JsonSchema): boolean {
  return 'type' in schema && schema.type === JsonSchemaTypeName.Number;
}

export function isReference(schema: JsonSchema): boolean {
  return (
    'type' in schema &&
    schema.type === JsonSchemaTypeName.String &&
    Boolean(schema.foreignKey)
  );
}

export function isPublishedAt(schema: JsonSchema): boolean {
  return '$ref' in schema && schema.$ref === SystemSchemaIds.RowPublishedAt;
}

export function isFile(schema: JsonSchema): boolean {
  return '$ref' in schema && schema.$ref === SystemSchemaIds.File;
}

export function dataOf(row: Row): Record<string, InputJsonValue> {
  return row.data as Record<string, InputJsonValue>;
}

function isPlainValue(schema: JsonSchema): boolean {
  if (isNumber(schema)) {
    return true;
  }

  return (
    'type' in schema &&
    schema.type === JsonSchemaTypeName.String &&
    !schema.foreignKey
  );
}

function foreignKeyOf(schema: JsonSchema): string {
  if (
    !('type' in schema) ||
    schema.type !== JsonSchemaTypeName.String ||
    !schema.foreignKey
  ) {
    throw new Error('The field is not a reference');
  }

  return schema.foreignKey;
}
