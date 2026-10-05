import type { JsonValue } from '@revisium/schema-toolkit/types';
import type { FieldChange } from 'src/features/revision-changes/types';
import type { CompareSuppliedRowsQueryResult } from 'src/features/revision-changes/queries/impl/compare-supplied-rows.query';
import type {
  DraftChangesCatalogueEntry,
  DraftChangesFieldBoundary,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import {
  escapePointer,
  missingValue,
  readJsonPath,
} from 'src/features/draft-changes/schema/json-value-path';
import type { ProjectDraftChangesSchemaResult } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type { SnapshotRow } from 'src/features/draft-changes/catalogue/snapshot-pairs';

export interface RowFieldIdentity {
  tableCreatedId: string;
  rowCreatedId: string;
  tableId: string;
  rowId: string;
}

export interface RowFieldInput {
  identity: RowFieldIdentity;
  beforeData: JsonValue;
  afterData: JsonValue;
  changes: FieldChange[];
  boundaries: DraftChangesFieldBoundary[];
}

export interface ProjectedRowFieldInput {
  tableCreatedId: string;
  tableId: string;
  pairs: Array<{ createdId: string; head?: SnapshotRow; draft?: SnapshotRow }>;
  projection: Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>;
  boundaries: DraftChangesFieldBoundary[];
  compare: (
    pairs: Array<{ key: string; fromData: JsonValue; toData: JsonValue }>,
  ) => Promise<CompareSuppliedRowsQueryResult>;
}

export async function buildProjectedRowFieldEntries(
  input: ProjectedRowFieldInput,
): Promise<
  | DraftChangesCatalogueEntry[]
  | { ambiguousPath: string }
  | { projectionMismatch: true }
> {
  const commonRows = input.pairs.filter(({ head, draft }) => head && draft);
  const baselines = uniqueProjectedRows(input.projection.migratedHead.rows);
  if (!baselines) {
    return { projectionMismatch: true };
  }
  const comparisons = [];
  for (const { createdId, draft } of commonRows) {
    if (!draft) {
      continue;
    }
    if (!baselines.has(createdId)) {
      return { projectionMismatch: true };
    }
    const baseline = baselines.get(createdId) as JsonValue;
    comparisons.push({
      key: createdId,
      fromData: baseline,
      toData: draft.data as unknown as JsonValue,
    });
  }
  const compared = await input.compare(comparisons);
  const changes = new Map(
    compared.pairs.map(({ key, fieldChanges }) => [key, fieldChanges]),
  );
  const entries: DraftChangesCatalogueEntry[] = [];
  for (const { createdId, draft } of commonRows) {
    if (!draft) {
      continue;
    }
    if (!baselines.has(createdId)) {
      return { projectionMismatch: true };
    }
    const baseline = baselines.get(createdId) as JsonValue;
    const result = buildRowFieldEntries({
      identity: {
        tableCreatedId: input.tableCreatedId,
        rowCreatedId: createdId,
        tableId: input.tableId,
        rowId: draft.id,
      },
      beforeData: baseline,
      afterData: draft.data as unknown as JsonValue,
      changes: changes.get(createdId) ?? [],
      boundaries: input.boundaries,
    });
    if ('ambiguousPath' in result) {
      return result;
    }
    entries.push(...result);
  }
  return entries;
}

function uniqueProjectedRows(
  rows: Array<{ createdId: string; data: JsonValue }>,
): Map<string, JsonValue> | undefined {
  const result = new Map<string, JsonValue>();
  for (const row of rows) {
    if (result.has(row.createdId)) {
      return undefined;
    }
    result.set(row.createdId, row.data);
  }
  return result;
}

export function buildRowFieldEntries(
  input: RowFieldInput,
): DraftChangesCatalogueEntry[] | { ambiguousPath: string } {
  const boundaries = [
    ...input.boundaries,
    ...arrayBoundaries(input.beforeData),
    ...arrayBoundaries(input.afterData),
  ];
  const collapsed = new Map<string, { editable: boolean; computed: boolean }>();
  const ordinary: Array<{
    path: string;
    computedPath?: string;
  }> = [];
  for (const change of input.changes) {
    const resolved = resolvePointer(
      change.fieldPath,
      input.beforeData,
      input.afterData,
    );
    if (resolved === 'ambiguous') {
      return { ambiguousPath: change.fieldPath };
    }
    const computed = boundaries.find(
      ({ kind, path }) =>
        kind === 'computed' && matchesBoundary(resolved, path),
    );
    const atomic = boundaries
      .filter(({ kind }) => kind === 'array' || kind === 'file')
      .filter(({ path }) => matchesBoundary(resolved, path))
      .sort((left, right) => left.path.length - right.path.length)[0];
    if (atomic) {
      const prior = collapsed.get(atomic.path) ?? {
        editable: false,
        computed: false,
      };
      if (computed) {
        prior.computed = true;
      } else {
        prior.editable = true;
      }
      collapsed.set(atomic.path, prior);
      continue;
    }
    ordinary.push({
      path: resolved,
      ...(computed ? { computedPath: computed.path } : {}),
    });
  }
  const entries: DraftChangesCatalogueEntry[] = ordinary.map(
    ({ path, computedPath }) => {
      const before = valueAtPointer(input.beforeData, path);
      const after = valueAtPointer(input.afterData, path);
      const classification = classifyFieldChange(
        before.exists,
        after.exists,
        computedPath,
      );
      return {
        ref: { value: '' },
        kind: 'rowField' as const,
        target: { kind: 'rowField' as const, ...input.identity, path },
        classification,
        path,
        before: before.value,
        after: after.value,
        beforeExists: before.exists,
        afterExists: after.exists,
        selectable: computedPath === undefined,
      };
    },
  );
  for (const [path, changeKinds] of collapsed) {
    if (changeKinds.computed && !changeKinds.editable) {
      const before = valueAtPointer(input.beforeData, path);
      const after = valueAtPointer(input.afterData, path);
      entries.push({
        ref: { value: '' },
        kind: 'rowField',
        target: { kind: 'rowField', ...input.identity, path },
        classification: 'computed',
        path,
        before: before.value,
        after: after.value,
        beforeExists: before.exists,
        afterExists: after.exists,
        selectable: false,
      });
      continue;
    }
    const before = valueAtPointer(input.beforeData, path);
    const after = valueAtPointer(input.afterData, path);
    entries.push({
      ref: { value: '' },
      kind: 'rowField',
      target: { kind: 'rowField', ...input.identity, path },
      classification: 'atomic',
      path,
      before: before.value,
      after: after.value,
      beforeExists: before.exists,
      afterExists: after.exists,
      selectable: true,
    });
  }
  return entries;
}

function classifyFieldChange(
  beforeExists: boolean,
  afterExists: boolean,
  computedPath: string | undefined,
): DraftChangesCatalogueEntry['classification'] {
  if (computedPath !== undefined) {
    return 'computed';
  }
  if (!beforeExists) {
    return 'created';
  }
  if (!afterExists) {
    return 'deleted';
  }
  return 'updated';
}

function arrayBoundaries(value: JsonValue): DraftChangesFieldBoundary[] {
  const result: DraftChangesFieldBoundary[] = [];
  const visit = (current: JsonValue, path: string): void => {
    if (Array.isArray(current)) {
      result.push({ tableCreatedId: '', kind: 'array', path });
      return;
    }
    if (!current || typeof current !== 'object') {
      return;
    }
    for (const [key, child] of Object.entries(current)) {
      visit(child, `${path}/${escapePointer(key)}`);
    }
  };
  visit(value, '');
  return result;
}

function resolvePointer(
  dottedPath: string,
  before: JsonValue,
  after: JsonValue,
): string | 'ambiguous' {
  if (dottedPath === '') {
    return '';
  }
  const candidates = new Set([
    ...possiblePointers(before, dottedPath),
    ...possiblePointers(after, dottedPath),
  ]);
  if (candidates.size > 1) {
    return 'ambiguous';
  }
  const [candidate] = candidates;
  if (candidate !== undefined) {
    return candidate;
  }
  return `/${dottedPath.split('.').map(escapePointer).join('/')}`;
}

function possiblePointers(root: JsonValue, dottedPath: string): string[] {
  const result = new Set<string>();
  const segments = dottedPath.split('.');
  const visit = (value: JsonValue, path: string, remaining: string[]): void => {
    if (remaining.length === 0) {
      result.add(path);
      return;
    }
    if (Array.isArray(value)) {
      const index = remaining[0];
      if (index !== undefined && /^\d+$/.test(index)) {
        const child = value[Number(index)];
        if (child !== undefined) {
          visit(child, `${path}/${index}`, remaining.slice(1));
        }
      }
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const object = value as Record<string, JsonValue>;
    for (let count = 1; count <= remaining.length; count += 1) {
      const key = remaining.slice(0, count).join('.');
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        visit(
          object[key] as JsonValue,
          `${path}/${escapePointer(key)}`,
          remaining.slice(count),
        );
      }
    }
  };
  visit(root, '', segments);
  return [...result];
}

function valueAtPointer(
  root: JsonValue,
  path: string,
): { exists: boolean; value?: JsonValue } {
  const value = readJsonPath(root, path);
  return value === missingValue ? { exists: false } : { exists: true, value };
}

function matchesBoundary(path: string, pattern: string): boolean {
  const pathSegments = path.split('/').slice(1);
  const patternSegments = pattern.split('/').slice(1);
  if (patternSegments.length > pathSegments.length) {
    return false;
  }
  return patternSegments.every((segment, index) => {
    const candidate = pathSegments[index];
    return segment === '*' || segment === candidate;
  });
}
