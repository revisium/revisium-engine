import { deepEqual } from '@revisium/schema-toolkit/lib';
import type {
  CandidateBlocker,
  CandidateRequirement,
  ResolvedDraftChangesSelection,
} from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { ProjectDraftChangesSchemaResult } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { findRow, findTable } from './candidate-state';
import {
  missingValue,
  readJsonPath,
} from 'src/features/draft-changes/schema/json-value-path';

export function deniedDiscardDataRequirements(
  requirements: CandidateRequirement[],
  selection: ResolvedDraftChangesSelection,
): CandidateBlocker[] {
  return requirements.flatMap((requirement) => {
    if (requirement.kind !== 'discardDataFields') {
      return [];
    }
    return requirement.fields.flatMap((field) => {
      if (!isDiscardedFieldDenied(requirement, field, selection)) {
        return [];
      }
      return [
        {
          code: 'EXCLUDED_PREREQUISITE',
          role: requirement.role,
          tableCreatedId: requirement.tableCreatedId,
          rowCreatedId: field.rowCreatedId,
          path: field.path,
          message: 'Required discarded row data is excluded.',
        },
      ];
    });
  });
}

function isDiscardedFieldDenied(
  requirement: Extract<CandidateRequirement, { kind: 'discardDataFields' }>,
  field: Extract<
    CandidateRequirement,
    { kind: 'discardDataFields' }
  >['fields'][number],
  selection: ResolvedDraftChangesSelection,
): boolean {
  return selection.deniedTargets.some((target) => {
    if (
      'tableCreatedId' in target &&
      target.tableCreatedId !== requirement.tableCreatedId
    ) {
      return false;
    }
    if (target.kind === 'table') {
      return target.facets.includes('rows');
    }
    if (target.kind === 'row' && target.rowCreatedId === field.rowCreatedId) {
      return target.facets.includes('rowFields');
    }
    if (
      target.kind === 'rowField' &&
      target.rowCreatedId === field.rowCreatedId
    ) {
      return pathsOverlap(target.path, field.path);
    }
    if (
      target.kind === 'rowFields' &&
      target.rowCreatedId === field.rowCreatedId
    ) {
      return (
        target.paths === 'all' ||
        target.paths.some((path) => pathsOverlap(path, field.path))
      );
    }
    return (
      target.kind === 'change' &&
      selection.excluded.some(
        (entry) =>
          entry.ref.value === target.ref.value &&
          entry.kind === 'rowField' &&
          entry.target.kind === 'rowField' &&
          entry.target.rowCreatedId === field.rowCreatedId &&
          pathsOverlap(entry.path ?? '', field.path),
      )
    );
  });
}

