import type { QueryBus } from '@nestjs/cqrs';
import type { CalculateDataCandidatesQueryData } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type {
  RequiredCandidateEffect,
  ResolveCandidateDependenciesResult,
  CandidateDependencyBlocker,
} from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import type { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { advanceCandidate } from './dependency-pass';
import { calculate, calculatedResult } from './candidate-calculation';
import { missingReferenceBlockers } from './reference-validation';
import { mergeRequiredEffects } from './dependency-effects';
import { validateCallerRetargets, schemaEffectKey } from './retarget-intents';

export async function resolveDependencyClosure(
  queryBus: QueryBus,
  schemaStores: JsonSchemaStoreService,
  input: CalculateDataCandidatesQueryData,
): Promise<ResolveCandidateDependenciesResult> {
  if (input.mode === 'restoreHead') {
    return resolveRestoredHead(queryBus, schemaStores, input);
  }
  return resolveSelectedCandidate(queryBus, schemaStores, input);
}

async function resolveRestoredHead(
  queryBus: QueryBus,
  schemaStores: JsonSchemaStoreService,
  input: Extract<CalculateDataCandidatesQueryData, { mode: 'restoreHead' }>,
): Promise<ResolveCandidateDependenciesResult> {
  const calculated = await calculate(queryBus, input);
  if (calculated.status !== 'calculated') {
    return calculatedResult(calculated);
  }
  const blockers = missingReferenceBlockers(
    { head: calculated.head, draft: calculated.draft },
    schemaStores,
  );
  if (blockers.length > 0) {
    return { status: 'blocked', blockers };
  }
  return {
    status: 'resolved',
    head: calculated.head,
    draft: calculated.draft,
    migrationLedger: calculated.migrationLedger,
    required: [],
    automatic: [],
    effectiveRefs: [],
  };
}

async function resolveSelectedCandidate(
  queryBus: QueryBus,
  schemaStores: JsonSchemaStoreService,
  input: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
): Promise<ResolveCandidateDependenciesResult> {
  const invalidRetarget = validateCallerRetargets(input);
  if (invalidRetarget) {
    return { status: 'blocked', blockers: [invalidRetarget] };
  }
  let data = structuredClone(input);
  const required: RequiredCandidateEffect[] = [];
  const causeByRef = new Map(
    data.selection.selected.map(({ ref }) => [ref.value, ref]),
  );
  const seen = new Set<string>();
  while (true) {
    if (!rememberCalculation(data, seen)) {
      return blockedLoop(input);
    }
    const progress = await advanceCandidate({
      queryBus,
      schemaStores,
      data,
      causeByRef,
    });
    if (progress.kind === 'blocked') {
      return { status: 'blocked', blockers: progress.blockers };
    }
    if (progress.kind === 'done') {
      return {
        ...progress.result,
        required: mergeRequiredEffects(required),
      };
    }
    if (!progress.changed) {
      return blockedLoop(input);
    }
    data = progress.data;
    required.push(...progress.required);
  }
}

function rememberCalculation(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  seen: Set<string>,
): boolean {
  const key = calculationKey(data);
  if (seen.has(key)) {
    return false;
  }
  seen.add(key);
  return true;
}

function blockedLoop(
  data: CalculateDataCandidatesQueryData,
): ResolveCandidateDependenciesResult {
  const blocker: CandidateDependencyBlocker = {
    code: 'UNREPRESENTABLE_REFERENCE',
    message: 'Dependency calculation reached no new exact effects.',
    role: 'head',
    tableCreatedId:
      data.mode === 'selected'
        ? (data.selection.selected[0]?.target.tableCreatedId ?? '')
        : '',
  };
  return { status: 'blocked', blockers: [blocker] };
}

function calculationKey(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
): string {
  return JSON.stringify({
    refs: data.selection.selected.map(({ ref }) => ref.value).sort(),
    schema: (data.additionalSchemaEffects ?? []).map(schemaEffectKey).sort(),
  });
}
