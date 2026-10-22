import type {
  ListedUnit,
  PreviewChangesResult,
  PublicUnit,
  Selection,
  SelectionItems,
} from 'src/features/partial-changes-poc/partial-changes.types';
import type { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';

const SELECTION_ITEMS = [
  'tables',
  'tableData',
  'views',
  'sharedSchemas',
  'rows',
  'fields',
] as const;

const PUBLIC_UNIT_KEYS = [
  'kind',
  'tableId',
  'previousTableId',
  'rowId',
  'previousRowId',
  'path',
] as const;

export function publicPartOf(unit: ListedUnit): PublicUnit {
  return Object.fromEntries(
    PUBLIC_UNIT_KEYS.filter((key) => unit[key] !== undefined).map((key) => [
      key,
      unit[key],
    ]),
  ) as unknown as PublicUnit;
}

export async function expectSelectsExactly(
  scenario: ChangesScenario,
  unit: ListedUnit,
): Promise<PreviewChangesResult> {
  expect({
    unit: publicPartOf(unit),
    hasSelector: Boolean(unit.selector),
  }).toEqual({
    unit: publicPartOf(unit),
    hasSelector: true,
  });
  const preview = await scenario.preview('commit', unit.selector ?? {});

  expect({
    unit: publicPartOf(unit),
    unmatched: preview.unmatched,
    selected: preview.counts.selected,
    refusals: preview.blockers
      .map((blocker) => blocker.code)
      .filter(
        (code) => code === 'notSelectable' || code === 'unmatchedSelector',
      ),
    listedInSample: preview.sample.some(
      (sampled) =>
        JSON.stringify(sampled) === JSON.stringify(publicPartOf(unit)),
    ),
  }).toEqual({
    unit: publicPartOf(unit),
    unmatched: {},
    selected: 1,
    refusals: [],
    listedInSample: true,
  });
  return preview;
}

export function unionOfSelectors(units: readonly ListedUnit[]): Selection {
  const union: SelectionItems = {};
  for (const unit of units) {
    for (const item of SELECTION_ITEMS) {
      const values = unit.selector?.[item] as unknown[] | undefined;
      if (values) {
        union[item] = [
          ...((union[item] as unknown[]) ?? []),
          ...values,
        ] as never;
      }
    }
  }
  return union;
}
