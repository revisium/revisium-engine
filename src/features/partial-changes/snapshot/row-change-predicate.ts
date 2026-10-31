import { join, raw, sql, type Sql } from 'src/engine-prisma-types';
import {
  columnOwnerOf,
  type LeafOwner,
  leafOwnersOf,
} from 'src/features/partial-changes/structure/column-owners';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';
import {
  COMPARED_ROW_COLUMNS,
  type ComparedRowColumn,
} from 'src/features/share/compared-columns';

export function rowChangePredicate(structure: TableStructure): Sql {
  const differences = COMPARED_ROW_COLUMNS.flatMap((column) => {
    const difference = columnDifference(column, structure);

    return difference ? [difference] : [];
  });

  return join(differences, ' OR ');
}

function columnDifference(
  column: ComparedRowColumn,
  structure: TableStructure,
): Sql | undefined {
  if (column === 'hash') {
    return dataDiffers(structure);
  }

  if (columnOwnerOf(column, structure).owner === 'structure') {
    return undefined;
  }

  return columnDiffers(column);
}

function dataDiffers(structure: TableStructure): Sql | undefined {
  if (!structure.differs) {
    return columnDiffers('hash');
  }

  const leaves = leafOwnersOf(structure).filter(isOwnedByField);

  if (leaves.length === 0) {
    return undefined;
  }

  return join(leaves.map(leafDiffers), ' OR ');
}

function columnDiffers(column: ComparedRowColumn): Sql {
  return raw(`h."${column}" IS DISTINCT FROM d."${column}"`);
}

function leafDiffers(leaf: LeafOwner): Sql {
  const path = [...leaf.pointer.segments];

  return sql`(h."data" #> ${path}::text[]) IS DISTINCT FROM (d."data" #> ${path}::text[])`;
}

function isOwnedByField(leaf: LeafOwner): boolean {
  return leaf.owner === 'field';
}
