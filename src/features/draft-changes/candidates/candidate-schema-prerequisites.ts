import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type {
  CalculateDataCandidatesQueryData,
  CalculateDataCandidatesResult,
  ResolvedDraftChangesSelection,
} from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type {
  DraftChangesCatalogueEntry,
  DraftChangesCatalogueTarget,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { ProjectDraftChangesSchemaResult } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import {
  missingValue,
  readJsonPath,
  unescapePointer,
  escapePointer,
} from 'src/features/draft-changes/schema/json-value-path';

type ProjectedSchemas = Map<
  string,
  Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
>;
type RowFieldEntry = Omit<DraftChangesCatalogueEntry, 'kind' | 'target'> & {
  kind: 'rowField';
  target: Extract<DraftChangesCatalogueTarget, { kind: 'rowField' }>;
};
type RowEntry = Omit<DraftChangesCatalogueEntry, 'kind' | 'target'> & {
  kind: 'row';
  target: Extract<DraftChangesCatalogueTarget, { kind: 'row' }>;
};
type SchemaFieldEntry = Omit<DraftChangesCatalogueEntry, 'kind' | 'target'> & {
  kind: 'schemaField';
  target: Extract<DraftChangesCatalogueTarget, { kind: 'schemaField' }>;
};

export function schemaPrerequisite(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  projections: ProjectedSchemas,
):
  | Extract<
      CalculateDataCandidatesResult,
      { status: 'needsEffects' | 'blocked' }
    >
  | undefined {
  for (const entry of data.selection.selected) {
    const result = schemaRequirementForEntry(data, projections, entry);
    if (result) {
      return result;
    }
  }
  return undefined;
}

function schemaRequirementForEntry(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  projections: ProjectedSchemas,
  entry: DraftChangesCatalogueEntry,
):
  | Extract<
      CalculateDataCandidatesResult,
      { status: 'needsEffects' | 'blocked' }
    >
  | undefined {
  if (
    isRowEntry(entry) &&
    entry.classification === 'created' &&
    data.operation === 'commit'
  ) {
    return createdRowSchemaRequirement(data, projections, entry);
  }
  if (!isRowFieldEntry(entry)) {
    return undefined;
  }
  const projection = projections.get(entry.target.tableCreatedId);
  if (!projection) {
    return undefined;
  }
  const targetSchema =
    data.operation === 'commit'
      ? projection.head.schema
      : projection.draft.schema;
  const required = data.catalogue.entries.find((candidate) =>
    isMissingRequiredSchemaEffect(candidate, entry, targetSchema),
  );
  if (!required?.effectRefs?.length || isSelected(data.selection, required)) {
    return undefined;
  }
  if (isSchemaDenied(data.selection, required)) {
    return excludedSchemaPrerequisite(data.operation, {
      tableCreatedId: entry.target.tableCreatedId,
      path: entry.path,
    });
  }
  const effect = required.effectRefs[0];
  if (!effect) {
    return undefined;
  }
  return {
    status: 'needsEffects',
    requirements: [
      {
        role: data.operation === 'commit' ? 'head' : 'draft',
        causeRef: entry.ref,
        kind: 'schemaEffects',
        tableCreatedId: entry.target.tableCreatedId,
        effects: [effect],
      },
    ],
  };
}

function isMissingRequiredSchemaEffect(
  candidate: DraftChangesCatalogueEntry,
  entry: RowFieldEntry,
  targetSchema: JsonSchema,
): boolean {
  if (
    !isSchemaFieldEntry(candidate) ||
    candidate.target.tableCreatedId !== entry.target.tableCreatedId ||
    candidate.classification !== 'created' ||
    !schemaPathAffectsDataPath(candidate.path ?? '', entry.path ?? '')
  ) {
    return false;
  }
  return !schemaContainsDataPath(
    targetSchema,
    schemaPointerToDataPath(candidate.path ?? ''),
  );
}

function excludedSchemaPrerequisite(
  operation: 'commit' | 'discard',
  target: { tableCreatedId: string; path: string | undefined },
): Extract<CalculateDataCandidatesResult, { status: 'blocked' }> {
  return {
    status: 'blocked',
    blockers: [
      {
        code: 'EXCLUDED_PREREQUISITE',
        role: operation === 'commit' ? 'head' : 'draft',
        tableCreatedId: target.tableCreatedId,
        path: target.path,
        message: 'A required schema effect is excluded.',
      },
    ],
  };
}

function createdRowSchemaRequirement(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  projections: ProjectedSchemas,
  entry: DraftChangesCatalogueEntry,
):
  | Extract<
      CalculateDataCandidatesResult,
      { status: 'needsEffects' | 'blocked' }
    >
  | undefined {
  if (!isRowEntry(entry)) {
    return undefined;
  }
  const projection = projections.get(entry.target.tableCreatedId);
  const row = projection?.draft.rows.find(
    ({ createdId }) => createdId === entry.target.rowCreatedId,
  );
  if (!projection || !row) {
    return undefined;
  }
  for (const schemaEntry of data.catalogue.entries) {
    if (!isCreatedSchemaField(schemaEntry, entry.target.tableCreatedId)) {
      continue;
    }
    const dataPath = schemaPointerToDataPath(schemaEntry.path ?? '');
    if (
      readJsonPath(row.data, dataPath) === missingValue ||
      schemaContainsDataPath(projection.head.schema, dataPath) ||
      isSelected(data.selection, schemaEntry)
    ) {
      continue;
    }
    if (isSchemaDenied(data.selection, schemaEntry)) {
      return excludedSchemaPrerequisite('commit', {
        tableCreatedId: entry.target.tableCreatedId,
        path: dataPath,
      });
    }
    const effect = schemaEntry.effectRefs?.[0];
    if (effect) {
      return {
        status: 'needsEffects',
        requirements: [
          {
            role: 'head',
            causeRef: entry.ref,
            kind: 'schemaEffects',
            tableCreatedId: entry.target.tableCreatedId,
            effects: [effect],
          },
        ],
      };
    }
  }
  return undefined;
}

function isCreatedSchemaField(
  entry: DraftChangesCatalogueEntry,
  tableCreatedId: string,
): entry is SchemaFieldEntry {
  return (
    entry.kind === 'schemaField' &&
    entry.target.kind === 'schemaField' &&
    entry.target.tableCreatedId === tableCreatedId &&
    entry.classification === 'created' &&
    Boolean(entry.effectRefs?.length)
  );
}

function isRowFieldEntry(
  entry: DraftChangesCatalogueEntry,
): entry is RowFieldEntry {
  return entry.kind === 'rowField' && entry.target.kind === 'rowField';
}

function isRowEntry(entry: DraftChangesCatalogueEntry): entry is RowEntry {
  return entry.kind === 'row' && entry.target.kind === 'row';
}

function isSchemaFieldEntry(
  entry: DraftChangesCatalogueEntry,
): entry is SchemaFieldEntry {
  return entry.kind === 'schemaField' && entry.target.kind === 'schemaField';
}

function isSchemaDenied(
  selection: ResolvedDraftChangesSelection,
  entry: DraftChangesCatalogueEntry,
): boolean {
  return selection.deniedTargets.some((target) => {
    if (target.kind === 'change') {
      return target.ref.value === entry.ref.value;
    }
    if (entry.target.kind !== 'schemaField') {
      return false;
    }
    if (target.kind === 'schemaField') {
      return (
        target.tableCreatedId === entry.target.tableCreatedId &&
        isPathAtOrBelow(entry.path ?? '', target.path)
      );
    }
    if (target.kind === 'schemaFields') {
      return (
        target.tableCreatedId === entry.target.tableCreatedId &&
        (target.paths === 'all' ||
          target.paths.some((path) => isPathAtOrBelow(entry.path ?? '', path)))
      );
    }
    return (
      target.kind === 'table' &&
      target.tableCreatedId === entry.target.tableCreatedId &&
      target.facets.includes('schemaFields')
    );
  });
}

function schemaPathAffectsDataPath(
  schemaPath: string,
  dataPath: string,
): boolean {
  const projected = schemaPointerToDataPath(schemaPath);
  return (
    isPathAtOrBelow(dataPath, projected) || isPathAtOrBelow(projected, dataPath)
  );
}

function schemaPointerToDataPath(schemaPath: string): string {
  const segments =
    schemaPath === ''
      ? []
      : schemaPath.split('/').slice(1).map(unescapePointer);
  const dataSegments: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === 'properties') {
      const property = segments[index + 1];
      if (property !== undefined) {
        dataSegments.push(property);
        index += 1;
      }
    } else if (segment === 'items') {
      dataSegments.push('0');
    }
  }
  return dataSegments.length === 0
    ? ''
    : `/${dataSegments.map(escapePointer).join('/')}`;
}

function schemaContainsDataPath(schema: JsonSchema, path: string): boolean {
  if (path === '') {
    return true;
  }
  let current: JsonSchema | undefined = schema;
  for (const segment of path.split('/').slice(1).map(unescapePointer)) {
    const shape = current as unknown as
      | {
          type?: string;
          items?: JsonSchema;
          properties?: Record<string, JsonSchema>;
        }
      | undefined;
    current =
      shape?.type === 'array' && /^\d+$/.test(segment)
        ? shape.items
        : shape?.properties?.[segment];
    if (!current) {
      return false;
    }
  }
  return true;
}

export function isPathAtOrBelow(path: string, parent: string): boolean {
  const left = path.split('/');
  const right = parent.split('/');
  return (
    parent === '' ||
    (left.length >= right.length &&
      right.every(
        (part, index) =>
          part === left[index] ||
          (part === '0' && /^\d+$/.test(left[index] ?? '')),
      ))
  );
}

function isSelected(
  selection: ResolvedDraftChangesSelection,
  entry: DraftChangesCatalogueEntry,
): boolean {
  return selection.selected.some(({ ref }) => ref.value === entry.ref.value);
}
