import type { DraftChangesChoice, DraftChangesSelection } from './contract';

export const all: DraftChangesSelection = { include: [{ kind: 'all' }] };

export function include(
  ...choices: DraftChangesChoice[]
): DraftChangesSelection {
  return { include: choices };
}

export function except(
  selection: DraftChangesSelection,
  ...choices: DraftChangesChoice[]
): DraftChangesSelection {
  return { ...selection, exclude: choices };
}
