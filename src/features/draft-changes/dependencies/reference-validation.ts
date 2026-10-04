import type { CalculateDataCandidatesQueryData } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type {
  RequiredCandidateEffect,
  CandidateDependencyBlocker,
} from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import {
  readCandidateReferences,
  findMissingReferenceTarget,
} from './reference-graph';
import { findReferenceRepair } from './reference-repairs';
import { excludedForeignKeyPath } from './exclusions';
import {
  createOriginalReferenceLookup,
  originalTargetRow,
  originalTargetBinding,
  referenceOriginRole,
  referenceSchemaOriginRole,
  type OriginalReferenceLookup,
} from './candidate-references';
import { uniqueRequirements, uniqueBlockers } from './dependency-effects';

export function requirementsForMissingReferences(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  candidate: { head: DraftRevisionState; draft: DraftRevisionState },
  schemaStores: JsonSchemaStoreService,
): {
  requirements: RequiredCandidateEffect[];
  blockers: CandidateDependencyBlocker[];
} {
  const requirements: RequiredCandidateEffect[] = [];
  const blockers: CandidateDependencyBlocker[] = [];
  const originalReferences = createOriginalReferenceLookup(
    data.snapshot,
    schemaStores,
  );
  for (const role of ['head', 'draft'] as const) {
    const state = candidate[role];
    for (const reference of readCandidateReferences(
      state,
      role,
      schemaStores,
    )) {
      const result = resolveReferenceRequirement(
        data,
        state,
        role,
        reference,
        originalReferences,
      );
      requirements.push(...result.requirements);
      if (result.blocker) {
        blockers.push(result.blocker);
      }
    }
  }
  return {
    requirements: uniqueRequirements(requirements),
    blockers: uniqueBlockers(blockers),
  };
}

function resolveReferenceRequirement(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  state: DraftRevisionState,
  role: 'head' | 'draft',
  reference: ReturnType<typeof readCandidateReferences>[number],
  originalReferences: OriginalReferenceLookup,
): {
  requirements: RequiredCandidateEffect[];
  blocker?: CandidateDependencyBlocker;
} {
  if (!referenceNeedsRepair(data, state, role, reference, originalReferences)) {
    return { requirements: [] };
  }
  const excludedPath = excludedForeignKeyPath(data, reference);
  if (excludedPath !== undefined) {
    return {
      requirements: [],
      blocker: excludedReferenceBlocker(reference, role, excludedPath),
    };
  }
  const repair = findReferenceRepair({
    snapshot: data.snapshot,
    operation: data.operation,
    candidateRole: role,
    reference,
    selected: data.selection.selected,
    catalogue: data.catalogue,
  });
  return 'blocker' in repair
    ? { requirements: [], blocker: repair.blocker }
    : { requirements: repair.requirements };
}

function excludedReferenceBlocker(
  reference: ReturnType<typeof readCandidateReferences>[number],
  role: 'head' | 'draft',
  path: string,
): CandidateDependencyBlocker {
  return {
    code: 'EXCLUDED_REFERENCE_REWRITE',
    message: 'A required foreign-key rewrite is excluded.',
    role,
    tableCreatedId: reference.tableCreatedId,
    ...(reference.rowCreatedId === undefined
      ? {}
      : { rowCreatedId: reference.rowCreatedId }),
    path,
    targetTableId: reference.targetTableId,
    ...(reference.targetRowId === undefined
      ? {}
      : { targetRowId: reference.targetRowId }),
  };
}

export function missingReferenceBlockers(
  candidate: { head: DraftRevisionState; draft: DraftRevisionState },
  schemaStores: JsonSchemaStoreService,
  selectedData?: Extract<
    CalculateDataCandidatesQueryData,
    { mode: 'selected' }
  >,
): CandidateDependencyBlocker[] {
  const blockers: CandidateDependencyBlocker[] = [];
  const originalReferences = selectedData
    ? createOriginalReferenceLookup(selectedData.snapshot, schemaStores)
    : undefined;
  for (const role of ['head', 'draft'] as const) {
    const state = candidate[role];
    for (const reference of readCandidateReferences(
      state,
      role,
      schemaStores,
    )) {
      if (
        !needsMissingReferenceBlocker(
          selectedData,
          originalReferences,
          state,
          role,
          reference,
        )
      ) {
        continue;
      }
      blockers.push({
        code: 'MISSING_REFERENCE_TARGET',
        message:
          'A foreign key reference has no target in the resulting state.',
        role,
        tableCreatedId: reference.tableCreatedId,
        ...(reference.rowCreatedId === undefined
          ? {}
          : { rowCreatedId: reference.rowCreatedId }),
        path: reference.path,
        targetTableId: reference.targetTableId,
        ...(reference.targetRowId === undefined
          ? {}
          : { targetRowId: reference.targetRowId }),
      });
    }
  }
  return uniqueBlockers(blockers);
}

function needsMissingReferenceBlocker(
  data:
    | Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>
    | undefined,
  originalReferences: OriginalReferenceLookup | undefined,
  state: DraftRevisionState,
  role: 'head' | 'draft',
  reference: ReturnType<typeof readCandidateReferences>[number],
): boolean {
  if (!data || !originalReferences) {
    return findMissingReferenceTarget(state, reference);
  }
  return referenceNeedsRepair(data, state, role, reference, originalReferences);
}

function referenceNeedsRepair(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  state: DraftRevisionState,
  role: 'head' | 'draft',
  reference: ReturnType<typeof readCandidateReferences>[number],
  originalReferences: OriginalReferenceLookup,
): boolean {
  const schemaRole = referenceSchemaOriginRole(
    data.snapshot,
    data.operation,
    role,
    reference,
    data.selection,
  );
  const sourceSchemaReference = originalReferences.find(schemaRole, reference);
  const tableBinding = originalTargetBinding(
    data.snapshot,
    schemaRole,
    sourceSchemaReference ?? reference,
  );
  if (!tableBinding) {
    return true;
  }
  const targetTable = state.tables.find(
    ({ createdId }) => createdId === tableBinding.tableCreatedId,
  );
  if (!targetTable) {
    return true;
  }
  if (reference.kind === 'schema') {
    return reference.targetTableId !== targetTable.id;
  }
  const valueRole = referenceOriginRole(
    data.snapshot,
    data.operation,
    role,
    reference,
    data.selection,
  );
  const sourceRow = originalTargetRow(
    data.snapshot,
    valueRole,
    tableBinding.tableCreatedId,
    originalReferences.find(valueRole, reference)?.targetRowId ??
      reference.targetRowId,
  );
  if (!sourceRow) {
    return true;
  }
  const candidateRow = targetTable.rows.find(
    ({ createdId }) => createdId === sourceRow.createdId,
  );
  return !candidateRow || reference.targetRowId !== candidateRow.id;
}
