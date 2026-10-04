import type {
  AdditionalCandidateSchemaEffect,
  CalculateDataCandidatesQueryData,
  CandidateBlocker,
} from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';

export function addSchemaEffects(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  effects: AdditionalCandidateSchemaEffect[],
): boolean {
  const present = new Set(
    (data.additionalSchemaEffects ?? []).map(schemaEffectKey),
  );
  const additions = effects.filter(
    (effect) => !present.has(schemaEffectKey(effect)),
  );
  if (additions.length === 0) {
    return false;
  }
  data.additionalSchemaEffects = [
    ...(data.additionalSchemaEffects ?? []),
    ...additions,
  ];
  return true;
}

export function schemaEffectKey(
  effect: AdditionalCandidateSchemaEffect,
): string {
  return effect.kind === 'history'
    ? JSON.stringify({
        kind: effect.kind,
        tableCreatedId: effect.tableCreatedId,
        effects: effect.effects,
      })
    : JSON.stringify({
        kind: effect.kind,
        tableCreatedId: effect.tableCreatedId,
        targetTableCreatedId: effect.targetTableCreatedId,
        fromTableId: effect.fromTableId,
        toTableId: effect.toTableId,
      });
}

export function validateCallerRetargets(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
): CandidateBlocker | undefined {
  for (const effect of data.additionalSchemaEffects ?? []) {
    if (effect.kind !== 'foreignKeyRetarget') {
      continue;
    }
    const cause = data.selection.selected.find(
      ({ ref }) => ref.value === effect.causeRef.value,
    );
    const headTarget = data.snapshot.head.tables.find(
      ({ createdId }) => createdId === effect.targetTableCreatedId,
    );
    const draftTarget = data.snapshot.draft.tables.find(
      ({ createdId }) => createdId === effect.targetTableCreatedId,
    );
    if (
      !cause ||
      cause.kind !== 'table' ||
      cause.classification !== 'renamed' ||
      cause.target.kind !== 'table' ||
      cause.target.tableCreatedId !== effect.targetTableCreatedId ||
      !headTarget ||
      !draftTarget ||
      headTarget.id !== effect.fromTableId ||
      draftTarget.id !== effect.toTableId ||
      !data.snapshot.head.tables.some(
        ({ createdId }) => createdId === effect.tableCreatedId,
      ) ||
      !data.snapshot.draft.tables.some(
        ({ createdId }) => createdId === effect.tableCreatedId,
      )
    ) {
      return {
        code: 'INVALID_SELECTION',
        message:
          'A supplied foreign-key retarget has no exact selected rename cause.',
      };
    }
  }
  return undefined;
}
