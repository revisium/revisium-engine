import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import { storesValueInData } from 'src/features/partial-changes/structure/schema-leaves';
import type {
  PublishedAtOwner,
  TableStructure,
} from 'src/features/partial-changes/structure/table-structure';
import type { ComparedRowColumn } from 'src/features/share/compared-columns';

export type WholeColumn = Exclude<ComparedRowColumn, 'hash'>;

export type ColumnOwner = PublishedAtOwner | { readonly owner: 'rowRename' };

export interface LeafOwner {
  readonly pointer: JsonPointer;
  readonly owner: 'field' | 'structure';
}

const WHOLE_COLUMN_OWNERS: Readonly<
  Record<WholeColumn, (structure: TableStructure) => ColumnOwner>
> = {
  id: () => ({ owner: 'rowRename' }),
  publishedAt: (structure) => structure.publishedAtOwner,
  meta: () => ({ owner: 'rowColumns' }),
  schemaHash: schemaHashOwner,
};

export function columnOwnerOf(
  column: WholeColumn,
  structure: TableStructure,
): ColumnOwner {
  return WHOLE_COLUMN_OWNERS[column](structure);
}

export function leafOwnersOf(structure: TableStructure): LeafOwner[] {
  return [
    ...structure.unchangedLeaves
      .filter(storesValueInData)
      .map((leaf): LeafOwner => ({ pointer: leaf.pointer, owner: 'field' })),
    ...structure.changedPointers.map(
      (pointer): LeafOwner => ({ pointer, owner: 'structure' }),
    ),
  ];
}

function schemaHashOwner(structure: TableStructure): ColumnOwner {
  if (structure.differs) {
    return { owner: 'structure' };
  }

  return { owner: 'rowColumns' };
}
