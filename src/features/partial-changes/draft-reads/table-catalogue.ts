import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { SidedRows } from 'src/features/partial-changes/catalogue/catalogue-tables';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import {
  buildChangeCatalogue,
  type ChangeCatalogue,
} from 'src/features/partial-changes/catalogue/change-catalogue';
import type { HeadViewsMigration } from 'src/features/partial-changes/catalogue/head-views-migration';
import { groupRecreations } from 'src/features/partial-changes/catalogue/public-id-groups';
import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import {
  type DescribedUnitRef,
  describedUnitRefOf,
} from 'src/features/partial-changes/selection/unit-refs';
import type {
  ChangedRows,
  TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { ComparedSnapshot } from 'src/features/partial-changes/snapshot/compared-snapshot-reader.service';

const NO_CHANGED_ROWS: ChangedRows = new Map();

// The table-level change catalogue of the Draft: structure, views and shared schema units, without row units.
export class TableCatalogue {
  private readonly catalogue: ChangeCatalogue;
  private readonly recreations = new Map<string, readonly TablePair[]>();

  constructor(
    private readonly compared: ComparedSnapshot,
    headViews: HeadViewsMigration,
  ) {
    this.catalogue = buildChangeCatalogue(
      { ...compared, changedRows: NO_CHANGED_ROWS },
      headViews,
    );

    for (const group of groupRecreations(compared.snapshot.tables)) {
      for (const { identity } of group) {
        this.recreations.set(identity, group);
      }
    }
  }

  public get units(): readonly CatalogueUnit[] {
    return this.catalogue.units;
  }

  public isReplaced({ identity }: TablePair): boolean {
    return (this.recreations.get(identity)?.length ?? 0) > 1;
  }

  public refusalOf(table: TablePair): RefusedTable | undefined {
    const { refusedTablesByIdentity } = this.compared.headSchema;

    return (this.recreations.get(table.identity) ?? [table])
      .map(({ identity }) => refusedTablesByIdentity.get(identity))
      .find((refusal) => refusal !== undefined);
  }

  public structureOf(table: TablePair): CatalogueUnit | undefined {
    return this.catalogue.lookup.tableUnitOf('structure', table);
  }

  public viewsOf(table: TablePair): CatalogueUnit | undefined {
    return this.catalogue.lookup.tableUnitOf('views', table);
  }

  public viewsRowsOf(table: TablePair): SidedRows {
    return this.catalogue.tables.viewsRowsOf(table);
  }

  public describe(unit: CatalogueUnit): DescribedUnitRef {
    return describedUnitRefOf(unit, this.catalogue.tables);
  }

  public changedBeyondTableId(table: TablePair): boolean {
    const views = this.viewsRowsOf(table);

    return (
      this.catalogue.tables.structureOf(table).differsBeyondTableId ||
      !deepEqual(views.head?.data, views.draft?.data)
    );
  }
}
