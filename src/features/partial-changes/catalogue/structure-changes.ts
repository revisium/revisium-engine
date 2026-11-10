import type { CatalogueTables } from 'src/features/partial-changes/catalogue/catalogue-tables';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import { carriesViewsChange } from 'src/features/partial-changes/catalogue/views-units';
import type {
  ChangedField,
  StructureChange,
  StructureTableChange,
} from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  type AnnotatedObject,
  type ChangedLeaf,
  changedLeavesOfReplacedTable,
  type TableStructure,
} from 'src/features/partial-changes/structure/table-structure';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

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

function annotatedFieldOf({
  pointer,
  annotations,
}: AnnotatedObject): ChangedField {
  return { path: pointer.toString(), change: 'annotated', annotations };
}

function changedFieldOf({
  pointer,
  change,
  from,
  annotations,
}: ChangedLeaf): ChangedField {
  const path = pointer.toString();

  if (from) {
    return { path, change, from: from.toString() };
  }

  if (annotations) {
    return { path, change, annotations };
  }

  return { path, change };
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
