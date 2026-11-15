import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import { buildChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import type { UnitAddress } from 'src/features/partial-changes/catalogue/unit';
import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import {
  type DescribedUnitRef,
  describedUnitRefOf,
  type UnitRef,
} from 'src/features/partial-changes/selection/unit-refs';
import type {
  ChangesBranch,
  ChangesSnapshot,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { AddressedUnit } from './catalogue-reading';
import {
  readComparedSnapshot,
  readInPlanningTransaction,
} from './snapshot-reading';

export interface UnitListOptions {
  readonly tableId?: string;
}

// Every selectable unit of the Draft in unit order, as a preview names a required unit.
export interface UnitList {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly units: readonly DescribedUnitRef[];
  readonly refusedTables: readonly RefusedTable[];
}

export function readUnitList(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  { tableId }: UnitListOptions = {},
): Promise<UnitList> {
  return readInPlanningTransaction(kit, async () => {
    const compared = await readComparedSnapshot(kit, branch);
    const changedRows = await kit.snapshotReader.readChangedRows(
      compared.tables,
    );
    const catalogue = buildChangeCatalogue({ ...compared, changedRows });
    const isListed = tableFilterOf(compared.snapshot, tableId);

    return {
      headRevisionId: compared.snapshot.headRevisionId,
      draftRevisionId: compared.snapshot.draftRevisionId,
      units: catalogue.units
        .filter(isListed)
        .map((unit) => describedUnitRefOf(unit, catalogue.tables)),
      refusedTables: catalogue.refusedTables,
    };
  });
}

export function addressedUnitOfListed(listed: UnitRef): AddressedUnit {
  const { kind, side } = listed;
  const parts: Partial<UnitAddress> = listed;
  const { previousTableId, rowId, previousRowId, path, columns } = parts;

  return {
    kind,
    tableId: addressIdOf(listed),
    previousTableId,
    rowId,
    previousRowId,
    path,
    columns,
    side,
  };
}

function addressIdOf(unit: UnitRef): string {
  if (unit.kind === 'sharedSchema') {
    return unit.sharedSchemaId;
  }

  return unit.tableId;
}

// The units of the table with that Draft id, or else that Head id, on either side.
function tableFilterOf(
  snapshot: ChangesSnapshot,
  tableId: string | undefined,
): (unit: CatalogueUnit) => boolean {
  if (tableId === undefined) {
    return () => true;
  }

  const pair =
    snapshot.tables.find(({ draft }) => draft?.id === tableId) ??
    snapshot.tables.find(({ head }) => head?.id === tableId);

  if (!pair) {
    throw new Error(`tableId "${tableId}" names no Head or Draft table`);
  }

  return ({ tableIdentities }) => tableIdentities.includes(pair.identity);
}
