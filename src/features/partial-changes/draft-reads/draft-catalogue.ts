import type { AddressedRow } from 'src/features/partial-changes/catalogue/catalogue-lookup';
import type { SidedRows } from 'src/features/partial-changes/catalogue/catalogue-tables';
import type {
  CatalogueRow,
  CatalogueUnit,
} from 'src/features/partial-changes/catalogue/catalogue-unit';
import {
  buildChangeCatalogue,
  type ChangeCatalogue,
} from 'src/features/partial-changes/catalogue/change-catalogue';
import { carriesViewsChange } from 'src/features/partial-changes/catalogue/views-units';
import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import { AddressedRows } from 'src/features/partial-changes/selection/addressed-rows';
import { FieldNormalisation } from 'src/features/partial-changes/selection/field-normalisation';
import type { FieldRef } from 'src/features/partial-changes/selection/selection';
import { SelectionTargets } from 'src/features/partial-changes/selection/selection-targets';
import type { SelectorMatch } from 'src/features/partial-changes/selection/selector-match';
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

// The Draft reads address rows by identity, so no selector resolves a row through its public id.
const NO_ADDRESSED_ROWS = new AddressedRows(new Map());

type RowsByIdentity = ReadonlyMap<string, CatalogueRow>;

// The change catalogue of the Draft: the table-level units, and the row units of the changed rows it is given.
export class DraftCatalogue {
  private readonly catalogue: ChangeCatalogue;
  private readonly targets: SelectionTargets;
  private readonly loadedRows: ReadonlyMap<string, RowsByIdentity>;

  private constructor(compared: ComparedSnapshot, changedRows: ChangedRows) {
    this.catalogue = buildChangeCatalogue({ ...compared, changedRows });
    this.targets = new SelectionTargets({
      ...compared,
      catalogue: this.catalogue,
      addressedRows: NO_ADDRESSED_ROWS,
    });
    this.loadedRows = rowsByIdentityOf(this.catalogue.rows);
  }

  public static tableLevel(compared: ComparedSnapshot): DraftCatalogue {
    return new DraftCatalogue(compared, NO_CHANGED_ROWS);
  }

  public static withChangedRows(
    compared: ComparedSnapshot,
    changedRows: ChangedRows,
  ): DraftCatalogue {
    return new DraftCatalogue(compared, changedRows);
  }

  public get units(): readonly CatalogueUnit[] {
    return this.catalogue.units;
  }

  public isReplaced(table: TablePair): boolean {
    return this.targets.recreationOf(table).length > 1;
  }

  public refusalOf(table: TablePair): RefusedTable | undefined {
    const [refusal] = this.targets.refusalsOfStructure(table);

    return refusal;
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
    const { tables } = this.catalogue;
    const structure = this.structureOf(table);

    return (
      tables.structureOf(table).differsBeyondTableId ||
      (structure !== undefined && carriesViewsChange(structure, tables))
    );
  }

  public unit(key: string): CatalogueUnit {
    return this.catalogue.lookup.unit(key);
  }

  public unitsOfRow(row: AddressedRow): CatalogueUnit[] {
    return this.catalogue.lookup.unitsOfRow(row);
  }

  public changedRowOf(
    { identity }: TablePair,
    rowIdentity: string,
  ): CatalogueRow | undefined {
    return this.loadedRows.get(identity)?.get(rowIdentity);
  }

  public matchField(row: AddressedRow, selector: FieldRef): SelectorMatch {
    return new FieldNormalisation(
      this.targets,
      this.catalogue.lookup,
      row,
      selector,
    ).match();
  }
}

function rowsByIdentityOf(
  rows: ReadonlyMap<string, readonly CatalogueRow[]>,
): Map<string, RowsByIdentity> {
  return new Map(
    [...rows].map(([tableIdentity, tableRows]) => [
      tableIdentity,
      new Map(tableRows.map((row) => [row.pair.identity, row])),
    ]),
  );
}
