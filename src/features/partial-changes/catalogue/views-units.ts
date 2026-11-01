import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { Row } from 'src/engine-prisma-types';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import {
  type CatalogueTables,
  distinctRows,
  publicTableIdOf,
} from 'src/features/partial-changes/catalogue/catalogue-tables';
import type { HeadViewsMigration } from 'src/features/partial-changes/catalogue/head-views-migration';
import { viewsUnitKey } from 'src/features/partial-changes/catalogue/unit-key';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { TableViewsData } from 'src/features/views/types';

export function buildViewsUnits(
  tables: CatalogueTables,
  headViews: HeadViewsMigration,
): CatalogueUnit[] {
  return new ViewsUnitsBuilder(tables, headViews).build();
}

class ViewsUnitsBuilder {
  constructor(
    private readonly tables: CatalogueTables,
    private readonly headViews: HeadViewsMigration,
  ) {}

  public build(): CatalogueUnit[] {
    return this.tables.pairs.flatMap((pair) => {
      if (!this.hasIndependentViewsEdit(pair)) {
        return [];
      }

      return [this.viewsUnitOf(pair)];
    });
  }

  private hasIndependentViewsEdit(pair: TablePair): boolean {
    if (!pair.draft) {
      return false;
    }

    const views = this.tables.viewsRowsOf(pair);

    return !deepEqual(
      views.draft?.data,
      this.migratedHeadViewsOf(pair, views.head),
    );
  }

  private migratedHeadViewsOf(
    pair: TablePair,
    headViews: Row | undefined,
  ): TableViewsData | undefined {
    if (!pair.head || !headViews) {
      return undefined;
    }

    return this.headViews.migrate(
      headViews.data as unknown as TableViewsData,
      pair.head.schema,
      this.tables.structureOf(pair).pendingHistory,
    );
  }

  private viewsUnitOf(pair: TablePair): CatalogueUnit {
    const views = this.tables.viewsRowsOf(pair);
    const schema = this.tables.schemaRowsOf(pair);

    return {
      key: viewsUnitKey(pair.identity),
      tableIdentities: [pair.identity],
      rowIdentities: [],
      systemRows: distinctRows([
        views.head,
        views.draft,
        schema.head,
        schema.draft,
      ]),
      unit: { kind: 'views', tableId: publicTableIdOf(pair) },
    };
  }
}
