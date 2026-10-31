import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import {
  buildChangeCatalogue,
  type ChangeCatalogue,
} from 'src/features/partial-changes/catalogue/change-catalogue';
import type { Side, Unit } from 'src/features/partial-changes/catalogue/unit';
import type {
  ChangedRows,
  ChangesBranch,
  ComparedTable,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  comparedTablesOf,
  readInPlanningTransaction,
} from './snapshot-reading';

export type AddressedUnit = Unit & { readonly side?: Side };

export interface CatalogueView {
  readonly catalogue: ChangeCatalogue;
  readonly tables: readonly ComparedTable[];
  readonly changedRows: ChangedRows;
  unitsOf(tableId: string): AddressedUnit[];
}

export function readCatalogue(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  tableIds: readonly string[],
): Promise<CatalogueView> {
  return readInPlanningTransaction(kit, async () => {
    const snapshot = await kit.snapshotReader.readSnapshot(branch);
    const tables = comparedTablesOf(kit, snapshot, tableIds);
    const changedRows = await kit.snapshotReader.readChangedRows(tables);
    const catalogue = buildChangeCatalogue({ snapshot, tables, changedRows });

    return {
      catalogue,
      tables,
      changedRows,
      unitsOf: (tableId) =>
        catalogue.units
          .filter(({ unit }) => unit.tableId === tableId)
          .map(addressedUnitOf),
    };
  });
}

function addressedUnitOf({ unit, side }: CatalogueUnit): AddressedUnit {
  if (side === undefined) {
    return unit;
  }

  return { ...unit, side };
}
