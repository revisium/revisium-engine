import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { Fingerprint } from 'src/features/partial-changes/plan/fingerprint';
import {
  type ApplyTerms,
  changesSincePreview,
  type DecidedPlan,
  decidePlanStatus,
  type PlanStatus,
  PREVIEW_STATUSES,
  type PreviewTerms,
} from 'src/features/partial-changes/planning/plan-decision';
import type { PlanBlocker } from 'src/features/partial-changes/planning/plan-refs';
import type { UnmatchedSelectors } from 'src/features/partial-changes/selection/selection-resolution';
import type { RequiredUnit } from 'src/features/partial-changes/selection/unit-refs';

const FINGERPRINT: Fingerprint = {
  operation: 'commit',
  headRevisionId: 'rev-h1',
  draftRevisionId: 'rev-d1',
  units: 'units-of-the-plan',
  content: 'content-of-the-plan',
};
const OTHER_FINGERPRINT: Fingerprint = {
  ...FINGERPRINT,
  content: 'content-of-an-earlier-preview',
};

const PREVIEW: PreviewTerms = { includeRequired: false };
const PREVIEW_ACCEPTING_REQUIRED: PreviewTerms = { includeRequired: true };
const STALE_EXPECTATION: ApplyTerms = {
  includeRequired: true,
  expected: OTHER_FINGERPRINT,
};
const FRESH_EXPECTATION: ApplyTerms = {
  includeRequired: false,
  expected: FINGERPRINT,
};

interface PlanState {
  readonly stoppedByLimit?: boolean;
  readonly applied?: boolean;
  readonly required?: boolean;
  readonly blocked?: boolean;
  readonly unmatched?: boolean;
}

interface DecisionCase {
  readonly when: string;
  readonly plan: PlanState;
  readonly terms: ApplyTerms;
  readonly decides: PlanStatus;
}

describe('decidePlanStatus: the status decision of SPEC §5.6 in its order', () => {
  const decisions: DecisionCase[] = [
    {
      when: 'a limit stopped the plan, before every other step, whatever expected is',
      plan: { stoppedByLimit: true },
      terms: STALE_EXPECTATION,
      decides: 'blocked',
    },
    {
      when: 'a limit stopped the plan of a preview',
      plan: { stoppedByLimit: true },
      terms: PREVIEW,
      decides: 'blocked',
    },
    {
      when: 'no unit is applied and nothing blocks, before freshness, also with unmatched selectors',
      plan: { unmatched: true },
      terms: STALE_EXPECTATION,
      decides: 'empty',
    },
    {
      when: 'expected differs from the fingerprint, before blockers and required additions',
      plan: { applied: true, blocked: true, unmatched: true, required: true },
      terms: STALE_EXPECTATION,
      decides: 'stale',
    },
    {
      when: 'expected is of other fingerprint rules',
      plan: { applied: true },
      terms: { includeRequired: false, expected: 'otherRules' },
      decides: 'stale',
    },
    {
      when: 'a blocker remains although no unit is applied',
      plan: { blocked: true },
      terms: PREVIEW,
      decides: 'blocked',
    },
    {
      when: 'a blocker remains, before required additions, also when they are accepted',
      plan: { applied: true, blocked: true, required: true },
      terms: PREVIEW_ACCEPTING_REQUIRED,
      decides: 'blocked',
    },
    {
      when: 'a selector is unmatched, before required additions',
      plan: { applied: true, unmatched: true, required: true },
      terms: PREVIEW,
      decides: 'blocked',
    },
    {
      when: 'required additions are not accepted',
      plan: { applied: true, required: true },
      terms: PREVIEW,
      decides: 'required',
    },
    {
      when: 'required additions are accepted',
      plan: { applied: true, required: true },
      terms: PREVIEW_ACCEPTING_REQUIRED,
      decides: 'ready',
    },
    {
      when: 'expected equals the fingerprint',
      plan: { applied: true },
      terms: FRESH_EXPECTATION,
      decides: 'ready',
    },
    {
      when: 'the selection applies as is',
      plan: { applied: true },
      terms: PREVIEW,
      decides: 'ready',
    },
  ];

  it.each(decisions)(
    'decides $decides when $when',
    ({ plan, terms, decides }) => {
      expect(decidePlanStatus(decidedPlanOf(plan), terms)).toBe(decides);
    },
  );

  it('says what changed since the preview, and nothing without expected', () => {
    const plan = { fingerprint: FINGERPRINT };

    expect(changesSincePreview(plan, STALE_EXPECTATION)).toEqual(['content']);
    expect(changesSincePreview(plan, FRESH_EXPECTATION)).toEqual([]);
    expect(changesSincePreview(plan, PREVIEW)).toEqual([]);
  });

  it('covers every value of PREVIEW_STATUSES, and stale', () => {
    const statuses = decisions.map(({ decides }) => decides);

    expect(new Set(statuses)).toEqual(
      new Set<PlanStatus>([...PREVIEW_STATUSES, 'stale']),
    );
  });
});

const APPLIED_UNIT: CatalogueUnit = {
  key: 'applied-unit',
  tableIdentities: ['products-identity'],
  rowIdentities: ['p1-identity'],
  systemRows: [],
  unit: { kind: 'field', tableId: 'products', rowId: 'p1', path: '/price' },
};

const REQUIRED_UNIT: RequiredUnit = {
  unit: {
    kind: 'rowCreate',
    tableId: 'categories',
    rowId: 'c9',
    selector: { rows: [{ tableId: 'categories', rowId: 'c9' }] },
  },
  reason: {
    code: 'referencedRowMissing',
    because: 'products/p1/category references categories/c9',
    site: { kind: 'row', tableId: 'products', rowId: 'p1', path: '/category' },
    references: { kind: 'row', tableId: 'categories', rowId: 'c9' },
  },
};

const BLOCKER: PlanBlocker = {
  code: 'notSelectable',
  tableId: 'products',
  rowId: 'p1',
  path: '/total',
  message: 'products/p1/total is computed',
};

function decidedPlanOf(state: PlanState): DecidedPlan {
  if (state.stoppedByLimit) {
    return { planned: false };
  }

  return {
    planned: true,
    fingerprint: FINGERPRINT,
    appliedUnits: itemsWhen(state.applied, APPLIED_UNIT),
    required: itemsWhen(state.required, REQUIRED_UNIT),
    blockers: itemsWhen(state.blocked, BLOCKER),
    unmatched: unmatchedOf(state),
  };
}

function unmatchedOf({ unmatched }: PlanState): UnmatchedSelectors {
  if (!unmatched) {
    return {};
  }

  return { rows: [{ tableId: 'products', rowId: 'missing' }] };
}

function itemsWhen<T>(condition: boolean | undefined, item: T): T[] {
  if (!condition) {
    return [];
  }

  return [item];
}
