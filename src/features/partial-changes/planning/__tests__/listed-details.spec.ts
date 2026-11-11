import {
  listedBlockersOf,
  listedRequiredOf,
} from 'src/features/partial-changes/planning/listed-details';
import type { PlanBlocker } from 'src/features/partial-changes/planning/plan-refs';
import type { RequiredUnit } from 'src/features/partial-changes/selection/unit-refs';

const requiredRow = (rowId: string): RequiredUnit => ({
  unit: {
    kind: 'rowCreate',
    tableId: 'categories',
    rowId,
    selector: { rows: [{ tableId: 'categories', rowId }] },
  },
  reason: {
    code: 'referencedRowMissing',
    because: `a committed product references ${rowId}`,
    site: { kind: 'selector', tableId: 'products', rowId: 'p1' },
  },
});

const excluded = (tableId: string): PlanBlocker => ({
  code: 'requiredExcluded',
  tableId,
  message: `${tableId} is excluded`,
});

const unmatched = (rowId: string): PlanBlocker => ({
  code: 'unmatchedSelector',
  tableId: 'products',
  rowId,
  message: `${rowId} matches nothing`,
});

const invalidView = (tableId: string): PlanBlocker => ({
  code: 'invalidViews',
  tableId,
  message: `${tableId} views are invalid`,
});

describe('listed plan details', () => {
  describe('required', () => {
    it('lists the first entries up to the limit in their order and counts all of them', () => {
      const required = ['c1', 'c2', 'c3'].map(requiredRow);

      expect(listedRequiredOf(required, 2)).toEqual({
        required: [requiredRow('c1'), requiredRow('c2')],
        requiredTotal: 3,
      });
    });

    it('lists every entry when there are no more than the limit', () => {
      const required = ['c1', 'c2'].map(requiredRow);

      expect(listedRequiredOf(required, 2)).toEqual({
        required,
        requiredTotal: 2,
      });
    });

    it('lists nothing and counts zero without required units', () => {
      expect(listedRequiredOf([], 2)).toEqual({
        required: [],
        requiredTotal: 0,
      });
    });
  });

  describe('blockers', () => {
    it('lists the first blockers up to the limit and counts all of them', () => {
      const blockers = ['a', 'b', 'c'].map(excluded);

      expect(listedBlockersOf(blockers, 2)).toEqual({
        blockers: [excluded('a'), excluded('b')],
        blockersTotal: 3,
      });
    });

    it('lists every blocker in its order when there are no more than the limit and each code appears once', () => {
      const blockers = [unmatched('p9'), excluded('brands')];

      expect(listedBlockersOf(blockers, 2)).toEqual({
        blockers,
        blockersTotal: 2,
      });
    });

    it('lists the first blocker of each code before the repeats of a code, keeping their order otherwise', () => {
      const blockers = [
        excluded('a'),
        excluded('b'),
        unmatched('p9'),
        excluded('c'),
        invalidView('v'),
        unmatched('p8'),
      ];

      expect(listedBlockersOf(blockers, 4)).toEqual({
        blockers: [
          excluded('a'),
          unmatched('p9'),
          invalidView('v'),
          excluded('b'),
        ],
        blockersTotal: 6,
      });
    });

    it('orders the blockers by the same rule when every one is listed', () => {
      const blockers = [excluded('a'), excluded('b'), unmatched('p9')];

      expect(listedBlockersOf(blockers, 10)).toEqual({
        blockers: [excluded('a'), unmatched('p9'), excluded('b')],
        blockersTotal: 3,
      });
    });
  });
});
