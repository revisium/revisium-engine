import { ProjectDraftChangesSchemaQuery } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type {
  ProjectDraftChangesSchemaResult,
  SchemaEffectRef,
} from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type {
  CandidateBlocker,
  CandidateRequirement,
} from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type {
  AdditionalCandidateSchemaEffect,
  CandidateSchemaForeignKeyChange,
  ResolvedDraftChangesSelection,
} from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import { pairSnapshotTables } from 'src/features/draft-changes/catalogue/snapshot-pairs';

export type SchemaProjectionPreparation =
  | {
      status: 'projected';
      projections: Map<
        string,
        Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
      >;
      foreignKeyChanges: CandidateSchemaForeignKeyChange[];
    }
  | { status: 'needsEffects'; requirements: CandidateRequirement[] }
  | { status: 'blocked'; blockers: CandidateBlocker[] };

export async function projectCandidateSchemas(
  snapshot: DraftChangesSnapshot,
  operation: 'commit' | 'discard',
  selection: ResolvedDraftChangesSelection,
  executeProjection: (
    query: ProjectDraftChangesSchemaQuery,
  ) => Promise<ProjectDraftChangesSchemaResult>,
  additionalSchemaEffects: AdditionalCandidateSchemaEffect[] = [],
): Promise<SchemaProjectionPreparation> {
  const projectionSnapshot = withoutDiscardedCreatedRows(
    snapshot,
    operation,
    selection,
  );
  const paired = pairSnapshotTables(projectionSnapshot);
  if ('blocker' in paired) {
    return {
      status: 'blocked',
      blockers: [{ code: 'INVALID_SELECTION', message: paired.blocker }],
    };
  }
  const projections = new Map<
    string,
    Extract<ProjectDraftChangesSchemaResult, { status: 'projected' }>
  >();
  const foreignKeyChanges: CandidateSchemaForeignKeyChange[] = [];
  for (const pair of paired.pairs) {
    if (!pair.head || !pair.draft) {
      continue;
    }
    const schemaEntries = selectedSchemaEntries(
      selection.selected,
      pair.createdId,
    );
    const historyEffects = additionalSchemaEffects.flatMap((effect) =>
      effect.kind === 'history' && effect.tableCreatedId === pair.createdId
        ? effect.effects
        : [],
    );
    const effects = uniqueEffects([
      ...schemaEntries.flatMap(({ effectRefs }) => effectRefs ?? []),
      ...historyEffects,
    ]);
    const foreignKeyRetargets = additionalSchemaEffects.flatMap((effect) =>
      effect.kind === 'foreignKeyRetarget' &&
      effect.tableCreatedId === pair.createdId
        ? [
            {
              targetTableCreatedId: effect.targetTableCreatedId,
              fromTableId: effect.fromTableId,
              toTableId: effect.toTableId,
            },
          ]
        : [],
    );
    const discardedDataFields =
      operation === 'discard'
        ? selection.selected.flatMap((entry) =>
            entry.kind === 'rowField' &&
            entry.target.kind === 'rowField' &&
            entry.target.tableCreatedId === pair.createdId &&
            entry.path !== undefined
              ? [{ rowCreatedId: entry.target.rowCreatedId, path: entry.path }]
              : [],
          )
        : [];
    const result = await executeProjection(
      new ProjectDraftChangesSchemaQuery({
        snapshot: projectionSnapshot,
        tableCreatedId: pair.createdId,
        operation,
        effects,
        discardedDataFields,
        foreignKeyRetargets,
      }),
    );
    if (result.status === 'projected') {
      projections.set(pair.createdId, result);
      foreignKeyChanges.push(
        ...(result.foreignKeyChanges ?? []).map((change) => ({
          ...change,
          tableCreatedId: pair.createdId,
        })),
      );
      continue;
    }
    const requirement = requiredDiscardFields(result, schemaEntries[0]);
    if (requirement) {
      return { status: 'needsEffects', requirements: [requirement] };
    }
    return {
      status: 'blocked',
      blockers: result.blockers.map((schemaBlocker) => ({
        code: 'SCHEMA_PROJECTION_BLOCKED',
        message: schemaBlocker.message,
        role: operation === 'commit' ? 'head' : 'draft',
        tableCreatedId: pair.createdId,
        rowCreatedId: schemaBlocker.rowCreatedId,
        path: schemaBlocker.path,
        schemaBlocker,
      })),
    };
  }
  return { status: 'projected', projections, foreignKeyChanges };
}

function withoutDiscardedCreatedRows(
  snapshot: DraftChangesSnapshot,
  operation: 'commit' | 'discard',
  selection: ResolvedDraftChangesSelection,
): DraftChangesSnapshot {
  if (operation !== 'discard') {
    return snapshot;
  }
  const discardedRowsByTable = new Map<string, Set<string>>();
  for (const entry of selection.selected) {
    if (
      entry.kind !== 'row' ||
      entry.classification !== 'created' ||
      entry.target.kind !== 'row'
    ) {
      continue;
    }
    const rowIds =
      discardedRowsByTable.get(entry.target.tableCreatedId) ?? new Set();
    rowIds.add(entry.target.rowCreatedId);
    discardedRowsByTable.set(entry.target.tableCreatedId, rowIds);
  }
  if (discardedRowsByTable.size === 0) {
    return snapshot;
  }
  const detached = structuredClone(snapshot);
  detached.draft.tables = detached.draft.tables.map((table) => ({
    ...table,
    rows: table.rows.filter(
      (row) => !discardedRowsByTable.get(table.createdId)?.has(row.createdId),
    ),
  }));
  return detached;
}

function selectedSchemaEntries(
  entries: DraftChangesCatalogueEntry[],
  tableCreatedId: string,
): DraftChangesCatalogueEntry[] {
  return entries.filter(
    (entry) =>
      entry.kind === 'schemaField' &&
      entry.target.kind === 'schemaField' &&
      entry.target.tableCreatedId === tableCreatedId,
  );
}

function uniqueEffects(effects: SchemaEffectRef[]): SchemaEffectRef[] {
  const seen = new Set<string>();
  return effects.filter(({ historyIndex, patchIndex }) => {
    const key = `${historyIndex}:${patchIndex}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function requiredDiscardFields(
  result: Extract<ProjectDraftChangesSchemaResult, { status: 'blocked' }>,
  cause: DraftChangesCatalogueEntry | undefined,
): CandidateRequirement | undefined {
  const requiredDataFields = result.blockers.flatMap(
    ({ requiredDataFields }) => requiredDataFields ?? [],
  );
  if (!cause || requiredDataFields.length === 0) {
    return undefined;
  }
  return {
    role: 'draft',
    causeRef: cause.ref,
    kind: 'discardDataFields',
    tableCreatedId:
      cause.target.kind === 'schemaField' ? cause.target.tableCreatedId : '',
    fields: requiredDataFields,
  };
}
