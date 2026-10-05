import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { TableViewsData, View } from 'src/features/views/types';

type ConfigurationComponent = Extract<
  DraftChangesCatalogueEntry['target'],
  { kind: 'viewConfiguration' }
>['component'];

export function projectViewConfiguration(
  baseline: TableViewsData,
  draft: TableViewsData,
  entries: DraftChangesCatalogueEntry[],
): TableViewsData {
  const output = structuredClone(baseline);
  const components: ConfigurationComponent[] = [
    'version',
    'defaultViewId',
    'order',
  ];
  for (const component of components) {
    const applicable = entries.some(
      (entry) =>
        entry.target.kind === 'viewConfiguration' &&
        entry.target.component === component,
    );
    if (!applicable) {
      continue;
    }
    if (component === 'order') {
      output.views = applyViewOrder(output.views, draft.views);
      continue;
    }
    copyOptionalProperty(output, draft, component);
  }
  return output;
}

function applyViewOrder(current: View[], requested: View[]): View[] {
  const byId = new Map(current.map((view) => [view.id, view]));
  const ordered = requested
    .map(({ id }) => byId.get(id))
    .filter((view): view is View => view !== undefined);
  const included = new Set(ordered.map(({ id }) => id));
  return [...ordered, ...current.filter(({ id }) => !included.has(id))];
}

function copyOptionalProperty(
  target: object,
  source: object,
  key: 'version' | 'defaultViewId',
) {
  const destination = target as Record<string, unknown>;
  const values = source as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(values, key)) {
    delete destination[key];
  } else {
    destination[key] = structuredClone(values[key]);
  }
}
