import type { Migration } from '@revisium/schema-toolkit/types';
import type { Row } from 'src/engine-prisma-types';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { ChangesSnapshot } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { type CatalogueView, describeMigration } from './catalogue-reading';

export function pendingMigrationViolationsOf(view: CatalogueView): string[] {
  const unattributable = unattributableMigrationIdsOf(view);

  return pendingMigrationRowsOf(view.snapshot).flatMap((row) => {
    const migration = row.data as unknown as Migration;
    const owners = view.catalogue.units.filter((unit) => owns(unit, row));
    const expectedOwners = unattributable.has(migration.id) ? 0 : 1;

    if (
      owners.length === expectedOwners &&
      owners.every(({ unit }) => unit.kind === 'structure')
    ) {
      return [];
    }

    return [
      `pending migration ${describeMigration(migration)} is owned by [${owners.map(({ unit }) => JSON.stringify(unit)).join(', ')}]`,
    ];
  });
}

function pendingMigrationRowsOf(snapshot: ChangesSnapshot): Row[] {
  const { head, draft } = snapshot.systemRows.migrations;
  const published = new Set(head.map(({ versionId }) => versionId));

  return draft.filter(({ versionId }) => !published.has(versionId));
}

function unattributableMigrationIdsOf(view: CatalogueView): Set<string> {
  return new Set(
    view.ledgerInconsistencies.flatMap((inconsistency) => {
      if (inconsistency.reason !== 'unattributableMigration') {
        return [];
      }

      return [inconsistency.migrationId];
    }),
  );
}

function owns(unit: CatalogueUnit, row: Row): boolean {
  return unit.systemRows.some(({ versionId }) => versionId === row.versionId);
}
