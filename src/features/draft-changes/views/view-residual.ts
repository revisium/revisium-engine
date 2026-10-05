import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { CandidateViewBlocker } from 'src/features/draft-changes/queries/impl/resolve-candidate-views.query';
import type { CandidateSchemaProjectionBinding } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import { mapViewFields } from 'src/features/draft-changes/views/view-field-values';
import { projectViewConfiguration } from 'src/features/draft-changes/views/view-configuration';
import {
  mergeViewFieldArray,
  mergeViewFilter,
} from 'src/features/draft-changes/views/view-residual-values';
import type { TableViewsData, View } from 'src/features/views/types';

interface ProjectViewResidualInput {
  baseline: TableViewsData;
  migrated: TableViewsData;
  draft: TableViewsData;
  entries: DraftChangesCatalogueEntry[];
  binding?: CandidateSchemaProjectionBinding;
  tableCreatedId: string;
}

export type ViewResidualResult =
  | { status: 'projected'; value: TableViewsData }
  | { status: 'blocked'; blocker: CandidateViewBlocker };

type ViewComponent = Extract<
  DraftChangesCatalogueEntry['target'],
  { kind: 'view' }
>['component'];

export function projectViewResidual(
  input: ProjectViewResidualInput,
): ViewResidualResult {
  const output = structuredClone(input.baseline);
  const originalById = new Map(
    input.migrated.views.map((view) => [view.id, view]),
  );
  const draftById = new Map(input.draft.views.map((view) => [view.id, view]));
  const viewIds = new Set([...originalById.keys(), ...draftById.keys()]);

  for (const viewId of viewIds) {
    const projected = projectOneView(
      input,
      viewId,
      output,
      originalById.get(viewId),
      draftById.get(viewId),
    );
    if (projected.status === 'blocked') {
      return projected;
    }
  }

  const configurationEntries = input.entries.filter(
    (entry) =>
      entry.target.kind === 'viewConfiguration' &&
      entry.target.tableCreatedId === input.tableCreatedId,
  );
  return {
    status: 'projected',
    value: projectViewConfiguration(output, input.draft, configurationEntries),
  };
}

function projectOneView(
  input: ProjectViewResidualInput,
  viewId: string,
  output: TableViewsData,
  migrated: View | undefined,
  draft: View | undefined,
): ViewResidualResult {
  const index = output.views.findIndex((view) => view.id === viewId);
  if (
    (!migrated || !draft) &&
    hasViewEntry(input.entries, viewId, 'lifecycle')
  ) {
    if (draft) {
      const mapped = mapViewFields(draft, input.binding);
      if (index < 0) {
        output.views.push(mapped);
      } else {
        output.views[index] = mapped;
      }
    } else if (index >= 0) {
      output.views.splice(index, 1);
    }
    return { status: 'projected', value: output };
  }
  if (!migrated || !draft || index < 0) {
    return { status: 'projected', value: output };
  }
  const target = output.views[index];
  if (!target) {
    return { status: 'projected', value: output };
  }
  const projected = projectViewComponents(
    input,
    viewId,
    target,
    migrated,
    draft,
  );
  if (projected.status === 'blocked') {
    return projected;
  }
  output.views[index] = projected.value;
  return { status: 'projected', value: output };
}

function projectViewComponents(
  input: ProjectViewResidualInput,
  viewId: string,
  target: View,
  migrated: View,
  draft: View,
):
  | { status: 'projected'; value: View }
  | { status: 'blocked'; blocker: CandidateViewBlocker } {
  const output = structuredClone(target);
  const components: ViewComponent[] = [
    'name',
    'description',
    'search',
    'columns',
    'sorts',
    'filters',
  ];
  for (const component of components) {
    if (!hasViewEntry(input.entries, viewId, component)) {
      continue;
    }
    const value = projectComponentValue(
      component,
      migrated,
      draft,
      output,
      input.binding,
    );
    if (value.ambiguous) {
      return {
        status: 'blocked',
        blocker: {
          code: 'AMBIGUOUS_VIEW_RESIDUAL',
          message: `The '${component}' residual for view '${viewId}' cannot be mapped to a unique occurrence.`,
          tableCreatedId: input.tableCreatedId,
          viewId,
          component,
        },
      };
    }
    setOptionalProperty(output, component, value.value);
  }
  return { status: 'projected', value: output };
}

function projectComponentValue(
  component: ViewComponent,
  migrated: View,
  draft: View,
  target: View,
  binding: CandidateSchemaProjectionBinding | undefined,
) {
  const currentValue = optionalProperty(draft, component);
  if (component === 'columns' || component === 'sorts') {
    return mergeViewFieldArray(
      optionalProperty(migrated, component),
      currentValue,
      optionalProperty(target, component),
      binding,
    );
  }
  if (component === 'filters') {
    return mergeViewFilter(
      optionalProperty(migrated, component),
      currentValue,
      optionalProperty(target, component),
      binding,
    );
  }
  return { value: currentValue, ambiguous: false };
}

function hasViewEntry(
  entries: DraftChangesCatalogueEntry[],
  viewId: string,
  component: ViewComponent,
): boolean {
  return entries.some(
    (entry) =>
      entry.target.kind === 'view' &&
      entry.target.viewId === viewId &&
      entry.target.component === component,
  );
}

function setOptionalProperty(target: object, key: string, value: unknown) {
  const destination = target as Record<string, unknown>;
  if (value === undefined) {
    delete destination[key];
  } else {
    destination[key] = structuredClone(value);
  }
}

function optionalProperty(value: object, key: string): unknown {
  const record = value as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}
