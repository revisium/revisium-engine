import { obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type {
  PlanRowCounts,
  RowKindCounts,
} from 'src/features/partial-changes/planning/plan-coverage';
import type { PreviewChangesResult } from 'src/features/partial-changes/queries/impl/preview-draft-changes.query';
import type {
  RowRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';

const CATEGORIES = 'categories';
const PRODUCTS = 'products';
const OPERATIONS: ChangeOperation[] = ['commit', 'revert'];

const categorySchema = obj({ title: str() });
const productSchema = obj({
  title: str(),
  category: str({ foreignKey: CATEGORIES }),
});

const rowOf = (tableId: string, rowId: string): RowRef => ({ tableId, rowId });

const NO_ROWS: RowKindCounts = {
  total: 0,
  added: 0,
  modified: 0,
  removed: 0,
  renamed: 0,
  replaced: 0,
  partlyApplied: 0,
};

const rowsOf = (counts: Partial<RowKindCounts>): RowKindCounts => ({
  ...NO_ROWS,
  ...counts,
});

interface MixedChangesCase {
  readonly selection: Selection;
  readonly categories: PlanRowCounts;
  readonly products: PlanRowCounts;
}

// The Draft creates c9, edits two fields of p1 to reference c9, renames p2 to p2x and edits it, deletes p3 and replaces
// p4. A commit of one field of p1 requires c9; a revert of c9 requires that field back.
const MIXED_CHANGES: Record<ChangeOperation, MixedChangesCase> = {
  commit: {
    selection: {
      fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/category' }],
      rows: [
        rowOf(PRODUCTS, 'p2x'),
        rowOf(PRODUCTS, 'p3'),
        rowOf(PRODUCTS, 'p4'),
      ],
    },
    categories: { selected: NO_ROWS, required: rowsOf({ total: 1, added: 1 }) },
    products: {
      selected: rowsOf({
        total: 4,
        modified: 2,
        removed: 1,
        renamed: 1,
        replaced: 1,
        partlyApplied: 1,
      }),
      required: NO_ROWS,
    },
  },
  revert: {
    selection: {
      rows: [
        rowOf(CATEGORIES, 'c9'),
        rowOf(PRODUCTS, 'p2x'),
        rowOf(PRODUCTS, 'p3'),
        rowOf(PRODUCTS, 'p4'),
      ],
    },
    categories: { selected: rowsOf({ total: 1, added: 1 }), required: NO_ROWS },
    products: {
      selected: rowsOf({
        total: 3,
        modified: 1,
        removed: 1,
        renamed: 1,
        replaced: 1,
      }),
      required: rowsOf({ total: 1, modified: 1, partlyApplied: 1 }),
    },
  },
};

describe('the rows a plan applies, by kind (SPEC §5.1, AS-101)', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each(OPERATIONS)(
    'a %s preview counts each row once by the kind of its applied changes, selected apart from required, per table and in total',
    async (operation) => {
      const draft = await givenMixedProductChanges();
      const { selection, categories, products } = MIXED_CHANGES[operation];

      const preview = await draft.previewChanges({ operation, selection });

      expect(preview).toMatchObject({
        status: 'required',
        counts: { selected: 5, required: 1 },
        rowCounts: {
          selected: sumOf(categories.selected, products.selected),
          required: sumOf(categories.required, products.required),
        },
      });
      expect(preview.coverage).toEqual([
        {
          tableId: CATEGORIES,
          rows: 1,
          appliedRows: 1,
          partlyAppliedRows: 0,
          rowCounts: categories,
        },
        {
          tableId: PRODUCTS,
          rows: 4,
          appliedRows: 3,
          partlyAppliedRows: 1,
          rowCounts: products,
        },
      ]);
    },
  );

  it.each(OPERATIONS)(
    'an applied %s returns the row counts and the coverage its preview showed',
    async (operation) => {
      const draft = await givenMixedProductChanges();
      const { selection } = MIXED_CHANGES[operation];
      const preview = planned(
        await draft.previewChanges({
          operation,
          selection,
          includeRequired: true,
        }),
      );
      const options = {
        selection,
        includeRequired: true,
        expected: preview.fingerprint,
      };

      const result =
        operation === 'commit'
          ? await draft.commitChanges(options)
          : await draft.revertChanges(options);

      expect(result).toMatchObject({
        status: 'applied',
        applied: preview.counts,
        rowCounts: preview.rowCounts,
        coverage: preview.coverage,
      });
    },
  );

  it('counts no row whose only applied change is its schemaHash, and does not count that change against a whole row', async () => {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: {
        schema: categorySchema,
        rows: {
          c1: { title: 'one' },
          c2: { title: 'two' },
          c3: { title: 'three' },
        },
      },
    });
    await draft.writeRowColumns(CATEGORIES, 'c1', { schemaHash: 'other' });
    await draft.updateRow(CATEGORIES, 'c2', { title: 'dos' });
    await draft.writeRowColumns(CATEGORIES, 'c2', { schemaHash: 'other' });
    await draft.writeRowColumns(CATEGORIES, 'c3', { meta: { note: 'x' } });

    const byTableData = await draft.previewChanges({
      operation: 'commit',
      selection: { tableData: [CATEGORIES] },
    });
    const byField = await draft.previewChanges({
      operation: 'commit',
      selection: {
        fields: [{ tableId: CATEGORIES, rowId: 'c2', path: '/title' }],
      },
    });

    expect(byTableData.coverage).toEqual([
      {
        tableId: CATEGORIES,
        rows: 3,
        appliedRows: 3,
        partlyAppliedRows: 0,
        rowCounts: {
          selected: rowsOf({ total: 2, modified: 2 }),
          required: NO_ROWS,
        },
      },
    ]);
    expect(byField.rowCounts).toEqual<PlanRowCounts>({
      selected: rowsOf({ total: 1, modified: 1 }),
      required: NO_ROWS,
    });
  });

  it('counts a row as selected when its only selected unit is its hidden schemaHash change and the closure adds its value (AS-101)', async () => {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { title: 'one', category: 'c1' } },
      },
    });
    await draft.createRows(CATEGORIES, { c9: { title: 'nine' } });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'one', category: 'c9' });
    await draft.writeRowColumns(PRODUCTS, 'p1', { schemaHash: 'other' });

    const preview = await draft.previewChanges({
      operation: 'revert',
      selection: {
        rows: [rowOf(CATEGORIES, 'c9')],
        rowColumns: [rowOf(PRODUCTS, 'p1')],
      },
    });

    expect(preview).toMatchObject({
      status: 'required',
      counts: { selected: 2, required: 1 },
      rowCounts: {
        selected: rowsOf({ total: 2, added: 1, modified: 1 }),
        required: NO_ROWS,
      },
    });
  });

  it('counts the rows of neither a created table nor a structure, whose rows go with it', async () => {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
    });
    await draft.createTable(PRODUCTS, productSchema);
    await draft.createRows(PRODUCTS, {
      p1: { title: 'one', category: 'c1' },
    });

    const preview = await draft.previewChanges({
      operation: 'commit',
      selection: { structures: [{ tableId: PRODUCTS }] },
    });

    expect(preview).toMatchObject({
      status: 'ready',
      rowCounts: { selected: NO_ROWS, required: NO_ROWS },
      coverage: [
        {
          tableId: PRODUCTS,
          structure: true,
          rows: 0,
          rowCounts: { selected: NO_ROWS, required: NO_ROWS },
        },
      ],
    });
  });

  async function givenMixedProductChanges(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [PRODUCTS]: {
        schema: productSchema,
        rows: {
          p1: { title: 'one', category: 'c1' },
          p2: { title: 'two', category: 'c1' },
          p3: { title: 'three', category: 'c1' },
          p4: { title: 'four', category: 'c1' },
        },
      },
    });
    await draft.createRows(CATEGORIES, { c9: { title: 'nine' } });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', category: 'c9' });
    await draft.renameRow(PRODUCTS, 'p2', 'p2x');
    await draft.updateRow(PRODUCTS, 'p2x', { title: 'dos', category: 'c1' });
    await draft.removeRow(PRODUCTS, 'p3');
    await draft.removeRow(PRODUCTS, 'p4');
    await draft.createRows(PRODUCTS, {
      p4: { title: 'cuatro', category: 'c1' },
    });

    return draft;
  }
});

function sumOf(left: RowKindCounts, right: RowKindCounts): RowKindCounts {
  return {
    total: left.total + right.total,
    added: left.added + right.added,
    modified: left.modified + right.modified,
    removed: left.removed + right.removed,
    renamed: left.renamed + right.renamed,
    replaced: left.replaced + right.replaced,
    partlyApplied: left.partlyApplied + right.partlyApplied,
  };
}

function planned(
  preview: PreviewChangesResult,
): Extract<PreviewChangesResult, { planned: true }> {
  if (!preview.planned) {
    throw new Error('A limit stopped the preview');
  }

  return preview;
}
