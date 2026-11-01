import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type {
  ChangeCatalogue,
  ComparedSnapshot,
} from 'src/features/partial-changes/catalogue/change-catalogue';
import { readAddressedRows } from 'src/features/partial-changes/selection/addressed-rows';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import type {
  PlanBlocker,
  Reason,
  SelectionResolution,
  UnmatchedSelection,
} from 'src/features/partial-changes/selection/selection-resolution';
import { resolveSelection } from 'src/features/partial-changes/selection/selection-resolver';
import type { ChangesBranch } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { type AddressedUnit, addressedUnitOf } from './catalogue-reading';
import { readComparedSnapshotFor } from './scoped-reading';
import { readInPlanningTransaction } from './snapshot-reading';

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

export interface ResolvedSelection {
  readonly compared: ComparedSnapshot;
  readonly catalogue: ChangeCatalogue;
  readonly resolution: SelectionResolution;
}

export function readSelectionResolution(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  selection: Selection,
): Promise<ResolutionView> {
  return readInPlanningTransaction(kit, async () => {
    const { catalogue, resolution } = await readResolvedSelection(
      kit,
      branch,
      selection,
    );

    return resolutionView(catalogue, resolution);
  });
}

export async function readResolvedSelection(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  selection: Selection,
): Promise<ResolvedSelection> {
  const compared = await readComparedSnapshotFor(kit, branch, selection);
  const catalogue = await readCatalogueOfSelection(kit, compared, selection);
  const resolution = resolveSelection(selection, {
    ...compared,
    catalogue,
    addressedRows: await readAddressedRows(
      kit.snapshotReader,
      compared.snapshot,
      selection,
    ),
  });

  return { compared, catalogue, resolution };
}

async function readCatalogueOfSelection(
  kit: PartialChangesTestKit,
  compared: ComparedSnapshot,
  selection: Selection,
): Promise<ChangeCatalogue> {
  const scoped = await kit.scopedCatalogueReader.readCatalogue(
    compared,
    selection,
  );

  if (scoped.kind === 'tooLarge') {
    throw new Error(`The read was refused: ${scoped.blocker.message}`);
  }

  return scoped.catalogue;
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

export function blockerView(
  catalogue: ChangeCatalogue,
  { unitKey, ...blocker }: PlanBlocker,
): BlockerView {
  if (unitKey === undefined) {
    return blocker;
  }

  return { ...blocker, unit: addressedUnitOf(unitKeyed(catalogue, unitKey)) };
}

export function unitKeyed(
  catalogue: ChangeCatalogue,
  key: string,
): CatalogueUnit {
  const unit = catalogue.units.find((candidate) => candidate.key === key);

  if (!unit) {
    throw new Error(`The catalogue has no unit ${key}`);
  }

  return unit;
}
