import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { Migration } from '@revisium/schema-toolkit/types';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { Row } from 'src/engine-prisma-types';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import {
  buildChangeCatalogue,
  type ChangeCatalogue,
} from 'src/features/partial-changes/catalogue/change-catalogue';
import { HeadViewsMigration } from 'src/features/partial-changes/catalogue/head-views-migration';
import type { LedgerInconsistency } from 'src/features/partial-changes/catalogue/ledger-inconsistency';
import type { Side, Unit } from 'src/features/partial-changes/catalogue/unit';
import type {
  ChangedRows,
  ChangesBranch,
  ChangesSnapshot,
  ComparedTable,
  RevisionRows,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  affectedTablesOf,
  readComparedSnapshot,
  readInPlanningTransaction,
} from './snapshot-reading';

export type AddressedUnit = Unit & { readonly side?: Side };

export interface CatalogueView {
  readonly catalogue: ChangeCatalogue;
  readonly snapshot: ChangesSnapshot;
  readonly tables: readonly ComparedTable[];
  readonly changedRows: ChangedRows;
  readonly ledgerInconsistencies: readonly LedgerInconsistency[];
  units(): AddressedUnit[];
  unitsOf(tableId: string): AddressedUnit[];
  systemRowsOf(unit: AddressedUnit): string[];
}

export function readCatalogue(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  tableIds: readonly string[],
): Promise<CatalogueView> {
  return readInPlanningTransaction(kit, async () => {
    const { snapshot, ledger, tables } = await readComparedSnapshot(
      kit,
      branch,
    );
    const changedRows = await kit.snapshotReader.readChangedRows(
      affectedTablesOf(snapshot, tables, tableIds),
    );
    const catalogue = buildChangeCatalogue(
      { snapshot, ledger, tables, changedRows },
      new HeadViewsMigration(kit.viewsMigration, kit.schemaRules),
    );

    return catalogueView(catalogue, snapshot, tables, changedRows);
  });
}

function catalogueView(
  catalogue: ChangeCatalogue,
  snapshot: ChangesSnapshot,
  tables: readonly ComparedTable[],
  changedRows: ChangedRows,
): CatalogueView {
  return {
    catalogue,
    snapshot,
    tables,
    changedRows,
    ledgerInconsistencies: catalogue.ledgerInconsistencies,
    units: () => catalogue.units.map(addressedUnitOf),
    unitsOf: (tableId) =>
      catalogue.units
        .filter(({ unit }) => unit.tableId === tableId)
        .map(addressedUnitOf),
    systemRowsOf: (unit) =>
      unitAddressedAs(catalogue, unit)
        .systemRows.map((row) => describeSystemRow(snapshot, row))
        .sort(),
  };
}

function addressedUnitOf({ unit, side }: CatalogueUnit): AddressedUnit {
  if (side === undefined) {
    return unit;
  }

  return { ...unit, side };
}

function unitAddressedAs(
  catalogue: ChangeCatalogue,
  addressed: AddressedUnit,
): CatalogueUnit {
  const unit = catalogue.units.find((candidate) =>
    deepEqual(addressedUnitOf(candidate), addressed),
  );

  if (!unit) {
    throw new Error(`The catalogue has no unit ${JSON.stringify(addressed)}`);
  }

  return unit;
}

function describeSystemRow(snapshot: ChangesSnapshot, row: Row): string {
  const { schemas, views, migrations, sharedSchemas } = snapshot.systemRows;

  if (isIn(migrations, row)) {
    return `migration ${describeMigration(row.data as unknown as Migration)}`;
  }

  if (isIn(schemas, row)) {
    return `schema ${row.id}`;
  }

  if (isIn(views, row)) {
    return `views ${row.id}`;
  }

  if (isIn(sharedSchemas, row)) {
    return `sharedSchema ${row.id}`;
  }

  return `unknown ${row.id}`;
}

export function describeMigration(migration: Migration): string {
  if (migration.changeType === 'rename') {
    return `rename ${migration.tableId} to ${migration.nextTableId}`;
  }

  return `${migration.changeType} ${migration.tableId}`;
}

function isIn(rows: RevisionRows, row: Row): boolean {
  return [...rows.head, ...rows.draft].some(
    ({ versionId }) => versionId === row.versionId,
  );
}
