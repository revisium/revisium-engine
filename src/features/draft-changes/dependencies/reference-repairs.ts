import type {
  DraftChangesCatalogue,
  DraftChangesCatalogueEntry,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { ResolvedDraftChangesSelection } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { CandidateForeignKeyReference } from './reference-graph';
import type {
  CandidateDependencyBlocker,
  RequiredCandidateEffect,
} from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { HistoryPatches } from 'src/features/share/queries/impl/transactional/get-table-schema.query';
import type { JsonPatch } from '@revisium/schema-toolkit/types';

interface ReferenceRepairInput {
  snapshot: DraftChangesSnapshot;
  operation: 'commit' | 'discard';
  candidateRole: 'head' | 'draft';
  reference: CandidateForeignKeyReference;
  selected: ResolvedDraftChangesSelection['selected'];
  catalogue: DraftChangesCatalogue;
}

export type ReferenceRepairResult =
  | { requirements: RequiredCandidateEffect[] }
  | { blocker: CandidateDependencyBlocker };

export function findReferenceRepair(
  input: ReferenceRepairInput,
): ReferenceRepairResult {
  const alternatives = [
    ...targetLifecycleRepairs(input),
    ...sourceDataRepairs(input),
    ...sourceSchemaRepairs(input),
  ];
  const unique = uniqueRepairs(alternatives);
  if (unique.length === 1) {
    return { requirements: unique };
  }
  if (unique.length > 1) {
    return {
      blocker: {
        code: 'AMBIGUOUS_REFERENCE_REPAIR',
        message: 'More than one existing effect can repair this reference.',
        role: input.candidateRole,
        tableCreatedId: input.reference.tableCreatedId,
        ...(input.reference.rowCreatedId === undefined
          ? {}
          : { rowCreatedId: input.reference.rowCreatedId }),
        path: input.reference.path,
        targetTableId: input.reference.targetTableId,
        ...(input.reference.targetRowId === undefined
          ? {}
          : { targetRowId: input.reference.targetRowId }),
      },
    };
  }
  return {
    blocker: {
      code: 'MISSING_REFERENCE_TARGET',
      message: 'A foreign key reference has no target in the resulting state.',
      role: input.candidateRole,
      tableCreatedId: input.reference.tableCreatedId,
      ...(input.reference.rowCreatedId === undefined
        ? {}
        : { rowCreatedId: input.reference.rowCreatedId }),
      path: input.reference.path,
      targetTableId: input.reference.targetTableId,
      ...(input.reference.targetRowId === undefined
        ? {}
        : { targetRowId: input.reference.targetRowId }),
    },
  };
}

function targetLifecycleRepairs(
  input: ReferenceRepairInput,
): RequiredCandidateEffect[] {
  const originRole = input.operation === 'commit' ? 'draft' : 'head';
  const source = input.snapshot[originRole] as unknown as DraftRevisionState;
  const targetTable = source.tables.find(
    ({ id }) => id === input.reference.targetTableId,
  );
  if (!targetTable) {
    return [];
  }
  if (input.reference.kind === 'schema') {
    const tableEntry = input.catalogue.entries.find(
      (entry) =>
        entry.kind === 'table' &&
        entry.target.kind === 'table' &&
        entry.target.tableCreatedId === targetTable.createdId &&
        entry.classification ===
          (input.operation === 'commit' ? 'created' : 'deleted'),
    );
    return tableEntry ? [catalogueRequirement(input, tableEntry)] : [];
  }
  const targetRow = targetTable.rows.find(
    ({ id }) => id === input.reference.targetRowId,
  );
  if (!targetRow) {
    return [];
  }
  const rowEntry = input.catalogue.entries.find(
    (entry) =>
      entry.kind === 'row' &&
      entry.target.kind === 'row' &&
      entry.target.tableCreatedId === targetTable.createdId &&
      entry.target.rowCreatedId === targetRow.createdId &&
      entry.classification ===
        (input.operation === 'commit' ? 'created' : 'deleted'),
  );
  return rowEntry ? [catalogueRequirement(input, rowEntry)] : [];
}

function sourceDataRepairs(
  input: ReferenceRepairInput,
): RequiredCandidateEffect[] {
  if (!input.reference.rowCreatedId) {
    return [];
  }
  const alternativeRole = input.operation === 'commit' ? 'draft' : 'head';
  const alternativeState = input.snapshot[
    alternativeRole
  ] as unknown as DraftRevisionState;
  const sourceTable = alternativeState.tables.find(
    ({ createdId }) => createdId === input.reference.tableCreatedId,
  );
  const sourceRow = sourceTable?.rows.find(
    ({ createdId }) => createdId === input.reference.rowCreatedId,
  );
  if (!sourceRow) {
    const sourceLifecycle = input.catalogue.entries.find(
      (entry) =>
        entry.kind === 'row' &&
        entry.target.kind === 'row' &&
        entry.target.tableCreatedId === input.reference.tableCreatedId &&
        entry.target.rowCreatedId === input.reference.rowCreatedId &&
        entry.classification ===
          (input.operation === 'commit' ? 'deleted' : 'created'),
    );
    return sourceLifecycle
      ? [catalogueRequirement(input, sourceLifecycle)]
      : [];
  }
  const changedSource = input.catalogue.entries.find(
    (entry) =>
      entry.kind === 'rowField' &&
      entry.target.kind === 'rowField' &&
      entry.target.tableCreatedId === input.reference.tableCreatedId &&
      entry.target.rowCreatedId === input.reference.rowCreatedId &&
      !input.selected.some(({ ref }) => ref.value === entry.ref.value) &&
      (entry.path === input.reference.path ||
        entry.previousPath === input.reference.path) &&
      typeof (input.operation === 'commit' ? entry.after : entry.before) ===
        'string' &&
      (input.operation === 'commit' ? entry.after : entry.before) !==
        input.reference.targetRowId,
  );
  return changedSource ? [catalogueRequirement(input, changedSource)] : [];
}

function sourceSchemaRepairs(
  input: ReferenceRepairInput,
): RequiredCandidateEffect[] {
  const alternativeRole = input.operation === 'commit' ? 'draft' : 'head';
  const alternativeState = input.snapshot[
    alternativeRole
  ] as unknown as DraftRevisionState;
  const sourceTable = alternativeState.tables.find(
    ({ createdId }) => createdId === input.reference.tableCreatedId,
  );
  if (!sourceTable) {
    return [];
  }
  const schemaTable = alternativeState.tables.find(
    ({ id }) => id === SystemTables.Schema,
  );
  const schemaRow = schemaTable?.rows.find(({ id }) => id === sourceTable.id);
  if (!schemaRow) {
    return [];
  }
  const schemaEntry = input.catalogue.entries.find(
    (entry) =>
      entry.kind === 'schemaField' &&
      entry.target.kind === 'schemaField' &&
      entry.target.tableCreatedId === input.reference.tableCreatedId &&
      (entry.path === input.reference.schemaPath ||
        entry.previousPath === input.reference.schemaPath) &&
      entry.effectRefs?.length,
  );
  if (!schemaEntry) {
    return [];
  }
  const repairEffects = foreignKeyRepairEffects(
    schemaEntry,
    schemaRow.meta as unknown as HistoryPatches[],
  );
  const missingEffects = repairEffects.filter(
    (effect) => !isSchemaEffectSelected(input, effect),
  );
  if (missingEffects.length === 0) {
    return [];
  }
  const nextForeignKey = getForeignKey(schemaEntry?.after);
  const removesReference = schemaEntry && !schemaEntry.afterExists;
  if (
    !removesReference &&
    (!nextForeignKey || nextForeignKey === input.reference.targetTableId)
  ) {
    return [];
  }
  return [
    {
      kind: 'schemaEffects',
      role: input.candidateRole,
      causeRef: causeRef(input),
      tableCreatedId: input.reference.tableCreatedId,
      effects: missingEffects,
    },
  ];
}

function isSchemaEffectSelected(
  input: ReferenceRepairInput,
  effect: { historyIndex: number; patchIndex: number },
): boolean {
  return input.selected.some(
    (selected) =>
      selected.kind === 'schemaField' &&
      selected.target.kind === 'schemaField' &&
      selected.target.tableCreatedId === input.reference.tableCreatedId &&
      selected.effectRefs?.some(
        (selectedEffect) =>
          selectedEffect.historyIndex === effect.historyIndex &&
          selectedEffect.patchIndex === effect.patchIndex,
      ),
  );
}

function foreignKeyRepairEffects(
  entry: DraftChangesCatalogueEntry,
  history: HistoryPatches[],
): Array<{ historyIndex: number; patchIndex: number }> {
  const refs = [...(entry.effectRefs ?? [])].sort(
    (left, right) =>
      left.historyIndex - right.historyIndex ||
      left.patchIndex - right.patchIndex,
  );
  let current = getForeignKey(entry.before);
  if (current === undefined) {
    return [];
  }
  const required: typeof refs = [];
  for (const ref of refs) {
    const patch = history[ref.historyIndex]?.patches[ref.patchIndex];
    const result = foreignKeyAfterPatch(patch, entry);
    if (!result.changed) {
      continue;
    }
    if (result.value !== current) {
      required.push(ref);
      current = result.value;
    }
  }
  return required;
}

function foreignKeyAfterPatch(
  patch: JsonPatch | undefined,
  entry: DraftChangesCatalogueEntry,
): { changed: boolean; value?: string } {
  if (!patch || entry.kind !== 'schemaField') {
    return { changed: false };
  }
  const paths = [entry.path, entry.previousPath].filter(
    (path): path is string => path !== undefined,
  );
  if (paths.includes(patch.path)) {
    return patchForeignKeyValue(patch, true);
  }
  if (paths.some((path) => patch.path === `${path}/foreignKey`)) {
    return patchForeignKeyValue(patch, false);
  }
  return { changed: false };
}

function patchForeignKeyValue(
  patch: JsonPatch,
  schemaNode: boolean,
): { changed: boolean; value?: string } {
  if (patch.op === 'remove') {
    return { changed: true };
  }
  if (patch.op !== 'add' && patch.op !== 'replace') {
    return { changed: false };
  }
  if (schemaNode) {
    return { changed: true, value: getForeignKey(patch.value) };
  }
  return {
    changed: true,
    value: typeof patch.value === 'string' ? patch.value : undefined,
  };
}

function catalogueRequirement(
  input: ReferenceRepairInput,
  entry: DraftChangesCatalogueEntry,
): RequiredCandidateEffect {
  return {
    role: input.candidateRole,
    kind: 'catalogueEffects',
    causeRef: causeRef(input),
    refs: [entry.ref],
  };
}

function causeRef(input: ReferenceRepairInput) {
  const cause = input.selected.find((entry) => {
    const target = entry.target;
    return (
      ('tableCreatedId' in target &&
        target.tableCreatedId === input.reference.tableCreatedId) ||
      (target.kind === 'table' &&
        target.tableCreatedId === input.reference.tableCreatedId)
    );
  });
  const anyCause = input.selected[0];
  const chosen = cause ?? anyCause;
  if (!chosen) {
    throw new Error('A dependency repair requires a selected cause.');
  }
  return chosen.ref;
}

function getForeignKey(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const foreignKey = (value as { foreignKey?: unknown }).foreignKey;
  return typeof foreignKey === 'string' ? foreignKey : undefined;
}

function uniqueRepairs(
  requirements: RequiredCandidateEffect[],
): RequiredCandidateEffect[] {
  const byKey = new Map(
    requirements.map((requirement) => [
      JSON.stringify(requirement),
      requirement,
    ]),
  );
  return [...byKey.values()];
}
