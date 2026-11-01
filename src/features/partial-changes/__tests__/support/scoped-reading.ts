import type { ProviderOverride } from 'src/__tests__/kit/create-database-service-test-kit';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ComparedSnapshot } from 'src/features/partial-changes/catalogue/change-catalogue';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import { ReadScope } from 'src/features/partial-changes/scope/read-scope';
import type { ScopedCatalogue } from 'src/features/partial-changes/scope/scoped-catalogue-reader.service';
import {
  isWholeDraftSelection,
  type Selection,
} from 'src/features/partial-changes/selection/selection';
import type { PlanBlocker } from 'src/features/partial-changes/selection/selection-resolution';
import type {
  ChangesBranch,
  ChangesSnapshot,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { type AddressedUnit, addressedUnitOf } from './catalogue-reading';
import {
  readComparedSnapshot,
  readInPlanningTransaction,
  tableIdOf,
} from './snapshot-reading';

export type ScopedCatalogueView =
  | {
      readonly kind: 'catalogue';
      readonly changedRows: number;
      readonly unreadTables: number;
      readonly readTableIds: readonly string[];
      readonly units: readonly AddressedUnit[];
    }
  | {
      readonly kind: 'tooLarge';
      readonly changedRows: number;
      readonly unreadTables: number;
      readonly blocker: PlanBlocker;
    };

const readingEveryTable: Pick<ReadScope, 'scopeOf'> = {
  scopeOf: (_selection, compared) => ({
    affectedTables: compared.tables,
    unreadTables: 0,
  }),
};

export const READING_EVERY_TABLE: ProviderOverride = {
  provide: ReadScope,
  useValue: readingEveryTable,
};

export function readScopedCatalogue(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  selection: Selection,
): Promise<ScopedCatalogueView> {
  return readInPlanningTransaction(kit, async () => {
    const compared = await readComparedSnapshotFor(kit, branch, selection);
    const scoped = await kit.scopedCatalogueReader.readCatalogue(
      compared,
      selection,
    );

    return scopedCatalogueView(compared.snapshot, scoped);
  });
}

export function readComparedSnapshotFor(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  selection: Selection,
): Promise<ComparedSnapshot> {
  return readComparedSnapshot(kit, branch, {
    wholeDraft: isWholeDraftSelection(selection),
  });
}

export function unitsOfTable(
  view: ScopedCatalogueView,
  tableId: string,
): AddressedUnit[] {
  if (view.kind !== 'catalogue') {
    throw new Error(`The read was refused: ${view.blocker.message}`);
  }

  return view.units.filter((unit) => unit.tableId === tableId);
}

function scopedCatalogueView(
  snapshot: ChangesSnapshot,
  scoped: ScopedCatalogue,
): ScopedCatalogueView {
  const { changedRowCount, unreadTables } = scoped;

  if (scoped.kind === 'tooLarge') {
    return {
      kind: 'tooLarge',
      changedRows: changedRowCount,
      unreadTables,
      blocker: scoped.blocker,
    };
  }

  return {
    kind: 'catalogue',
    changedRows: changedRowCount,
    unreadTables,
    readTableIds: [...scoped.catalogue.rows.keys()]
      .map((identity) => tableIdOf(snapshot, identity))
      .sort(compareCodePoints),
    units: scoped.catalogue.units.map(addressedUnitOf),
  };
}
