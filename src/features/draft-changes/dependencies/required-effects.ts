import type {
  CandidateRequirement,
  CalculateDataCandidatesQueryData,
} from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type {
  CandidateDependencyBlocker,
  RequiredCandidateEffect,
} from 'src/features/draft-changes/queries/impl/resolve-candidate-dependencies.query';
import { isCatalogueEntryDenied } from './exclusions';

export interface RequiredEffectExpansion {
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>;
  required: RequiredCandidateEffect[];
  changed: boolean;
  blocker?: CandidateDependencyBlocker;
}

export function expandRequiredEffects(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  requirements: CandidateRequirement[],
): RequiredEffectExpansion {
  const next = structuredClone(data);
  const required: RequiredCandidateEffect[] = [];
  for (const requirement of requirements) {
    const expansion = expandRequirement(next, requirement);
    if (expansion.blocker) {
      return {
        data: next,
        required,
        changed: false,
        blocker: expansion.blocker,
      };
    }
    if (expansion.required) {
      required.push(expansion.required);
    }
  }
  return {
    data: next,
    required: uniqueRequirements(required),
    changed: !sameSelection(data, next),
  };
}

function expandRequirement(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  requirement: CandidateRequirement,
): {
  required?: RequiredCandidateEffect;
  blocker?: CandidateDependencyBlocker;
} {
  if (requirement.kind === 'schemaEffects') {
    return addSchemaEffects(data, requirement);
  }
  if (requirement.kind === 'catalogueEffects') {
    return addCatalogueEffects(data, requirement);
  }
  return addDiscardedFields(data, requirement);
}

function addCatalogueEffects(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  requirement: Extract<CandidateRequirement, { kind: 'catalogueEffects' }>,
): {
  required?: RequiredCandidateEffect;
  blocker?: CandidateDependencyBlocker;
} {
  const entries = resolveEntries(data, requirement.refs);
  if (!entries) {
    return { blocker: missingEffectBlocker(requirement) };
  }
  const missing = entries.filter((entry) => !isSelected(data, entry));
  const denied = missing.find((entry) => isCatalogueEntryDenied(data, entry));
  if (denied) {
    return { blocker: deniedBlocker(data, requirement, denied) };
  }
  data.selection.selected.push(...missing);
  return missing.length > 0
    ? {
        required: {
          ...requirement,
          refs: missing.map(({ ref }) => ref),
        },
      }
    : {};
}

function addSchemaEffects(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  requirement: Extract<CandidateRequirement, { kind: 'schemaEffects' }>,
): {
  required?: RequiredCandidateEffect;
  blocker?: CandidateDependencyBlocker;
} {
  const existing = data.additionalSchemaEffects?.flatMap((effect) =>
    effect.kind === 'history' &&
    effect.tableCreatedId === requirement.tableCreatedId
      ? effect.effects
      : [],
  );
  const present = new Set(
    (existing ?? []).map(({ historyIndex, patchIndex }) =>
      effectKey(historyIndex, patchIndex),
    ),
  );
  const missing = requirement.effects.filter(
    ({ historyIndex, patchIndex }) =>
      !present.has(effectKey(historyIndex, patchIndex)),
  );
  if (missing.length === 0) {
    return {};
  }
  const denied = missing.some((effect) =>
    isSchemaEffectDenied(data, requirement.tableCreatedId, effect),
  );
  if (denied) {
    return {
      blocker: {
        code: 'EXCLUDED_REFERENCE_REWRITE',
        message: 'A required schema effect is excluded.',
        role: requirement.role,
        tableCreatedId: requirement.tableCreatedId,
      },
    };
  }
  const causeRef = requirement.causeRef;
  const prior = data.additionalSchemaEffects ?? [];
  data.additionalSchemaEffects = [
    ...prior,
    {
      kind: 'history',
      tableCreatedId: requirement.tableCreatedId,
      effects: missing,
      causeRef,
    },
  ];
  return {
    required: {
      ...requirement,
      effects: missing,
    },
  };
}

