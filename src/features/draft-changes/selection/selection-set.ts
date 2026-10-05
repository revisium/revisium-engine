import type {
  DraftChangesCatalogue,
  DraftChangesCatalogueEntry,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type {
  DraftChangesChoice,
  DraftChangesDeniedTarget,
  DraftChangesSelectionBlocker,
  ResolveDraftChangesSelectionResult,
} from 'src/features/draft-changes/queries/impl/resolve-draft-changes-selection.query';
import { uniqueEntries } from 'src/features/draft-changes/catalogue/change-references';
import { resolveChoice } from './resolve-choice';

export function uniqueDeniedTargets(
  targets: DraftChangesDeniedTarget[],
): DraftChangesDeniedTarget[] {
  const byKey = new Map(
    targets.map((target) => [JSON.stringify(target), target]),
  );
  return [...byKey.entries()]
    .sort(([left], [right]) => compareDenied(left, right))
    .map(([, target]) => target);
}

const DENIED_KIND_ORDER: Record<string, number> = {
  table: 0,
  row: 1,
  rowField: 2,
  schemaField: 3,
  change: 4,
};
const UNKNOWN_KIND_ORDER = 6;

function compareDenied(left: string, right: string): number {
  const rank = (value: string) => {
    const kind = (JSON.parse(value) as { kind: string }).kind;
    return DENIED_KIND_ORDER[kind] ?? UNKNOWN_KIND_ORDER;
  };
  const rankDifference = rank(left) - rank(right);
  if (rankDifference !== 0) {
    return rankDifference;
  }
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export type ChoiceResolution =
  | {
      entries: DraftChangesCatalogueEntry[];
      deniedTargets: DraftChangesDeniedTarget[];
    }
  | { blocker: DraftChangesSelectionBlocker['code']; ref?: string };

export type ChoiceSetResult =
  | {
      entries: DraftChangesCatalogueEntry[];
      deniedTargets: DraftChangesDeniedTarget[];
    }
  | {
      blocked: Extract<
        ResolveDraftChangesSelectionResult,
        { status: 'blocked' }
      >;
    };

export function resolveChoices(
  catalogue: DraftChangesCatalogue,
  choices: DraftChangesChoice[],
  mode: 'include' | 'exclude',
): ChoiceSetResult {
  const entries: DraftChangesCatalogueEntry[] = [];
  const deniedTargets: DraftChangesDeniedTarget[] = [];
  for (const choice of choices) {
    const resolution = resolveChoice(catalogue, choice, mode);
    if ('blocker' in resolution) {
      return {
        blocked: selectionBlocked(resolution.blocker, choice, resolution.ref),
      };
    }
    const nonSelectable = resolution.entries.find(
      ({ selectable }) => !selectable,
    );
    if (nonSelectable) {
      return {
        blocked: selectionBlocked(
          'NON_SELECTABLE',
          choice,
          nonSelectable.ref.value,
        ),
      };
    }
    entries.push(...resolution.entries);
    deniedTargets.push(...resolution.deniedTargets);
  }
  return { entries, deniedTargets };
}

export function finalizeSelection(
  catalogue: DraftChangesCatalogue,
  included: DraftChangesCatalogueEntry[],
  excluded: DraftChangesCatalogueEntry[],
  deniedTargets: DraftChangesDeniedTarget[],
): ResolveDraftChangesSelectionResult {
  const excludedRefs = new Set(excluded.map(({ ref }) => ref.value));
  const selectedRefs = new Set(included.map(({ ref }) => ref.value));
  return structuredClone({
    status: 'resolved' as const,
    selected: uniqueEntries(
      catalogue.entries.filter(
        ({ ref }) =>
          selectedRefs.has(ref.value) && !excludedRefs.has(ref.value),
      ),
    ),
    excluded: uniqueEntries(
      catalogue.entries.filter(({ ref }) => excludedRefs.has(ref.value)),
    ),
    deniedTargets: uniqueDeniedTargets(deniedTargets),
  });
}

function selectionBlocked(
  code: DraftChangesSelectionBlocker['code'],
  choice: DraftChangesChoice,
  refValue?: string,
): Extract<ResolveDraftChangesSelectionResult, { status: 'blocked' }> {
  return {
    status: 'blocked',
    blockers: [
      {
        code,
        message: blockerMessage(code),
        choice,
        ...(refValue ? { ref: { value: refValue } } : {}),
      },
    ],
  };
}

function blockerMessage(code: DraftChangesSelectionBlocker['code']): string {
  switch (code) {
    case 'UNKNOWN_TARGET':
      return 'The selection names a target that is not present in the catalogue.';
    case 'AMBIGUOUS_IDENTITY':
      return 'The selection names a public ID shared by multiple stable identities.';
    case 'UNKNOWN_REFERENCE':
      return 'The change reference is unknown to this catalogue.';
    case 'NON_SELECTABLE':
      return 'The selected change is informational and cannot be selected.';
    case 'ATOMIC_DESCENDANT':
      return 'An array, file, or row lifecycle value must be selected as a whole.';
    case 'STALE_CATALOGUE':
      return 'The change reference belongs to a different catalogue scope.';
  }
}
