import { obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { PlanBlocker } from 'src/features/partial-changes/planning/plan-refs';
import type {
  FieldRef,
  RowRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import type { RequiredUnit } from 'src/features/partial-changes/selection/unit-refs';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';

// Two listed entries of each list, so three required units and four blockers exceed it.
const MAX_LISTED_DETAILS = 2;

const CATEGORIES = 'categories';
const PRODUCTS = 'products';
const PRODUCT_IDS = ['p1', 'p2', 'p3'];
const CREATED_CATEGORY_IDS = ['c7', 'c8', 'c9'];

const categorySchema = obj({ title: str() });
const productSchema = obj({
  title: str(),
  category: str({ foreignKey: CATEGORIES }),
});

const categoryOf = (rowId: string): FieldRef => ({
  tableId: PRODUCTS,
  rowId,
  path: '/category',
});
const rowOf = (tableId: string, rowId: string): RowRef => ({ tableId, rowId });

// Each product now references its own created category: committing the products requires the three creations,
// reverting the creations requires the three product fields.
const SELECTIONS: Record<ChangeOperation, Selection> = {
  commit: { fields: PRODUCT_IDS.map(categoryOf) },
  revert: {
    rows: CREATED_CATEGORY_IDS.map((rowId) => rowOf(CATEGORIES, rowId)),
  },
};
const OPERATIONS: ChangeOperation[] = ['commit', 'revert'];
const MISSING_ROW = rowOf(PRODUCTS, 'missing');

describe('plan details listed in the results', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit({
      settings: {
        PARTIAL_CHANGES_MAX_LISTED_DETAILS: String(MAX_LISTED_DETAILS),
      },
    });
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each(OPERATIONS)(
    'a %s preview lists the first required units up to the limit and counts all of them',
    async (operation) => {
      const draft = await givenProductsOfCreatedCategories();

      const preview = await draft.previewChanges({
        operation,
        selection: SELECTIONS[operation],
      });

      expect(preview).toMatchObject({
        status: 'required',
        counts: { selected: 3, required: 3 },
        requiredTotal: 3,
        blockers: [],
        blockersTotal: 0,
      });
      expect(rowsOf(preview.required)).toEqual(
        firstRequiredRows(operation).slice(0, MAX_LISTED_DETAILS),
      );
    },
  );

  it.each(OPERATIONS)(
    'a %s refused as required lists the first required units up to the limit and counts all of them',
    async (operation) => {
      const draft = await givenProductsOfCreatedCategories();

      const result = await applyChanges(draft, operation, {
        selection: SELECTIONS[operation],
      });

      expect(result).toEqual({
        status: 'required',
        required: expect.any(Array),
        requiredTotal: 3,
      });
      expect(rowsOf(listedRequiredOf(result))).toEqual(
        firstRequiredRows(operation).slice(0, MAX_LISTED_DETAILS),
      );
    },
  );

  it.each(OPERATIONS)(
    'a blocked %s preview lists blockers up to the limit, the first of each code before repeats, and counts all of them',
    async (operation) => {
      const draft = await givenProductsOfCreatedCategories();

      const preview = await draft.previewChanges({
        operation,
        selection: blockedSelectionOf(operation),
      });

      expect(preview).toMatchObject({
        status: 'blocked',
        blockersTotal: 4,
      });
      expect(codesOf(preview.blockers)).toEqual([
        'unmatchedSelector',
        'requiredExcluded',
      ]);
    },
  );

  it.each(OPERATIONS)(
    'a blocked %s lists blockers up to the limit, the first of each code before repeats, and counts all of them',
    async (operation) => {
      const draft = await givenProductsOfCreatedCategories();

      const result = await applyChanges(draft, operation, {
        selection: blockedSelectionOf(operation),
      });

      expect(result).toMatchObject({
        status: 'blocked',
        planned: true,
        blockersTotal: 4,
        requiredTotal: 0,
      });
      expect(codesOf(listedBlockersOf(result))).toEqual([
        'unmatchedSelector',
        'requiredExcluded',
      ]);
    },
  );

  it.each(OPERATIONS)(
    'a %s with includeRequired applies every required unit, beyond the ones its preview listed',
    async (operation) => {
      const draft = await givenProductsOfCreatedCategories();
      const selection = SELECTIONS[operation];
      const preview = await draft.previewChanges({ operation, selection });

      const result = await applyChanges(draft, operation, {
        selection,
        includeRequired: true,
        expected: preview.fingerprint,
      });

      expect(preview.required).toHaveLength(MAX_LISTED_DETAILS);
      expect(result).toMatchObject({
        status: 'applied',
        applied: { selected: 3, required: 3 },
      });
      expect(await draft.hasChanges()).toBe(false);
    },
  );

  async function givenProductsOfCreatedCategories(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [PRODUCTS]: {
        schema: productSchema,
        rows: Object.fromEntries(
          PRODUCT_IDS.map((rowId) => [rowId, { title: rowId, category: 'c1' }]),
        ),
      },
    });
    await draft.createRows(
      CATEGORIES,
      Object.fromEntries(
        CREATED_CATEGORY_IDS.map((rowId) => [rowId, { title: rowId }]),
      ),
    );

    for (const [index, rowId] of PRODUCT_IDS.entries()) {
      await draft.updateRow(PRODUCTS, rowId, {
        title: rowId,
        category: CREATED_CATEGORY_IDS[index],
      });
    }

    return draft;
  }
});

interface ApplyOptions {
  readonly selection: Selection;
  readonly includeRequired?: boolean;
  readonly expected?: string | null;
}

function applyChanges(
  draft: ChangesScenario,
  operation: ChangeOperation,
  options: ApplyOptions,
) {
  return operation === 'commit'
    ? draft.commitChanges(options)
    : draft.revertChanges(options);
}

// One unmatchedSelector blocker for the missing row, then a requiredExcluded blocker for each of the three required
// units the selection excludes.
function blockedSelectionOf(operation: ChangeOperation): Selection {
  const selection = SELECTIONS[operation];
  const excluded = SELECTIONS[operation === 'commit' ? 'revert' : 'commit'];

  return {
    ...selection,
    rows: [...(selection.rows ?? []), MISSING_ROW],
    exclude: excluded,
  };
}

function firstRequiredRows(operation: ChangeOperation): string[] {
  return operation === 'commit' ? CREATED_CATEGORY_IDS : PRODUCT_IDS;
}

function rowsOf(required: readonly RequiredUnit[]): (string | undefined)[] {
  return required.map(({ unit }) => ('rowId' in unit ? unit.rowId : undefined));
}

function codesOf(blockers: readonly PlanBlocker[]): string[] {
  return blockers.map(({ code }) => code);
}

function listedRequiredOf(result: object): readonly RequiredUnit[] {
  return 'required' in result ? (result.required as RequiredUnit[]) : [];
}

function listedBlockersOf(result: object): readonly PlanBlocker[] {
  return 'blockers' in result ? (result.blockers as PlanBlocker[]) : [];
}
