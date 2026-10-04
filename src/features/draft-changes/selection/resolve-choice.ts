import type {
  DraftChangesCatalogue,
  DraftChangesChoice,
  DraftChangesDeniedTarget,
} from 'src/features/draft-changes/queries/impl';
import type { ChoiceResolution } from 'src/features/draft-changes/selection/selection-set';
import { isStaleChangeReference } from 'src/features/draft-changes/catalogue/change-references';
import { resolveRow, resolveTable } from './entity-selectors';
import { selectFieldEntries } from './field-selectors';

export function resolveChoice(
  catalogue: DraftChangesCatalogue,
  choice: DraftChangesChoice,
  mode: 'include' | 'exclude',
): ChoiceResolution {
  switch (choice.kind) {
    case 'change':
      return changeChoice(catalogue, choice.ref.value, mode);
    case 'all':
      return allChoice(catalogue, mode);
    case 'table':
      return tableChoice(catalogue, choice, mode);
    case 'rows':
      return rowChoice(catalogue, choice.tableId, choice.rowIds ?? 'all', mode);
    case 'rowFields':
    case 'schemaFields':
      return fieldChoice(catalogue, choice, mode);
    default:
      return { blocker: 'UNKNOWN_TARGET' };
  }
}

function allChoice(
  catalogue: DraftChangesCatalogue,
  mode: 'include' | 'exclude',
): ChoiceResolution {
  return {
    entries: catalogue.entries.filter(({ selectable }) => selectable),
    deniedTargets: mode === 'exclude' ? allDeniedTargets(catalogue) : [],
  };
}

function tableChoice(
  catalogue: DraftChangesCatalogue,
  choice: Extract<DraftChangesChoice, { kind: 'table' }>,
  mode: 'include' | 'exclude',
): ChoiceResolution {
  const resolution = resolveTable(catalogue, choice.tableId);
  if ('blocker' in resolution) {
    return { blocker: resolution.blocker };
  }
  const table = resolution.binding;
  const rows = choice.rows ?? 'all';
  const entries = catalogue.entries.filter(
    (entry) =>
      entry.target.tableCreatedId === table.entityCreatedId &&
      (rows !== 'none' ||
        entry.kind === 'table' ||
        entry.kind === 'schemaField') &&
      entry.selectable,
  );
  const deniedTargets: DraftChangesDeniedTarget[] =
    mode === 'exclude'
      ? [
          {
            kind: 'table',
            tableCreatedId: table.entityCreatedId,
            facets:
              rows === 'none'
                ? ['lifecycle', 'schemaFields']
                : ['lifecycle', 'rows', 'schemaFields'],
          },
        ]
      : [];
  return { entries, deniedTargets };
}

function fieldChoice(
  catalogue: DraftChangesCatalogue,
  choice: Extract<DraftChangesChoice, { kind: 'rowFields' | 'schemaFields' }>,
  mode: 'include' | 'exclude',
): ChoiceResolution {
  const fieldResult = selectFieldEntries(catalogue, choice);
  if (fieldResult.blocker) {
    return { blocker: fieldResult.blocker };
  }
  return {
    entries: fieldResult.entries,
    deniedTargets:
      mode === 'exclude' ? fieldDeniedTargets(catalogue, choice) : [],
  };
}

function changeChoice(
  catalogue: DraftChangesCatalogue,
  refValue: string,
  mode: 'include' | 'exclude',
): ChoiceResolution {
  const entry = catalogue.entries.find(({ ref }) => ref.value === refValue);
  if (entry) {
    return {
      entries: [entry],
      deniedTargets:
        mode === 'exclude'
          ? [{ kind: 'change', ref: entry.ref, target: entry.target }]
          : [],
    };
  }
  return {
    blocker: isStaleChangeReference(refValue, catalogue.scope)
      ? 'STALE_CATALOGUE'
      : 'UNKNOWN_REFERENCE',
    ref: refValue,
  };
}

function rowChoice(
  catalogue: DraftChangesCatalogue,
  tableId: string,
  requested: 'all' | string[],
  mode: 'include' | 'exclude',
): ChoiceResolution {
  const tableResult = resolveTable(catalogue, tableId);
  if ('blocker' in tableResult) {
    return { blocker: tableResult.blocker };
  }
  const table = tableResult.binding;
  const rowBindings = catalogue.identityBindings.filter(
    (binding) =>
      binding.kind === 'row' &&
      binding.tableCreatedId === table.entityCreatedId,
  );
  const selected = requested === 'all' ? rowBindings : [];
  if (requested !== 'all') {
    for (const rowId of requested) {
      const row = resolveRow(catalogue, table.entityCreatedId, rowId);
      if ('blocker' in row) {
        return { blocker: row.blocker };
      }
      selected.push(row.binding);
    }
  }
  const ids = new Set(selected.map(({ entityCreatedId }) => entityCreatedId));
  const entries = catalogue.entries.filter(
    (entry) =>
      entry.target.tableCreatedId === table.entityCreatedId &&
      (entry.target.kind === 'row' || entry.target.kind === 'rowField') &&
      ids.has(entry.target.rowCreatedId) &&
      entry.selectable,
  );
  const deniedTargets: DraftChangesDeniedTarget[] =
    mode === 'exclude'
      ? selected.map((row) => ({
          kind: 'row',
          tableCreatedId: table.entityCreatedId,
          rowCreatedId: row.entityCreatedId,
          facets: ['lifecycle', 'rowFields'],
        }))
      : [];
  return { entries, deniedTargets };
}

function fieldDeniedTargets(
  catalogue: DraftChangesCatalogue,
  choice: Extract<DraftChangesChoice, { kind: 'rowFields' | 'schemaFields' }>,
): DraftChangesDeniedTarget[] {
  const tableResult = resolveTable(catalogue, choice.tableId);
  if ('blocker' in tableResult) {
    return [];
  }
  const tableCreatedId = tableResult.binding.entityCreatedId;
  const paths = choice.paths ?? 'all';
  if (choice.kind === 'schemaFields') {
    if (paths === 'all') {
      return [{ kind: 'schemaFields', tableCreatedId, paths }];
    }
    return paths.map((path) => ({ kind: 'schemaField', tableCreatedId, path }));
  }
  const rowResult = resolveRow(catalogue, tableCreatedId, choice.rowId);
  if ('blocker' in rowResult) {
    return [];
  }
  const rowCreatedId = rowResult.binding.entityCreatedId;
  if (paths === 'all') {
    return [{ kind: 'rowFields', tableCreatedId, rowCreatedId, paths }];
  }
  return paths.map((path) => ({
    kind: 'rowField',
    tableCreatedId,
    rowCreatedId,
    path,
  }));
}

function allDeniedTargets(
  catalogue: DraftChangesCatalogue,
): DraftChangesDeniedTarget[] {
  const result: DraftChangesDeniedTarget[] = [];
  for (const binding of catalogue.identityBindings) {
    if (binding.kind === 'table') {
      result.push({
        kind: 'table',
        tableCreatedId: binding.entityCreatedId,
        facets: ['lifecycle', 'rows', 'schemaFields'],
      });
    } else {
      result.push({
        kind: 'row',
        tableCreatedId: binding.tableCreatedId,
        rowCreatedId: binding.entityCreatedId,
        facets: ['lifecycle', 'rowFields'],
      });
    }
  }
  return result;
}
