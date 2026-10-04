import type { QueryBus } from '@nestjs/cqrs';
import { CalculateDataCandidatesQuery } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type {
  CalculateDataCandidatesQueryData,
  CalculateDataCandidatesResult,
} from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { ResolveCandidateDependenciesResult } from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import type { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { readCandidateReferences } from './reference-graph';
import {
  referenceSchemaOriginRole,
  createOriginalReferenceLookup,
  originalTargetBinding,
  type OriginalReferenceLookup,
} from './candidate-references';

export async function calculate(
  queryBus: QueryBus,
  data: CalculateDataCandidatesQueryData,
): Promise<CalculateDataCandidatesResult> {
  return queryBus.execute(
    new CalculateDataCandidatesQuery(data),
  ) as Promise<CalculateDataCandidatesResult>;
}

export function calculatedResult(
  result: CalculateDataCandidatesResult,
  data?: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  schemaStores?: JsonSchemaStoreService,
): ResolveCandidateDependenciesResult {
  if (result.status !== 'blocked') {
    return { status: 'blocked', blockers: [] };
  }
  if (!data || !schemaStores) {
    return result;
  }
  let originalReferences: OriginalReferenceLookup | undefined;
  let lookupAttempted = false;
  return {
    status: 'blocked',
    blockers: result.blockers.map((blocker) => {
      if (blocker.code !== 'EXCLUDED_PREREQUISITE') {
        return blocker;
      }
      if (!lookupAttempted) {
        lookupAttempted = true;
        try {
          originalReferences = createOriginalReferenceLookup(
            data.snapshot,
            schemaStores,
          );
        } catch {
          return blocker;
        }
      }
      if (!originalReferences) {
        return blocker;
      }
      const referenceLookup = originalReferences;
      const role =
        blocker.role ?? (data.operation === 'commit' ? 'head' : 'draft');
      const reference = referenceLookup
        .references(role)
        .find(
          (candidate) =>
            candidate.tableCreatedId === blocker.tableCreatedId &&
            candidate.path === blocker.path &&
            hasSelectedRenameCause(data, candidate, referenceLookup),
        );
      if (!reference) {
        return blocker;
      }
      return {
        code: 'EXCLUDED_REFERENCE_REWRITE' as const,
        message: 'A generated foreign-key rewrite is excluded.',
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
    }),
  };
}

function hasSelectedRenameCause(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  reference: ReturnType<typeof readCandidateReferences>[number],
  originalReferences: OriginalReferenceLookup,
): boolean {
  const schemaRole = referenceSchemaOriginRole(
    data.snapshot,
    data.operation,
    reference.role,
    reference,
    data.selection,
  );
  const originalSchemaReference = originalReferences.find(
    schemaRole,
    reference,
  );
  const tableBinding = originalTargetBinding(
    data.snapshot,
    schemaRole,
    originalSchemaReference ?? reference,
  );
  if (!tableBinding) {
    return false;
  }
  if (reference.kind === 'schema') {
    return data.selection.selected.some(
      (entry) =>
        entry.kind === 'table' &&
        entry.classification === 'renamed' &&
        entry.target.kind === 'table' &&
        entry.target.tableCreatedId === tableBinding.tableCreatedId,
    );
  }
  return data.selection.selected.some(
    (entry) =>
      entry.kind === 'row' &&
      entry.classification === 'renamed' &&
      entry.target.kind === 'row' &&
      entry.target.tableCreatedId === tableBinding.tableCreatedId &&
      entry.target.rowCreatedId === reference.targetRowId,
  );
}
