import objectHash from 'object-hash';
import type { JsonValue } from '@revisium/schema-toolkit/types';
import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { CalculateDataCandidatesQueryData } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { setJsonPath } from 'src/features/draft-changes/schema/json-value-path';
import type { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import type { AutomaticForeignKeyEffect } from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import type { AdditionalCandidateSchemaEffect } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { CandidateDependencyBlocker } from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import {
  readCandidateReferences,
  type CandidateForeignKeyReference,
} from './reference-graph';
import {
  createOriginalReferenceLookup,
  originalTargetRow,
  originalTargetBinding,
  referenceOriginRole,
  referenceSchemaOriginRole,
} from './candidate-references';
import { excludedForeignKeyPath } from './exclusions';

export interface ReferenceRenamePlan {
  schemaEffects: AdditionalCandidateSchemaEffect[];
  appliedEffects: AutomaticForeignKeyEffect[];
  rowEffects: AutomaticForeignKeyEffect[];
  blockers: CandidateDependencyBlocker[];
}

export function planReferenceRenames(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  candidate: { head: DraftRevisionState; draft: DraftRevisionState },
  schemaStores: JsonSchemaStoreService,
): ReferenceRenamePlan {
  const plan: ReferenceRenamePlan = {
    schemaEffects: [],
    appliedEffects: [],
    rowEffects: [],
    blockers: [],
  };
  const originalReferences = createOriginalReferenceLookup(
    data.snapshot,
    schemaStores,
  );
  for (const role of ['head', 'draft'] as const) {
    const references = readCandidateReferences(
      candidate[role],
      role,
      schemaStores,
    );
    for (const reference of references) {
      planReference({
        data,
        candidate,
        role,
        reference,
        originalReferences,
        plan,
      });
    }
  }
  return deduplicatePlan(plan);
}

interface ReferencePlanningContext {
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>;
  candidate: { head: DraftRevisionState; draft: DraftRevisionState };
  role: 'head' | 'draft';
  reference: CandidateForeignKeyReference;
  originalReferences: ReturnType<typeof createOriginalReferenceLookup>;
  plan: ReferenceRenamePlan;
}

function planReference(context: ReferencePlanningContext): void {
  if (context.reference.kind === 'schema') {
    planSchemaReference(context);
    return;
  }
  planRowReference(context);
}

function planSchemaReference(context: ReferencePlanningContext): void {
  const { data, candidate, role, reference, plan } = context;
  const schemaRole = referenceSchemaOriginRole(
    data.snapshot,
    data.operation,
    role,
    reference,
    data.selection,
  );
  const previous = context.originalReferences.find(schemaRole, reference);
  const binding = originalTargetBinding(
    data.snapshot,
    schemaRole,
    previous ?? reference,
  );
  if (!binding) {
    return;
  }
  const targetTable = candidate[role].tables.find(
    ({ createdId }) => createdId === binding.tableCreatedId,
  );
  if (!targetTable) {
    return;
  }
  if (reference.targetTableId === targetTable.id) {
    addAppliedSchemaRename(
      plan,
      data,
      role,
      reference,
      targetTable.createdId,
      previous,
    );
    return;
  }
  const cause = tableIdentityCause(data, targetTable.createdId);
  if (!cause) {
    plan.blockers.push(unrepresentableBlocker(reference));
    return;
  }
  const headTarget = candidate.head.tables.find(
    (table) => table.createdId === targetTable.createdId,
  );
  const draftTarget = candidate.draft.tables.find(
    (table) => table.createdId === targetTable.createdId,
  );
  const originalHeadTarget = (
    data.snapshot.head as unknown as DraftRevisionState
  ).tables.find((table) => table.createdId === targetTable.createdId);
  const originalDraftTarget = (
    data.snapshot.draft as unknown as DraftRevisionState
  ).tables.find((table) => table.createdId === targetTable.createdId);
  plan.schemaEffects.push({
    kind: 'foreignKeyRetarget',
    tableCreatedId: reference.tableCreatedId,
    targetTableCreatedId: targetTable.createdId,
    fromTableId:
      originalHeadTarget?.id ?? headTarget?.id ?? reference.targetTableId,
    toTableId: originalDraftTarget?.id ?? draftTarget?.id ?? targetTable.id,
    causeRef: cause.ref,
  });
}

function addAppliedSchemaRename(
  plan: ReferenceRenamePlan,
  data: ReferencePlanningContext['data'],
  role: ReferencePlanningContext['role'],
  reference: CandidateForeignKeyReference,
  targetTableCreatedId: string,
  previous: CandidateForeignKeyReference | undefined,
): void {
  const cause = tableIdentityCause(data, targetTableCreatedId);
  if (
    !previous ||
    previous.targetTableId === reference.targetTableId ||
    !cause
  ) {
    return;
  }
  plan.appliedEffects.push({
    kind: 'schemaForeignKey',
    role,
    tableCreatedId: reference.tableCreatedId,
    targetTableCreatedId,
    path: reference.schemaPath,
    before: previous.targetTableId,
    after: reference.targetTableId,
    causeRefs: [cause.ref],
  });
}

function planRowReference(context: ReferencePlanningContext): void {
  const { data, candidate, role, reference, plan } = context;
  const schemaRole = referenceSchemaOriginRole(
    data.snapshot,
    data.operation,
    role,
    reference,
    data.selection,
  );
  const originalSchema = context.originalReferences.find(schemaRole, reference);
  const binding = originalTargetBinding(
    data.snapshot,
    schemaRole,
    originalSchema ?? reference,
  );
  if (!binding) {
    return;
  }
  const dataRole = referenceOriginRole(
    data.snapshot,
    data.operation,
    role,
    reference,
    data.selection,
  );
  const previous = context.originalReferences.find(dataRole, reference);
  const originalRow = originalTargetRow(
    data.snapshot,
    dataRole,
    binding.tableCreatedId,
    previous?.targetRowId ?? reference.targetRowId,
  );
  if (!originalRow) {
    return;
  }
  const targetTable = candidate[role].tables.find(
    ({ createdId }) => createdId === binding.tableCreatedId,
  );
  const targetRow = targetTable?.rows.find(
    ({ createdId }) => createdId === originalRow.createdId,
  );
  if (!targetTable || !targetRow) {
    return;
  }
  if (reference.targetRowId === targetRow.id) {
    addAppliedRowRename(
      plan,
      data,
      role,
      reference,
      targetTable.createdId,
      targetRow.createdId,
      previous,
    );
    return;
  }
  const cause = rowIdentityCause(
    data,
    targetTable.createdId,
    targetRow.createdId,
  );
  if (!cause || !reference.rowCreatedId) {
    plan.blockers.push(unrepresentableBlocker(reference));
    return;
  }
  const deniedPath = excludedForeignKeyPath(data, reference);
  if (deniedPath !== undefined) {
    plan.blockers.push(excludedRowRewriteBlocker(reference, role, deniedPath));
    return;
  }
  applyRowRewrite(
    plan,
    candidate[role],
    reference,
    targetTable.createdId,
    targetRow.id,
    targetRow.createdId,
    cause.ref,
  );
}

function addAppliedRowRename(
  plan: ReferenceRenamePlan,
  data: ReferencePlanningContext['data'],
  role: ReferencePlanningContext['role'],
  reference: CandidateForeignKeyReference,
  targetTableCreatedId: string,
  targetRowCreatedId: string,
  previous: CandidateForeignKeyReference | undefined,
): void {
  if (!previous || previous.targetRowId === reference.targetRowId) {
    return;
  }
  const cause = rowIdentityCause(
    data,
    targetTableCreatedId,
    targetRowCreatedId,
  );
  if (!cause) {
    return;
  }
  plan.appliedEffects.push({
    kind: 'rowForeignKey',
    role,
    tableCreatedId: reference.tableCreatedId,
    rowCreatedId: reference.rowCreatedId ?? '',
    targetTableCreatedId,
    targetRowCreatedId,
    path: reference.path,
    before: previous.targetRowId ?? '',
    after: reference.targetRowId ?? '',
    causeRefs: [cause.ref],
  });
}

function applyRowRewrite(
  plan: ReferenceRenamePlan,
  state: DraftRevisionState,
  reference: CandidateForeignKeyReference,
  targetTableCreatedId: string,
  targetRowId: string,
  targetRowCreatedId: string,
  causeRef: DraftChangesCatalogueEntry['ref'],
): void {
  const sourceTable = state.tables.find(
    ({ createdId }) => createdId === reference.tableCreatedId,
  );
  const sourceRow = sourceTable?.rows.find(
    ({ createdId }) => createdId === reference.rowCreatedId,
  );
  if (!sourceTable || !sourceRow) {
    plan.blockers.push(unrepresentableBlocker(reference));
    return;
  }
  const updated = setJsonPath(
    sourceRow.data as JsonValue,
    reference.path,
    targetRowId,
  );
  if (!updated.representable) {
    plan.blockers.push(unrepresentableBlocker(reference));
    return;
  }
  sourceRow.data = updated.value as typeof sourceRow.data;
  sourceRow.hash = objectHash(sourceRow.data);
  sourceRow.readonly = false;
  plan.rowEffects.push({
    kind: 'rowForeignKey',
    role: reference.role,
    tableCreatedId: sourceTable.createdId,
    rowCreatedId: sourceRow.createdId,
    targetTableCreatedId,
    targetRowCreatedId,
    path: reference.path,
    before: reference.targetRowId ?? '',
    after: targetRowId,
    causeRefs: [causeRef],
  });
}

function excludedRowRewriteBlocker(
  reference: CandidateForeignKeyReference,
  role: ReferencePlanningContext['role'],
  path: string,
): CandidateDependencyBlocker {
  return {
    code: 'EXCLUDED_REFERENCE_REWRITE',
    message: 'A generated row reference rewrite is excluded.',
    role,
    tableCreatedId: reference.tableCreatedId,
    rowCreatedId: reference.rowCreatedId ?? '',
    path,
    targetTableId: reference.targetTableId,
    ...(reference.targetRowId === undefined
      ? {}
      : { targetRowId: reference.targetRowId }),
  };
}

function deduplicatePlan(plan: ReferenceRenamePlan): ReferenceRenamePlan {
  return {
    schemaEffects: uniqueSchemaEffects(plan.schemaEffects),
    appliedEffects: uniqueRowEffects(plan.appliedEffects),
    rowEffects: uniqueRowEffects(plan.rowEffects),
    blockers: uniqueBlockers(plan.blockers),
  };
}

function tableIdentityCause(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  tableCreatedId: string,
): DraftChangesCatalogueEntry | undefined {
  return data.selection.selected.find(
    (entry) =>
      entry.kind === 'table' &&
      entry.target.kind === 'table' &&
      entry.target.tableCreatedId === tableCreatedId &&
      (entry.classification === 'renamed' ||
        entry.classification === 'created'),
  );
}

function rowIdentityCause(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  tableCreatedId: string,
  rowCreatedId: string,
): DraftChangesCatalogueEntry | undefined {
  return data.selection.selected.find(
    (entry) =>
      entry.kind === 'row' &&
      entry.target.kind === 'row' &&
      entry.target.tableCreatedId === tableCreatedId &&
      entry.target.rowCreatedId === rowCreatedId &&
      (entry.classification === 'renamed' ||
        entry.classification === 'created'),
  );
}

function unrepresentableBlocker(
  reference: CandidateForeignKeyReference,
): CandidateDependencyBlocker {
  return {
    code: 'UNREPRESENTABLE_REFERENCE',
    message:
      'A renamed foreign key target has no stable candidate counterpart.',
    role: reference.role,
    tableCreatedId: reference.tableCreatedId,
    ...(reference.rowCreatedId === undefined
      ? {}
      : { rowCreatedId: reference.rowCreatedId }),
    path: reference.path,
    targetTableId: reference.targetTableId,
    ...(reference.targetRowId === undefined
      ? {}
      : { targetRowId: reference.targetRowId }),
  };
}

function uniqueSchemaEffects(
  effects: AdditionalCandidateSchemaEffect[],
): AdditionalCandidateSchemaEffect[] {
  return uniqueByJson(effects);
}

function uniqueRowEffects(
  effects: AutomaticForeignKeyEffect[],
): AutomaticForeignKeyEffect[] {
  return uniqueByJson(effects);
}

function uniqueByJson<T>(values: T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueBlockers(
  blockers: ReferenceRenamePlan['blockers'],
): ReferenceRenamePlan['blockers'] {
  return uniqueByJson(blockers);
}
