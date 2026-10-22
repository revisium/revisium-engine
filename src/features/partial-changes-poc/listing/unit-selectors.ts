import {
  CatalogueUnit,
  ChangeCatalogue,
} from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import {
  FieldSelector,
  Selection,
} from 'src/features/partial-changes-poc/partial-changes.types';
import {
  hasUnmatched,
  resolveSelection,
} from 'src/features/partial-changes-poc/selection/resolve-selection';

export interface UnitSelector {
  selector: Selection;
  side?: 'head';
}

export function exactSelectorOf(
  catalogue: ChangeCatalogue,
  unit: CatalogueUnit,
): UnitSelector | undefined {
  return candidatesOf(catalogue, unit).find((candidate) =>
    selectsExactly(catalogue, candidate.selector, unit.key),
  );
}

function candidatesOf(
  catalogue: ChangeCatalogue,
  unit: CatalogueUnit,
): UnitSelector[] {
  const { tableId } = unit;
  switch (unit.kind) {
    case 'field':
      return [
        {
          selector: {
            fields: [
              { tableId, rowId: unit.rowId ?? '', path: unit.path ?? '' },
            ],
          },
        },
      ];
    case 'rowCreate':
    case 'rowDelete':
    case 'rowReplace':
      return rowCandidates(catalogue, unit);
    case 'rowRename':
      return renameCandidates(catalogue, unit);
    case 'structure':
      return structureCandidates(catalogue, unit);
    case 'views':
      return [{ selector: { views: [tableId] } }];
    case 'sharedSchema':
      return [{ selector: { sharedSchemas: [tableId] } }];
    default:
      return [];
  }
}

function rowCandidates(
  catalogue: ChangeCatalogue,
  unit: CatalogueUnit,
): UnitSelector[] {
  const { tableId } = unit;
  const headRowId = rowOf(catalogue, unit)?.pair.head?.id;
  const candidates: UnitSelector[] = [
    { selector: { rows: [{ tableId, rowId: unit.rowId ?? '' }] } },
  ];
  if (headRowId !== undefined) {
    candidates.push({
      selector: { rows: [{ tableId, rowId: headRowId, side: 'head' }] },
      side: 'head',
    });
  }
  return candidates;
}

function renameCandidates(
  catalogue: ChangeCatalogue,
  unit: CatalogueUnit,
): UnitSelector[] {
  const { tableId } = unit;
  const rowId = unit.rowId ?? '';
  const fields: FieldSelector[] = [
    ...(rowOf(catalogue, unit)?.fieldUnits.keys() ?? []),
  ].map((path) => ({ tableId, rowId, path }));
  const rows = [{ tableId, rowId }];

  return [
    {
      selector: fields.length > 0 ? { rows, exclude: { fields } } : { rows },
    },
  ];
}

function structureCandidates(
  catalogue: ChangeCatalogue,
  unit: CatalogueUnit,
): UnitSelector[] {
  const headTableId = catalogue.tables.get(unit.tableCreatedId)?.pair.head?.id;
  const candidates: UnitSelector[] = [{ selector: { tables: [unit.tableId] } }];
  if (headTableId !== undefined) {
    candidates.push({
      selector: { tables: [{ tableId: headTableId, side: 'head' }] },
      side: 'head',
    });
  }
  return candidates;
}

function rowOf(catalogue: ChangeCatalogue, unit: CatalogueUnit) {
  const table = catalogue.tables.get(unit.tableCreatedId);
  const rowCreatedId = unit.rowCreatedIds[0];
  return rowCreatedId === undefined ? undefined : table?.rows.get(rowCreatedId);
}

function selectsExactly(
  catalogue: ChangeCatalogue,
  selector: Selection,
  key: string,
): boolean {
  const resolution = resolveSelection(catalogue, selector);
  return (
    resolution.selected.size === 1 &&
    resolution.selected.has(key) &&
    resolution.required.size === 0 &&
    resolution.blockers.length === 0 &&
    !hasUnmatched(resolution.unmatched)
  );
}
