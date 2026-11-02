import type { CatalogueTables } from 'src/features/partial-changes/catalogue/catalogue-tables';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type {
  ChangedField,
  StructureChange,
  TableChange,
} from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

type WholeTableChange = Exclude<TableChange, 'changed'>;

export function structureChangeOf(
  { tableIdentities }: CatalogueUnit,
  tables: CatalogueTables,
): StructureChange {
  const pairs = tableIdentities.map((identity) => tables.pairOf(identity));
  const changedTable = pairs.find(isOnBothSides);

  if (changedTable) {
    return {
      table: 'changed',
      fields: changedFieldsOf(tables.structureOf(changedTable)),
    };
  }

  return { table: wholeTableChangeOf(pairs), fields: [] };
}

function wholeTableChangeOf(pairs: readonly TablePair[]): WholeTableChange {
  if (pairs.length === 0) {
    return 'transient';
  }

  if (pairs.every(isCreated)) {
    return 'created';
  }

  if (pairs.every(isRemoved)) {
    return 'removed';
  }

  return 'replaced';
}

function changedFieldsOf({ changedLeaves }: TableStructure): ChangedField[] {
  return changedLeaves
    .map(({ pointer, change }) => ({ path: pointer.toString(), change }))
    .sort((left, right) => compareCodePoints(left.path, right.path));
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
