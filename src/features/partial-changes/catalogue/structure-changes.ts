import type { CatalogueTables } from 'src/features/partial-changes/catalogue/catalogue-tables';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import { carriesViewsChange } from 'src/features/partial-changes/catalogue/views-units';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { AnnotationKeyword } from 'src/features/partial-changes/structure/normalized-leaf-schema';
import {
  type AnnotatedObject,
  type ChangedLeaf,
  changedLeavesOfReplacedTable,
  type StructureFieldChange,
  type TableStructure,
} from 'src/features/partial-changes/structure/table-structure';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import {
  type JsonArraySchema,
  type JsonBooleanSchema,
  type JsonNumberSchema,
  type JsonObjectSchema,
  type JsonRefSchema,
  type JsonSchema,
  JsonSchemaTypeName,
  type JsonStringSchema,
} from '@revisium/schema-toolkit/types';

export const STRUCTURE_TABLE_CHANGES = [
  'created',
  'removed',
  'replaced',
  'transient',
  'changed',
] as const;

export type StructureTableChange = (typeof STRUCTURE_TABLE_CHANGES)[number];

export type ObjectOwnSchema = Omit<
  JsonObjectSchema,
  'properties' | 'required' | 'additionalProperties'
>;

export type FieldSchema =
  | JsonStringSchema
  | JsonNumberSchema
  | JsonBooleanSchema
  | JsonArraySchema
  | JsonRefSchema
  | ObjectOwnSchema;

export interface ChangedField {
  readonly path: string;
  readonly change: StructureFieldChange;
  readonly from?: string;
  readonly annotations?: readonly AnnotationKeyword[];
  readonly before?: FieldSchema;
  readonly after?: FieldSchema;
}

export interface StructureChange {
  readonly table: StructureTableChange;
  readonly fields: readonly ChangedField[];
  readonly views: boolean;
}

interface SchemaSides {
  readonly before?: JsonSchema;
  readonly after?: JsonSchema;
}

const OBJECT_STRUCTURE_KEYWORDS: ReadonlySet<string> = new Set([
  'properties',
  'required',
  'additionalProperties',
]);

type WholeTableChange = Exclude<StructureTableChange, 'changed' | 'replaced'>;

type TableDescription = Omit<StructureChange, 'views'>;

export function structureChangeOf(
  unit: CatalogueUnit,
  tables: CatalogueTables,
): StructureChange {
  return {
    ...tableChangeOf(unit, tables),
    views: carriesViewsChange(unit, tables),
  };
}

function tableChangeOf(
  { tableIdentities }: CatalogueUnit,
  tables: CatalogueTables,
): TableDescription {
  const pairs = tableIdentities.map((identity) => tables.pairOf(identity));
  const changedTable = pairs.find(isOnBothSides);

  if (changedTable) {
    return {
      table: 'changed',
      fields: changedFieldsOfStructure(tables.structureOf(changedTable)),
    };
  }

  const removed = pairs.find(isRemoved);
  const created = pairs.find(isCreated);

  if (removed && created) {
    return {
      table: 'replaced',
      fields: changedFieldsOf(replacedTableLeavesOf(removed, created, tables)),
    };
  }

  return { table: wholeTableChangeOf(pairs), fields: [] };
}

function replacedTableLeavesOf(
  removed: TablePair,
  created: TablePair,
  tables: CatalogueTables,
): ChangedLeaf[] {
  return changedLeavesOfReplacedTable(
    tables.sideOf(removed, 'head'),
    tables.sideOf(created, 'draft'),
  );
}

function wholeTableChangeOf(pairs: readonly TablePair[]): WholeTableChange {
  if (pairs.length === 0) {
    return 'transient';
  }

  if (pairs.every(isCreated)) {
    return 'created';
  }

  return 'removed';
}

function changedFieldsOfStructure({
  changedLeaves,
  annotatedObjects,
}: TableStructure): ChangedField[] {
  return inPathOrder([
    ...changedLeaves.map(changedFieldOf),
    ...annotatedObjects.map(annotatedFieldOf),
  ]);
}

function changedFieldsOf(leaves: readonly ChangedLeaf[]): ChangedField[] {
  return inPathOrder(leaves.map(changedFieldOf));
}

function inPathOrder(fields: ChangedField[]): ChangedField[] {
  return fields.sort((left, right) => compareCodePoints(left.path, right.path));
}

function annotatedFieldOf(object: AnnotatedObject): ChangedField {
  return {
    path: object.pointer.toString(),
    change: 'annotated',
    annotations: object.annotations,
    ...fieldSchemasOf(object),
  };
}

function changedFieldOf(leaf: ChangedLeaf): ChangedField {
  return {
    path: leaf.pointer.toString(),
    change: leaf.change,
    ...provenanceOf(leaf),
    ...fieldSchemasOf(leaf),
  };
}

function provenanceOf({
  from,
  annotations,
}: ChangedLeaf): Pick<ChangedField, 'from' | 'annotations'> {
  if (from) {
    return { from: from.toString() };
  }

  if (annotations) {
    return { annotations };
  }

  return {};
}

function fieldSchemasOf({
  before,
  after,
}: SchemaSides): Pick<ChangedField, 'before' | 'after'> {
  const schemas: { before?: FieldSchema; after?: FieldSchema } = {};

  if (before) {
    schemas.before = fieldSchemaOf(before);
  }

  if (after) {
    schemas.after = fieldSchemaOf(after);
  }

  return schemas;
}

// A copy, so a caller that edits a result changes neither the snapshot nor another description.
function fieldSchemaOf(schema: JsonSchema): FieldSchema {
  return structuredClone(describedSchemaOf(schema));
}

// An object is no leaf: its fields are described at their own pointers, so it is described by its own keywords.
function describedSchemaOf(schema: JsonSchema): FieldSchema {
  if (!isObjectSchema(schema)) {
    return schema;
  }

  return Object.fromEntries(
    Object.entries(schema).filter(
      ([keyword]) => !OBJECT_STRUCTURE_KEYWORDS.has(keyword),
    ),
  ) as ObjectOwnSchema;
}

function isObjectSchema(schema: JsonSchema): schema is JsonObjectSchema {
  return !('$ref' in schema) && schema.type === JsonSchemaTypeName.Object;
}

function isOnBothSides({ head, draft }: TablePair): boolean {
  return head !== undefined && draft !== undefined;
}

function isCreated({ head }: TablePair): boolean {
  return head === undefined;
}

function isRemoved({ draft }: TablePair): boolean {
  return draft === undefined;
}
