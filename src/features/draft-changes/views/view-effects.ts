import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { JsonValue } from '@revisium/schema-toolkit/types';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { CandidateViewEffect } from 'src/features/draft-changes/queries/impl/resolve-candidate-views.query';
import { readViewsForTable } from 'src/features/draft-changes/views/view-state';
import type { TableViewsData, View } from 'src/features/views/types';

type RevisionRoles = Record<'head' | 'draft', DraftRevisionState>;

export function buildStateViewEffects(
  before: RevisionRoles,
  after: RevisionRoles,
): CandidateViewEffect[] {
  return (['head', 'draft'] as const).flatMap((role) =>
    effectsForRole(before, after, role),
  );
}

function effectsForRole(
  before: RevisionRoles,
  after: RevisionRoles,
  role: 'head' | 'draft',
): CandidateViewEffect[] {
  const tableCreatedIds = new Set([
    ...before[role].tables
      .filter(({ system }) => !system)
      .map(({ createdId }) => createdId),
    ...after[role].tables
      .filter(({ system }) => !system)
      .map(({ createdId }) => createdId),
  ]);
  const effects: CandidateViewEffect[] = [];
  for (const tableCreatedId of tableCreatedIds) {
    effects.push(
      ...effectsForTable(before[role], after[role], role, tableCreatedId),
    );
  }
  return effects;
}

function effectsForTable(
  before: DraftRevisionState,
  after: DraftRevisionState,
  role: 'head' | 'draft',
  tableCreatedId: string,
): CandidateViewEffect[] {
  const beforeTable = before.tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  const afterTable = after.tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  const tableId = afterTable?.id ?? beforeTable?.id;
  if (!tableId) {
    return [];
  }

  const beforeViews = storedViews(before, tableCreatedId);
  const afterViews = storedViews(after, tableCreatedId);
  return [
    ...viewEffectsForTable(
      role,
      tableCreatedId,
      tableId,
      beforeViews,
      afterViews,
    ),
    ...configurationEffects(
      role,
      tableCreatedId,
      tableId,
      beforeViews,
      afterViews,
    ),
  ];
}

function storedViews(
  state: DraftRevisionState,
  tableCreatedId: string,
): TableViewsData | undefined {
  const source = readViewsForTable(state, tableCreatedId);
  return source.status === 'present' && isViewsData(source.value)
    ? source.value
    : undefined;
}

function viewEffectsForTable(
  role: 'head' | 'draft',
  tableCreatedId: string,
  tableId: string,
  before: TableViewsData | undefined,
  after: TableViewsData | undefined,
): CandidateViewEffect[] {
  const beforeById = new Map(
    (before?.views ?? []).map((view) => [view.id, view]),
  );
  const afterById = new Map(
    (after?.views ?? []).map((view) => [view.id, view]),
  );
  const viewIds = new Set([...beforeById.keys(), ...afterById.keys()]);
  const effects: CandidateViewEffect[] = [];
  for (const viewId of viewIds) {
    const previous = beforeById.get(viewId);
    const next = afterById.get(viewId);
    if (!previous || !next) {
      effects.push(
        lifecycleEffect(role, tableCreatedId, tableId, viewId, previous, next),
      );
      continue;
    }
    effects.push(
      ...viewComponentEffects(
        role,
        tableCreatedId,
        tableId,
        viewId,
        previous,
        next,
      ),
    );
  }
  return effects;
}

function lifecycleEffect(
  role: 'head' | 'draft',
  tableCreatedId: string,
  tableId: string,
  viewId: string,
  before: View | undefined,
  after: View | undefined,
): CandidateViewEffect {
  return {
    role,
    target: {
      kind: 'view',
      tableCreatedId,
      tableId,
      viewId,
      component: 'lifecycle',
    },
    beforeExists: Boolean(before),
    afterExists: Boolean(after),
    ...(before
      ? { before: structuredClone(before) as unknown as JsonValue }
      : {}),
    ...(after ? { after: structuredClone(after) as unknown as JsonValue } : {}),
  };
}

function viewComponentEffects(
  role: 'head' | 'draft',
  tableCreatedId: string,
  tableId: string,
  viewId: string,
  before: View,
  after: View,
): CandidateViewEffect[] {
  return (
    ['name', 'description', 'search', 'columns', 'sorts', 'filters'] as const
  ).flatMap((component) => {
    const target = {
      kind: 'view' as const,
      tableCreatedId,
      tableId,
      viewId,
      component,
    };
    return effectIfChanged(
      role,
      target,
      optionalValue(before, component),
      optionalValue(after, component),
    );
  });
}

function configurationEffects(
  role: 'head' | 'draft',
  tableCreatedId: string,
  tableId: string,
  before: TableViewsData | undefined,
  after: TableViewsData | undefined,
): CandidateViewEffect[] {
  return (['version', 'defaultViewId', 'order'] as const).flatMap((component) =>
    effectIfChanged(
      role,
      { kind: 'viewConfiguration', tableCreatedId, tableId, component },
      configurationValue(before, component),
      configurationValue(after, component),
    ),
  );
}

function effectIfChanged(
  role: 'head' | 'draft',
  target: CandidateViewEffect['target'],
  before: ViewComponentValue,
  after: ViewComponentValue,
): CandidateViewEffect[] {
  if (equalComponent(before, after)) {
    return [];
  }
  return [
    {
      role,
      target,
      beforeExists: before.exists,
      afterExists: after.exists,
      ...(before.exists
        ? { before: structuredClone(before.value) as JsonValue }
        : {}),
      ...(after.exists
        ? { after: structuredClone(after.value) as JsonValue }
        : {}),
    },
  ];
}

interface ViewComponentValue {
  exists: boolean;
  value?: unknown;
}

function equalComponent(
  left: ViewComponentValue,
  right: ViewComponentValue,
): boolean {
  return left.exists === right.exists && deepEqual(left.value, right.value);
}

function optionalValue(view: View, component: keyof View): ViewComponentValue {
  const exists = Object.prototype.hasOwnProperty.call(view, component);
  const value = view[component];
  return exists ? { exists, value } : { exists: false };
}

function configurationValue(
  views: TableViewsData | undefined,
  component: 'version' | 'defaultViewId' | 'order',
): ViewComponentValue {
  if (!views) {
    return { exists: false };
  }
  if (component === 'order') {
    return { exists: true, value: views.views.map(({ id }) => id) };
  }
  const values = views as unknown as Record<string, unknown>;
  const exists = Object.prototype.hasOwnProperty.call(values, component);
  return exists ? { exists, value: values[component] } : { exists: false };
}

function isViewsData(value: unknown): value is TableViewsData {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'views' in value &&
    Array.isArray(value.views)
  );
}
