import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import {
  type ApplyTerms,
  type DecidedPlan,
  decidePlanStatus,
  type PlanStatus,
  type PreviewTerms,
} from 'src/features/partial-changes/planning/plan-decision';
import type { Blocker } from 'src/features/partial-changes/planning/plan-refs';
import type { RequiredUnit } from 'src/features/partial-changes/selection/unit-refs';

const FINGERPRINT = 'fingerprint-of-the-plan';
const OTHER_FINGERPRINT = 'fingerprint-of-an-earlier-preview';
const REFUSED_FINGERPRINT = '';

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
  readonly refusedByLimit?: boolean;
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
  it.each<DecisionCase>([
    {
      when: 'a limit refused the plan, before every other step, whatever expected is',
      plan: { refusedByLimit: true, applied: true, required: true },
      terms: STALE_EXPECTATION,
      decides: 'blocked',
    },
    {
      when: 'a limit refused the plan before any unit was applied',
      plan: { refusedByLimit: true },
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
  ])('decides $decides when $when', ({ plan, terms, decides }) => {
    expect(decidePlanStatus(decidedPlanOf(plan), terms)).toBe(decides);
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
    tableId: 'products',
    rowId: 'p1',
    path: '/category',
    because: 'products/p1/category references categories/c9',
  },
};

const LIMIT_BLOCKER: Blocker = {
  code: 'tooLarge',
  message: 'The affected tables hold too many changed rows',
};

const BLOCKER: Blocker = {
  code: 'notSelectable',
  tableId: 'products',
  rowId: 'p1',
  path: '/total',
  message: 'products/p1/total is computed',
};

function decidedPlanOf(state: PlanState): DecidedPlan {
  return {
    refusedByLimit: state.refusedByLimit === true,
    fingerprint: fingerprintOf(state),
    appliedUnits: itemsWhen(state.applied, APPLIED_UNIT),
    required: itemsWhen(state.required, REQUIRED_UNIT),
    blockers: [
      ...itemsWhen(state.refusedByLimit, LIMIT_BLOCKER),
      ...itemsWhen(state.blocked, BLOCKER),
    ],
    unmatched: unmatchedOf(state),
  };
}

function fingerprintOf({ refusedByLimit }: PlanState): string {
  if (refusedByLimit) {
    return REFUSED_FINGERPRINT;
  }

  return FINGERPRINT;
}

function unmatchedOf({ unmatched }: PlanState): DecidedPlan['unmatched'] {
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
