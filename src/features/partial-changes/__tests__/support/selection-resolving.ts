import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import {
  isWholeDraftSelection,
  type Selection,
} from 'src/features/partial-changes/selection/selection';
import type {
  PlanBlocker,
  Reason,
  SelectionResolution,
  UnmatchedSelection,
} from 'src/features/partial-changes/selection/selection-resolution';
import { resolveSelection } from 'src/features/partial-changes/selection/selection-resolver';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  type AddressedUnit,
  addressedUnitOf,
  type CatalogueView,
  readCatalogueOfEveryTable,
  readWholeDraftCatalogue,
} from './catalogue-reading';

export interface RequiredUnitView {
  readonly unit: AddressedUnit;
  readonly reason: Reason;
}

export type BlockerView = Omit<PlanBlocker, 'unitKey'> & {
  readonly unit?: AddressedUnit;
};

export interface ResolutionView {
  readonly selected: AddressedUnit[];
  readonly excluded: AddressedUnit[];
  readonly required: RequiredUnitView[];
  readonly blockers: BlockerView[];
  readonly unmatched: UnmatchedSelection;
}

export async function readSelectionResolution(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  selection: Selection,
): Promise<ResolutionView> {
  const view = await readCatalogueResolving(kit, branch, selection);
  const resolution = resolveSelection(selection, {
    snapshot: view.snapshot,
    headSchema: view.headSchema,
    tables: view.tables,
    catalogue: view.catalogue,
  });

  return resolutionView(view.catalogue, resolution);
}

function readCatalogueResolving(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  selection: Selection,
): Promise<CatalogueView> {
  if (isWholeDraftSelection(selection)) {
    return readWholeDraftCatalogue(kit, branch);
  }

  return readCatalogueOfEveryTable(kit, branch);
}

function resolutionView(
  catalogue: ChangeCatalogue,
  resolution: SelectionResolution,
): ResolutionView {
  return {
    selected: unitsAmong(catalogue, resolution.selected).map(addressedUnitOf),
    excluded: unitsAmong(catalogue, resolution.excluded).map(addressedUnitOf),
    required: unitsAmong(catalogue, resolution.required).map((unit) => ({
      unit: addressedUnitOf(unit),
      reason: reasonOf(resolution, unit),
    })),
    blockers: resolution.blockers.map((blocker) =>
      blockerView(catalogue, blocker),
    ),
    unmatched: resolution.unmatched,
  };
}

function unitsAmong(
  catalogue: ChangeCatalogue,
  keys: { has(key: string): boolean },
): CatalogueUnit[] {
  return catalogue.units.filter(({ key }) => keys.has(key));
}

function reasonOf(
  resolution: SelectionResolution,
  { key }: CatalogueUnit,
): Reason {
  const reason = resolution.required.get(key);

  if (!reason) {
    throw new Error(`The required unit ${key} has no reason`);
  }

  return reason;
}

function blockerView(
  catalogue: ChangeCatalogue,
  { unitKey, ...blocker }: PlanBlocker,
): BlockerView {
  if (unitKey === undefined) {
    return blocker;
  }

  return { ...blocker, unit: addressedUnitOf(unitKeyed(catalogue, unitKey)) };
}

function unitKeyed(catalogue: ChangeCatalogue, key: string): CatalogueUnit {
  const unit = catalogue.units.find((candidate) => candidate.key === key);

  if (!unit) {
    throw new Error(`The catalogue has no unit ${key}`);
  }

  return unit;
}
