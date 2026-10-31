import { join, raw, sql, type Sql } from 'src/engine-prisma-types';
import type { SchemaLeaf } from 'src/features/partial-changes/structure/schema-leaves';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';
import {
  COMPARED_ROW_COLUMNS,
  type ComparedRowColumn,
} from 'src/features/share/compared-columns';

type ColumnComparison = (structure: TableStructure) => Sql | undefined;

const COLUMN_COMPARISONS: Readonly<
  Record<ComparedRowColumn, ColumnComparison>
> = {
  id: () => columnDiffers('id'),
  hash: dataDiffers,
  schemaHash: schemaHashDiffers,
  publishedAt: publishedAtDiffers,
  meta: () => columnDiffers('meta'),
};

export function rowChangePredicate(structure: TableStructure): Sql {
  const differences = COMPARED_ROW_COLUMNS.flatMap((column) => {
    const difference = COLUMN_COMPARISONS[column](structure);

    return difference ? [difference] : [];
  });

  return join(differences, ' OR ');
}

function dataDiffers(structure: TableStructure): Sql | undefined {
  if (!structure.differs) {
    return columnDiffers('hash');
  }

  const leaves = structure.unchangedLeaves.filter(storesValueInData);

  if (leaves.length === 0) {
    return undefined;
  }

  return join(leaves.map(leafDiffers), ' OR ');
}

function schemaHashDiffers(structure: TableStructure): Sql | undefined {
  if (structure.differs) {
    return undefined;
  }

  return columnDiffers('schemaHash');
}

function publishedAtDiffers(structure: TableStructure): Sql | undefined {
  if (structure.publishedAtOwner.owner === 'structure') {
    return undefined;
  }

  return columnDiffers('publishedAt');
}

function columnDiffers(column: ComparedRowColumn): Sql {
  return raw(`h."${column}" IS DISTINCT FROM d."${column}"`);
}

function leafDiffers(leaf: SchemaLeaf): Sql {
  const path = [...leaf.pointer.segments];

  return sql`(h."data" #> ${path}::text[]) IS DISTINCT FROM (d."data" #> ${path}::text[])`;
}

function storesValueInData(leaf: SchemaLeaf): boolean {
  return leaf.kind === 'value' || leaf.kind === 'atomic';
}
