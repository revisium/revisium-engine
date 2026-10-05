import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { CandidateViewBlocker } from 'src/features/draft-changes/queries/impl/resolve-candidate-views.query';
import type { DraftChangesCatalogueBlocker } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { StoredViewsSource } from 'src/features/draft-changes/schema/schema-view-baselines';
import { findTable } from 'src/features/draft-changes/candidates/candidate-state';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { ViewValidationService } from 'src/features/views/services/view-validation.service';

export type ValidatedViewsSourceResult =
  | { status: 'loaded'; source: StoredViewsSource }
  | {
      status: 'blocked';
      kind: 'invalid' | 'ambiguous';
      message: string;
    };

export function sourceStateForViewsWrite(
  head: DraftRevisionState,
  draft: DraftRevisionState,
  tableCreatedId: string,
  targetRole: 'head' | 'draft',
): DraftRevisionState {
  const preferred = targetRole === 'head' ? draft : head;
  const fallback = targetRole === 'head' ? head : draft;
  return hasStoredViewsRow(preferred, tableCreatedId) ? preferred : fallback;
}

export async function readValidatedViewsSource(
  state: DraftRevisionState,
  tableCreatedId: string,
  tableId: string,
  validation: ViewValidationService,
): Promise<ValidatedViewsSourceResult> {
  const containers = state.tables.filter(({ id }) => id === SystemTables.Views);
  if (containers.length > 1) {
    return ambiguousViewsSource(tableId, 'multiple native views containers');
  }
  const owner = findTable(state, tableCreatedId);
  if (!owner) {
    return { status: 'loaded', source: { present: false } };
  }
  if (owner.id !== tableId) {
    return ambiguousViewsSource(tableId, 'a mismatched stable table binding');
  }
  const container = containers[0];
  if (!container) {
    return { status: 'loaded', source: { present: false } };
  }
  const rows = container.rows.filter(({ id }) => id === owner.id);
  if (rows.length > 1) {
    return ambiguousViewsSource(tableId, 'multiple rows for the same table');
  }
  const row = rows[0];
  if (!row) {
    return { status: 'loaded', source: { present: false } };
  }
  try {
    return {
      status: 'loaded',
      source: {
        present: true,
        value: await validation.validateViewsData(row.data),
      },
    };
  } catch (error) {
    const failure = validation.describeValidationFailure(error);
    if (!failure) {
      throw error;
    }
    return {
      status: 'blocked',
      kind: failure.category === 'identity' ? 'ambiguous' : 'invalid',
      message: failure.message,
    };
  }
}

export function validatedViewsSourceBlocker(
  source: Extract<ValidatedViewsSourceResult, { status: 'blocked' }>,
  tableCreatedId: string,
): CandidateViewBlocker {
  return {
    code:
      source.kind === 'ambiguous'
        ? 'INVALID_VIEW_IDENTITY'
        : 'INVALID_VIEW_DATA',
    message: source.message,
    tableCreatedId,
  };
}

export function viewSourceCatalogueBlocker(
  source: Extract<ValidatedViewsSourceResult, { status: 'blocked' }>,
  tableCreatedId: string,
): DraftChangesCatalogueBlocker {
  return {
    code:
      source.kind === 'ambiguous' ? 'AMBIGUOUS_IDENTITY' : 'INVALID_SNAPSHOT',
    message: source.message,
    tableCreatedId,
  } as const;
}

function ambiguousViewsSource(
  tableId: string,
  detail: string,
): Extract<ValidatedViewsSourceResult, { status: 'blocked' }> {
  return {
    status: 'blocked',
    kind: 'ambiguous',
    message: `The stored views source for table '${tableId}' has ${detail}.`,
  };
}

function hasStoredViewsRow(
  state: DraftRevisionState,
  tableCreatedId: string,
): boolean {
  const owner = findTable(state, tableCreatedId);
  const viewsTable = state.tables.find(({ id }) => id === SystemTables.Views);
  return Boolean(viewsTable?.rows.some(({ id }) => id === owner?.id));
}
