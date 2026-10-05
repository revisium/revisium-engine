import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { JsonValue } from '@revisium/schema-toolkit/types';
import type {
  DraftChangesCatalogueEntry,
  DraftChangesCatalogueTarget,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { TablePair } from 'src/features/draft-changes/catalogue/snapshot-pairs';
import type { StoredViewsSource } from 'src/features/draft-changes/schema/schema-view-baselines';
import type { TableViewsData, View } from 'src/features/views/types';

type ViewComponent = Extract<
  DraftChangesCatalogueTarget,
  { kind: 'view' }
>['component'];
type ConfigurationComponent = Extract<
  DraftChangesCatalogueTarget,
  { kind: 'viewConfiguration' }
>['component'];

interface ComponentValue {
  exists: boolean;
  value?: JsonValue;
}

export function buildViewChangeEntries(
  pair: TablePair,
  sourceHeadViews: StoredViewsSource,
  sourceDraftViews: StoredViewsSource,
  migratedHeadViews?: StoredViewsSource,
): DraftChangesCatalogueEntry[] {
  const tableId = pair.draft?.id ?? pair.head?.id;
  if (!tableId) {
    return [];
  }

  const before = migratedHeadViews ?? sourceHeadViews;
  const after = sourceDraftViews;
  const beforeViews = before.present ? before.value : undefined;
  const afterViews = after.present ? after.value : undefined;
  if (!beforeViews && !afterViews) {
    return [];
  }

  const entries = buildViewEntries(
    pair.createdId,
    tableId,
    beforeViews,
    afterViews,
  );
  entries.push(
    ...buildConfigurationEntries(
      pair.createdId,
      tableId,
      beforeViews,
      afterViews,
    ),
  );
  return entries;
}

function buildViewEntries(
  tableCreatedId: string,
  tableId: string,
  before: TableViewsData | undefined,
  after: TableViewsData | undefined,
): DraftChangesCatalogueEntry[] {
  const beforeById = new Map(
    (before?.views ?? []).map((view) => [view.id, view]),
  );
  const afterById = new Map(
    (after?.views ?? []).map((view) => [view.id, view]),
  );
  const viewIds = [
    ...new Set([...beforeById.keys(), ...afterById.keys()]),
  ].sort(compareStrings);
  const entries: DraftChangesCatalogueEntry[] = [];
  for (const viewId of viewIds) {
    const original = beforeById.get(viewId);
    const current = afterById.get(viewId);
    if (!original || !current) {
      entries.push(
        createEntry(
          {
            kind: 'view',
            tableCreatedId,
            tableId,
            viewId,
            component: 'lifecycle',
          },
          {
            exists: Boolean(original),
            value: original as JsonValue | undefined,
          },
          { exists: Boolean(current), value: current as JsonValue | undefined },
        ),
      );
      continue;
    }

    entries.push(
      ...buildViewComponentEntries(
        tableCreatedId,
        tableId,
        viewId,
        original,
        current,
      ),
    );
  }
  return entries;
}

function buildViewComponentEntries(
  tableCreatedId: string,
  tableId: string,
  viewId: string,
  before: View,
  after: View,
): DraftChangesCatalogueEntry[] {
  const components: ViewComponent[] = [
    'name',
    'description',
    'search',
    'columns',
    'sorts',
    'filters',
  ];
  return components.flatMap((component) => {
    const beforeValue = propertyValue(before, component);
    const afterValue = propertyValue(after, component);
    return valuesEqual(beforeValue, afterValue)
      ? []
      : [
          createEntry(
            { kind: 'view', tableCreatedId, tableId, viewId, component },
            beforeValue,
            afterValue,
          ),
        ];
  });
}

function buildConfigurationEntries(
  tableCreatedId: string,
  tableId: string,
  before: TableViewsData | undefined,
  after: TableViewsData | undefined,
): DraftChangesCatalogueEntry[] {
  const components: ConfigurationComponent[] = [
    'version',
    'defaultViewId',
    'order',
  ];
  return components.flatMap((component) => {
    const beforeValue = configurationValue(before, component);
    const afterValue = configurationValue(after, component);
    return valuesEqual(beforeValue, afterValue)
      ? []
      : [
          createEntry(
            { kind: 'viewConfiguration', tableCreatedId, tableId, component },
            beforeValue,
            afterValue,
          ),
        ];
  });
}

function propertyValue(view: View, component: ViewComponent): ComponentValue {
  if (component === 'lifecycle') {
    return { exists: true, value: view as unknown as JsonValue };
  }
  const exists = Object.prototype.hasOwnProperty.call(view, component);
  const value = view[component];
  return exists ? { exists, value: value as JsonValue } : { exists };
}

function configurationValue(
  views: TableViewsData | undefined,
  component: ConfigurationComponent,
): ComponentValue {
  if (!views) {
    return { exists: false };
  }
  if (component === 'order') {
    return { exists: true, value: views.views.map(({ id }) => id) };
  }
  const source = views as unknown as Record<string, unknown>;
  const exists = Object.prototype.hasOwnProperty.call(source, component);
  return exists
    ? { exists, value: source[component] as JsonValue }
    : { exists };
}

function createEntry(
  target: DraftChangesCatalogueTarget,
  before: ComponentValue,
  after: ComponentValue,
): DraftChangesCatalogueEntry {
  let classification: DraftChangesCatalogueEntry['classification'];
  if (!before.exists) {
    classification = 'created';
  } else if (!after.exists) {
    classification = 'deleted';
  } else {
    classification = 'updated';
  }
  return {
    ref: { value: '' },
    kind: target.kind,
    target,
    classification,
    beforeExists: before.exists,
    afterExists: after.exists,
    selectable: true,
    ...(before.exists ? { before: structuredClone(before.value) } : {}),
    ...(after.exists ? { after: structuredClone(after.value) } : {}),
  };
}

function valuesEqual(left: ComponentValue, right: ComponentValue): boolean {
  return left.exists === right.exists && deepEqual(left.value, right.value);
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