function addDiscardedFields(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  requirement: Extract<CandidateRequirement, { kind: 'discardDataFields' }>,
): {
  required?: RequiredCandidateEffect;
  blocker?: CandidateDependencyBlocker;
} {
  const refs = requirement.fields.flatMap((field) => {
    const entry = data.catalogue.entries.find(
      (candidate) =>
        candidate.kind === 'rowField' &&
        candidate.target.kind === 'rowField' &&
        candidate.target.tableCreatedId === requirement.tableCreatedId &&
        candidate.target.rowCreatedId === field.rowCreatedId &&
        candidate.path === field.path,
    );
    return entry && !isSelected(data, entry) ? [entry.ref] : [];
  });
  if (refs.length === 0) {
    return {
      blocker: {
        code: 'UNREPRESENTABLE_REFERENCE',
        message:
          'Required discarded row data has no selectable catalogue effect.',
        role: requirement.role,
        tableCreatedId: requirement.tableCreatedId,
        rowCreatedId: requirement.fields[0]?.rowCreatedId,
        path: requirement.fields[0]?.path,
      },
    };
  }
  return addCatalogueEffects(data, {
    kind: 'catalogueEffects',
    role: requirement.role,
    causeRef: requirement.causeRef,
    refs,
  });
}

function resolveEntries(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  refs: Array<{ value: string }>,
): DraftChangesCatalogueEntry[] | undefined {
  const entries = refs.map((ref) =>
    data.catalogue.entries.find((entry) => entry.ref.value === ref.value),
  );
  return entries.every(Boolean)
    ? (entries as DraftChangesCatalogueEntry[])
    : undefined;
}

function isSelected(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  entry: DraftChangesCatalogueEntry,
): boolean {
  return data.selection.selected.some(
    ({ ref }) => ref.value === entry.ref.value,
  );
}

function isSchemaEffectDenied(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  tableCreatedId: string,
  effect: { historyIndex: number; patchIndex: number },
): boolean {
  const entries = data.catalogue.entries.filter(
    (entry) =>
      entry.kind === 'schemaField' &&
      entry.target.kind === 'schemaField' &&
      entry.target.tableCreatedId === tableCreatedId &&
      entry.effectRefs?.some(
        (candidate) =>
          candidate.historyIndex === effect.historyIndex &&
          candidate.patchIndex === effect.patchIndex,
      ),
  );
  return entries.some((entry) => isCatalogueEntryDenied(data, entry));
}

function missingEffectBlocker(
  requirement: CandidateRequirement,
): CandidateDependencyBlocker {
  return {
    code: 'UNREPRESENTABLE_REFERENCE',
    message: 'A required effect is not present in the supplied catalogue.',
    role: requirement.role,
    tableCreatedId:
      'tableCreatedId' in requirement ? requirement.tableCreatedId : '',
  };
}

function deniedBlocker(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  requirement: CandidateRequirement,
  entry: DraftChangesCatalogueEntry,
): CandidateDependencyBlocker {
  const cause = data.selection.selected.find(
    ({ ref }) => ref.value === requirement.causeRef.value,
  );
  const generatedRewrite = Boolean(
    cause &&
    ((cause.kind === 'table' && cause.classification === 'renamed') ||
      (cause.kind === 'row' && cause.classification === 'renamed')),
  );
  return {
    code: generatedRewrite
      ? 'EXCLUDED_REFERENCE_REWRITE'
      : 'EXCLUDED_PREREQUISITE',
    message: generatedRewrite
      ? 'A generated foreign-key rewrite is excluded.'
      : 'A required existing change is excluded.',
    role: requirement.role,
    tableCreatedId: entry.target.tableCreatedId,
    ...(entry.target.kind === 'row' || entry.target.kind === 'rowField'
      ? { rowCreatedId: entry.target.rowCreatedId }
      : {}),
    ...(entry.path === undefined ? {} : { path: entry.path }),
  };
}

function effectKey(historyIndex: number, patchIndex: number): string {
  return `${historyIndex}:${patchIndex}`;
}

function sameSelection(
  original: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  next: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
): boolean {
  const beforeRefs = original.selection.selected
    .map(({ ref }) => ref.value)
    .sort();
  const afterRefs = next.selection.selected.map(({ ref }) => ref.value).sort();
  return (
    JSON.stringify(beforeRefs) === JSON.stringify(afterRefs) &&
    JSON.stringify(original.additionalSchemaEffects ?? []) ===
      JSON.stringify(next.additionalSchemaEffects ?? [])
  );
}

function uniqueRequirements(
  requirements: RequiredCandidateEffect[],
): RequiredCandidateEffect[] {
  const seen = new Set<string>();
  return requirements.filter((requirement) => {
    const key = JSON.stringify(requirement);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
