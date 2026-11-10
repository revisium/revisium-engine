import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
import type { JsonValue } from 'src/engine-prisma-types';
import {
  type CatalogueTables,
  distinctRows,
} from 'src/features/partial-changes/catalogue/catalogue-tables';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import { viewsUnitKey } from 'src/features/partial-changes/catalogue/unit-key';
import {
  publicTableIdOf,
  type TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';

// A table whose structure changed has no views unit: its views document travels with the structure unit (§3.6).
export function buildViewsUnits(tables: CatalogueTables): CatalogueUnit[] {
  return tables.pairs
    .filter((pair) => hasViewsUnit(pair, tables))
    .map((pair) => viewsUnitOf(pair, tables));
}

export function carriesViewsChange(
  { tableIdentities }: CatalogueUnit,
  tables: CatalogueTables,
): boolean {
  return viewsDiffer(
    tableIdentities.map((identity) => tables.pairOf(identity)),
    tables,
  );
}

// The views document under the Head id in Head against the one under the Draft id in Draft; a side without the table
// or without a views row has none (§5.2).
export function viewsDiffer(
  pairs: readonly TablePair[],
  tables: CatalogueTables,
): boolean {
  return !deepEqual(
    viewsDocumentOn(pairs, 'head', tables),
    viewsDocumentOn(pairs, 'draft', tables),
  );
}

function hasViewsUnit(pair: TablePair, tables: CatalogueTables): boolean {
  return (
    pair.head !== undefined &&
    pair.draft !== undefined &&
    !tables.structureOf(pair).differs &&
    viewsDiffer([pair], tables)
  );
}

function viewsDocumentOn(
  pairs: readonly TablePair[],
  side: RevisionSide,
  tables: CatalogueTables,
): JsonValue | undefined {
  return pairs
    .map((pair) => tables.viewsRowsOf(pair)[side])
    .find((row) => row !== undefined)?.data;
}

function viewsUnitOf(pair: TablePair, tables: CatalogueTables): CatalogueUnit {
  const views = tables.viewsRowsOf(pair);

  return {
    key: viewsUnitKey(pair.identity),
    tableIdentities: [pair.identity],
    rowIdentities: [],
    systemRows: distinctRows([views.head, views.draft]),
    unit: { kind: 'views', tableId: publicTableIdOf(pair) },
  };
}
