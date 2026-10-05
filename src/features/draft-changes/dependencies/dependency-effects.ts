import type {
  CalculateDataCandidatesQueryData,
  CalculateDataCandidatesResult,
  CandidateRequirement,
} from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type {
  RequiredCandidateEffect,
  AutomaticForeignKeyEffect,
  CandidateDependencyBlocker,
} from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import { expandRequiredEffects } from './required-effects';

export function applyRequirements(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  requirements: CandidateRequirement[],
  causeByRef: Map<string, { value: string }>,
) {
  const rooted = requirements.map((requirement) => ({
    ...requirement,
    causeRef:
      causeByRef.get(requirement.causeRef.value) ?? requirement.causeRef,
  }));
  const expansion = expandRequiredEffects(data, rooted);
  if (!expansion.blocker) {
    rememberRequiredCauses(expansion.required, causeByRef);
  }
  return expansion;
}

function rememberRequiredCauses(
  requirements: RequiredCandidateEffect[],
  causeByRef: Map<string, { value: string }>,
): void {
  for (const requirement of requirements) {
    const cause =
      causeByRef.get(requirement.causeRef.value) ?? requirement.causeRef;
    for (const ref of requiredEffectRefs(requirement)) {
      causeByRef.set(ref.value, cause);
    }
  }
}

export function schemaAutomaticEffects(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  calculated: Extract<CalculateDataCandidatesResult, { status: 'calculated' }>,
) {
  return (calculated.schemaForeignKeyChanges ?? []).flatMap((change) => {
    const causes = (data.additionalSchemaEffects ?? []).flatMap((effect) =>
      effect.kind === 'foreignKeyRetarget' &&
      effect.tableCreatedId === change.tableCreatedId &&
      effect.targetTableCreatedId === change.targetTableCreatedId &&
      effect.fromTableId === change.before &&
      effect.toTableId === change.after
        ? [effect.causeRef]
        : [],
    );
    if (causes.length === 0) {
      return [];
    }
    return [
      {
        kind: 'schemaForeignKey' as const,
        role: change.role,
        tableCreatedId: change.tableCreatedId,
        targetTableCreatedId: change.targetTableCreatedId,
        path: change.path,
        before: change.before,
        after: change.after,
        causeRefs: causes,
      },
    ];
  });
}

function requiredEffectRefs(
  effect: RequiredCandidateEffect,
): Array<{ value: string }> {
  return effect.kind === 'catalogueEffects' ? effect.refs : [];
}

export function mergeRequiredEffects(
  effects: RequiredCandidateEffect[],
): RequiredCandidateEffect[] {
  const merged = new Map<string, RequiredCandidateEffect>();
  for (const effect of effects) {
    const tableCreatedId =
      effect.kind === 'schemaEffects' ? effect.tableCreatedId : null;
    const key = JSON.stringify([
      effect.role,
      effect.kind,
      tableCreatedId,
      effect.causeRef.value,
    ]);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, structuredClone(effect));
      continue;
    }
    if (
      existing.kind === 'catalogueEffects' &&
      effect.kind === 'catalogueEffects'
    ) {
      const refs = new Map(
        [...existing.refs, ...effect.refs].map((ref) => [ref.value, ref]),
      );
      existing.refs = [...refs.values()];
    } else if (
      existing.kind === 'schemaEffects' &&
      effect.kind === 'schemaEffects'
    ) {
      const refs = new Map(
        [...existing.effects, ...effect.effects].map((ref) => [
          `${ref.historyIndex}:${ref.patchIndex}`,
          ref,
        ]),
      );
      existing.effects = [...refs.values()];
    }
  }
  return [...merged.values()];
}

export function uniqueAutomaticEffects(effects: AutomaticForeignKeyEffect[]) {
  const unique = new Map<string, AutomaticForeignKeyEffect>();
  for (const effect of effects) {
    unique.set(JSON.stringify(effect), effect);
  }
  return [...unique.values()];
}

export function uniqueRequirements(
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

export function uniqueBlockers(
  blockers: CandidateDependencyBlocker[],
): CandidateDependencyBlocker[] {
  const byKey = new Map(
    blockers.map((blocker) => [JSON.stringify(blocker), blocker]),
  );
  return [...byKey.values()];
}
