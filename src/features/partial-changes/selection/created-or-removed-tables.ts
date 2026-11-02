import type { CatalogueLookup } from 'src/features/partial-changes/catalogue/catalogue-lookup';
import type { SelectionTargets } from 'src/features/partial-changes/selection/selection-targets';
import {
  refusing,
  requiringUnit,
  type SelectorMatch,
} from 'src/features/partial-changes/selection/selector-match';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';

export interface ReasonSubject {
  readonly tableId: string;
  readonly rowId?: string;
  readonly path?: string;
}

export function isCreatedOrRemoved({ head, draft }: TablePair): boolean {
  return head === undefined || draft === undefined;
}

export function requireStructureOfCreatedOrRemoved(
  targets: SelectionTargets,
  units: CatalogueLookup,
  table: TablePair,
  { tableId, rowId, path }: ReasonSubject,
): SelectorMatch {
  return (
    refusing(targets.refusalsOfStructure(table)) ??
    requiringUnit(units.tableUnitOf('structure', table), {
      code: 'structureBoundData',
      tableId,
      rowId,
      path,
      because: `the rows of ${tableId} exist only with its structure (created or removed table)`,
    })
  );
}
