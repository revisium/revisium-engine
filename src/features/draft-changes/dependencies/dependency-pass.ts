import type { QueryBus } from '@nestjs/cqrs';
import type {
  CalculateDataCandidatesQueryData,
  CalculateDataCandidatesResult,
  CandidateRequirement,
  CandidateBlocker,
} from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type {
  RequiredCandidateEffect,
  ResolveCandidateDependenciesResult,
  CandidateDependencyBlocker,
} from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import type { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { calculate, calculatedResult } from './candidate-calculation';
import { planReferenceRenames } from './reference-renames';
import {
  requirementsForMissingReferences,
  missingReferenceBlockers,
} from './reference-validation';
import { addSchemaEffects } from './retarget-intents';
import {
  applyRequirements,
  schemaAutomaticEffects,
  uniqueAutomaticEffects,
} from './dependency-effects';

type CandidateProgress =
  | {
      kind: 'continue';
      data: SelectedCandidateData;
      required: RequiredCandidateEffect[];
      changed: boolean;
    }
  | {
      kind: 'blocked';
      blockers: Array<CandidateBlocker | CandidateDependencyBlocker>;
    }
  | {
      kind: 'done';
      result: Extract<
        ResolveCandidateDependenciesResult,
        { status: 'resolved' }
      >;
    };

type SelectedCandidateData = Extract<
  CalculateDataCandidatesQueryData,
  { mode: 'selected' }
>;

export async function advanceCandidate(input: {
  queryBus: QueryBus;
  schemaStores: JsonSchemaStoreService;
  data: SelectedCandidateData;
  causeByRef: Map<string, { value: string }>;
}): Promise<CandidateProgress> {
  const calculated = await calculate(input.queryBus, input.data);
  if (calculated.status === 'blocked') {
    const failed = calculatedResult(calculated, input.data, input.schemaStores);
    return failed.status === 'blocked'
      ? { kind: 'blocked', blockers: failed.blockers }
      : { kind: 'blocked', blockers: [] };
  }
  if (calculated.status === 'needsEffects') {
    return advanceRequiredEffects(
      input.data,
      calculated.requirements,
      input.causeByRef,
    );
  }
  return processCalculatedCandidate(
    input.data,
    calculated,
    input.schemaStores,
    input.causeByRef,
  );
}

function advanceRequiredEffects(
  data: SelectedCandidateData,
  requirements: CandidateRequirement[],
  causeByRef: Map<string, { value: string }>,
): CandidateProgress {
  const progress = applyRequirements(data, requirements, causeByRef);
  if (progress.blocker) {
    return { kind: 'blocked', blockers: [progress.blocker] };
  }
  return {
    kind: 'continue',
    data: progress.data,
    required: progress.required,
    changed: progress.changed,
  };
}

function processCalculatedCandidate(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  calculated: Extract<CalculateDataCandidatesResult, { status: 'calculated' }>,
  schemaStores: JsonSchemaStoreService,
  causeByRef: Map<string, { value: string }>,
): CandidateProgress {
  const candidate = { head: calculated.head, draft: calculated.draft };
  const renamePlan = planReferenceRenames(data, candidate, schemaStores);
  if (addSchemaEffects(data, renamePlan.schemaEffects)) {
    return { kind: 'continue', data, required: [], changed: true };
  }
  const missing = requirementsForMissingReferences(
    data,
    candidate,
    schemaStores,
  );
  if (missing.blockers.length > 0) {
    return { kind: 'blocked', blockers: missing.blockers };
  }
  if (missing.requirements.length > 0) {
    const expansion = applyRequirements(data, missing.requirements, causeByRef);
    if (expansion.blocker) {
      return { kind: 'blocked', blockers: [expansion.blocker] };
    }
    return {
      kind: 'continue',
      data: expansion.data,
      required: expansion.required,
      changed: expansion.changed,
    };
  }
  const blockers = missingReferenceBlockers(candidate, schemaStores, data);
  if (blockers.length > 0) {
    return { kind: 'blocked', blockers };
  }
  return {
    kind: 'done',
    result: {
      status: 'resolved',
      ...candidate,
      migrationLedger: calculated.migrationLedger,
      required: [],
      automatic: uniqueAutomaticEffects([
        ...schemaAutomaticEffects(data, calculated),
        ...renamePlan.appliedEffects,
        ...renamePlan.rowEffects,
      ]),
    },
  };
}