function pathsOverlap(left: string, right: string): boolean {
  return (
    left === '' ||
    right === '' ||
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

export function deniedValueChanges(
  operation: 'commit' | 'discard',
  source: DraftRevisionState,
  candidate: DraftRevisionState,
  selection: ResolvedDraftChangesSelection,
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
): CandidateBlocker[] {
  const role = operation === 'commit' ? 'head' : 'draft';
  const blockers: CandidateBlocker[] = [];
  for (const target of selection.deniedTargets) {
    blockers.push(
      ...deniedTargetChanges(
        role,
        source,
        candidate,
        selection,
        target,
        projections,
      ),
    );
  }
  return blockers;
}

function deniedTargetChanges(
  role: 'head' | 'draft',
  source: DraftRevisionState,
  candidate: DraftRevisionState,
  selection: ResolvedDraftChangesSelection,
  target: ResolvedDraftChangesSelection['deniedTargets'][number],
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
): CandidateBlocker[] {
  const tableCreatedId =
    target.kind === 'change'
      ? tableCreatedIdForTarget(target.target)
      : target.tableCreatedId;
  if (!tableCreatedId) {
    return [];
  }
  const beforeTable = findTable(source, tableCreatedId);
  const afterTable = findTable(candidate, tableCreatedId);
  if (target.kind === 'table') {
    return deniedTableTargetChanges(
      role,
      source,
      candidate,
      tableCreatedId,
      beforeTable,
      afterTable,
      target.facets,
    );
  }
  if (target.kind === 'change') {
    return deniedChangeTargetChanges(
      role,
      source,
      candidate,
      selection,
      target.ref.value,
      tableCreatedId,
      projections,
    );
  }
  if (target.kind === 'schemaField' || target.kind === 'schemaFields') {
    return deniedSchemaTargetChanges(
      role,
      source,
      candidate,
      tableCreatedId,
      beforeTable,
      afterTable,
      target,
    );
  }
  return deniedRowTargetChanges(
    role,
    tableCreatedId,
    beforeTable,
    afterTable,
    target,
    projections,
  );
}

function deniedTableTargetChanges(
  role: 'head' | 'draft',
  source: DraftRevisionState,
  candidate: DraftRevisionState,
  tableCreatedId: string,
  beforeTable: ReturnType<typeof findTable>,
  afterTable: ReturnType<typeof findTable>,
  facets: string[],
): CandidateBlocker[] {
  if (
    facets.includes('lifecycle') &&
    Boolean(beforeTable) !== Boolean(afterTable)
  ) {
    return [
      deniedBlocker(
        role,
        tableCreatedId,
        undefined,
        undefined,
        'A denied table lifecycle would change.',
      ),
    ];
  }
  if (facets.includes('rows') && !sameRowMembership(beforeTable, afterTable)) {
    return [
      deniedBlocker(
        role,
        tableCreatedId,
        undefined,
        undefined,
        'Denied table rows would change.',
      ),
    ];
  }
  if (
    facets.includes('schemaFields') &&
    !sameSchemaRow(source, candidate, beforeTable?.id, afterTable?.id)
  ) {
    return [
      deniedBlocker(
        role,
        tableCreatedId,
        undefined,
        undefined,
        'A denied table schema would change.',
      ),
    ];
  }
  return [];
}

function deniedChangeTargetChanges(
  role: 'head' | 'draft',
  source: DraftRevisionState,
  candidate: DraftRevisionState,
  selection: ResolvedDraftChangesSelection,
  ref: string,
  tableCreatedId: string,
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
): CandidateBlocker[] {
  const excluded = selection.excluded.find((entry) => entry.ref.value === ref);
  if (
    !excluded ||
    !entryChanged(role, excluded, source, candidate, projections)
  ) {
    return [];
  }
  return [
    deniedBlocker(
      role,
      tableCreatedId,
      undefined,
      excluded.path,
      'A denied change would be applied.',
    ),
  ];
}

function deniedSchemaTargetChanges(
  role: 'head' | 'draft',
  source: DraftRevisionState,
  candidate: DraftRevisionState,
  tableCreatedId: string,
  beforeTable: ReturnType<typeof findTable>,
  afterTable: ReturnType<typeof findTable>,
  target: Extract<
    ResolvedDraftChangesSelection['deniedTargets'][number],
    { kind: 'schemaField' | 'schemaFields' }
  >,
): CandidateBlocker[] {
  const before = schemaRowFor(source, beforeTable?.id);
  const after = schemaRowFor(candidate, afterTable?.id);
  let paths: string[];
  if (target.kind === 'schemaField') {
    paths = [target.path];
  } else if (target.paths === 'all') {
    paths = [''];
  } else {
    paths = target.paths;
  }
  return paths.flatMap((path) =>
    sameValue(
      readJsonPath(before?.data as never, path),
      readJsonPath(after?.data as never, path),
    )
      ? []
      : [
          deniedBlocker(
            role,
            tableCreatedId,
            undefined,
            path,
            'A denied schema field would change.',
          ),
        ],
  );
}

function deniedRowTargetChanges(
  role: 'head' | 'draft',
  tableCreatedId: string,
  beforeTable: ReturnType<typeof findTable>,
  afterTable: ReturnType<typeof findTable>,
  target: Exclude<
    ResolvedDraftChangesSelection['deniedTargets'][number],
    { kind: 'table' | 'change' | 'schemaField' | 'schemaFields' }
  >,
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
): CandidateBlocker[] {
  const rowCreatedId =
    'rowCreatedId' in target ? target.rowCreatedId : undefined;
  const beforeRow = findRow(beforeTable, rowCreatedId ?? '');
  const afterRow = findRow(afterTable, rowCreatedId ?? '');
  if (
    target.kind === 'row' &&
    target.facets.includes('lifecycle') &&
    Boolean(beforeRow) !== Boolean(afterRow)
  ) {
    return [
      deniedBlocker(
        role,
        tableCreatedId,
        rowCreatedId,
        undefined,
        'A denied row lifecycle would change.',
      ),
    ];
  }
  if (target.kind === 'row' && target.facets.includes('rowFields')) {
    return beforeRow && afterRow && !sameValue(beforeRow.data, afterRow.data)
      ? [
          deniedBlocker(
            role,
            tableCreatedId,
            rowCreatedId,
            '',
            'Denied row fields would change.',
          ),
        ]
      : [];
  }
  const paths = rowFieldPaths(target);
  if (!beforeRow || !afterRow) {
    return beforeRow !== afterRow && paths.length > 0
      ? [
          deniedBlocker(
            role,
            tableCreatedId,
            rowCreatedId,
            paths[0],
            'A denied row field lifecycle would change.',
          ),
        ]
      : [];
  }
  return paths
    .filter(
      (path) =>
        !sameValue(
          readJsonPath(
            beforeRow.data as never,
            sourceFieldPath(role, projections, tableCreatedId, path),
          ),
          readJsonPath(
            afterRow.data as never,
            candidateFieldPath(projections, tableCreatedId, path),
          ),
        ),
    )
    .map((path) =>
      deniedBlocker(
        role,
        tableCreatedId,
        rowCreatedId,
        path,
        'A denied row field would change.',
      ),
    );
}

function rowFieldPaths(
  target: Exclude<
    ResolvedDraftChangesSelection['deniedTargets'][number],
    { kind: 'table' | 'change' | 'schemaField' | 'schemaFields' }
  >,
): string[] {
  if (target.kind === 'rowField') {
    return [target.path];
  }
  if (target.kind !== 'rowFields') {
    return [];
  }
  return target.paths === 'all' ? [''] : target.paths;
}

function deniedBlocker(
  role: 'head' | 'draft',
  tableCreatedId: string,
  rowCreatedId: string | undefined,
  path: string | undefined,
  message: string,
): CandidateBlocker {
  return {
    code: 'EXCLUDED_PREREQUISITE',
    role,
    tableCreatedId,
    ...(rowCreatedId ? { rowCreatedId } : {}),
    ...(path !== undefined ? { path } : {}),
    message,
  };
}

function sameRowMembership(
  left: DraftRevisionState['tables'][number] | undefined,
  right: DraftRevisionState['tables'][number] | undefined,
): boolean {
  const leftIds = (left?.rows ?? []).map(({ createdId }) => createdId).sort();
  const rightIds = (right?.rows ?? []).map(({ createdId }) => createdId).sort();
  return deepEqual(leftIds, rightIds);
}

function schemaRowFor(state: DraftRevisionState, tableId: string | undefined) {
  return tableId
    ? state.tables
        .find(({ id }) => id === SystemTables.Schema)
        ?.rows.find(({ id }) => id === tableId)
    : undefined;
}

function sameSchemaRow(
  source: DraftRevisionState,
  candidate: DraftRevisionState,
  sourceId: string | undefined,
  candidateId: string | undefined,
): boolean {
  return deepEqual(
    schemaRowFor(source, sourceId)?.data,
    schemaRowFor(candidate, candidateId)?.data,
  );
}

function entryChanged(
  role: 'head' | 'draft',
  entry: DraftChangesCatalogueEntry,
  source: DraftRevisionState,
  candidate: DraftRevisionState,
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
): boolean {
  if (entry.target.kind === 'rowField') {
    const before = findRow(
      findTable(source, entry.target.tableCreatedId),
      entry.target.rowCreatedId,
    );
    const after = findRow(
      findTable(candidate, entry.target.tableCreatedId),
      entry.target.rowCreatedId,
    );
    return !sameValue(
      readJsonPath(
        before?.data as never,
        sourceFieldPath(
          role,
          projections,
          entry.target.tableCreatedId,
          entry.path ?? '',
        ),
      ),
      readJsonPath(
        after?.data as never,
        candidateFieldPath(
          projections,
          entry.target.tableCreatedId,
          entry.path ?? '',
        ),
      ),
    );
  }
  if (entry.target.kind === 'row') {
    const tableCreatedId = entry.target.tableCreatedId;
    const rowCreatedId = entry.target.rowCreatedId;
    const before = findRow(findTable(source, tableCreatedId), rowCreatedId);
    const after = findRow(findTable(candidate, tableCreatedId), rowCreatedId);
    return (
      Boolean(before) !== Boolean(after) ||
      (before !== undefined && after !== undefined && before.id !== after.id)
    );
  }
  if (entry.target.kind === 'table') {
    const before = findTable(source, entry.target.tableCreatedId);
    const after = findTable(candidate, entry.target.tableCreatedId);
    return (
      Boolean(before) !== Boolean(after) ||
      (before !== undefined && after !== undefined && before.id !== after.id)
    );
  }
  if (entry.target.kind !== 'schemaField') {
    return false;
  }

  const beforeTable = findTable(source, entry.target.tableCreatedId);
  const afterTable = findTable(candidate, entry.target.tableCreatedId);
  const beforeSchema = schemaRowFor(source, beforeTable?.id);
  const afterSchema = schemaRowFor(candidate, afterTable?.id);
  const path = entry.path ?? '';
  if (entry.classification === 'renamed') {
    const previousPath = entry.previousPath ?? path;
    return (
      (readJsonPath(beforeSchema?.data as never, previousPath) !==
        missingValue) !==
        (readJsonPath(afterSchema?.data as never, previousPath) !==
          missingValue) ||
      (readJsonPath(beforeSchema?.data as never, path) !== missingValue) !==
        (readJsonPath(afterSchema?.data as never, path) !== missingValue)
    );
  }
  const rolePath = role === 'head' ? (entry.previousPath ?? path) : path;
  return !sameValue(
    readJsonPath(beforeSchema?.data as never, rolePath),
    readJsonPath(afterSchema?.data as never, rolePath),
  );
}

function candidateFieldPath(
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
  tableCreatedId: string,
  path: string,
): string {
  return (
    projections
      .get(tableCreatedId)
      ?.rowTargetFieldMappings.find(({ fromPath }) => fromPath === path)
      ?.toPath ?? path
  );
}

function sourceFieldPath(
  role: 'head' | 'draft',
  projections: Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >,
  tableCreatedId: string,
  path: string,
): string {
  if (role === 'draft') {
    return path;
  }
  return (
    projections
      .get(tableCreatedId)
      ?.rowFieldMappings.find(({ fromPath }) => fromPath === path)?.toPath ??
    path
  );
}

function tableCreatedIdForTarget(
  target: DraftChangesCatalogueEntry['target'],
): string | undefined {
  return 'tableCreatedId' in target ? target.tableCreatedId : undefined;
}

function sameValue(left: unknown, right: unknown): boolean {
  return left === missingValue || right === missingValue
    ? left === right
    : deepEqual(left, right);
}
