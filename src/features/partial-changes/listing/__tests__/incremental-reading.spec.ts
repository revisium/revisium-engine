import { obj, str, strFormula } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import {
  type ChangedRowsRead,
  type PageWithReads,
  unitsOfPages,
} from '../../__tests__/support/change-listing';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import type { ListedUnit } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';

const ALPHA = 'alpha';
const BETA = 'beta';
const GAMMA = 'gamma';
const LARGE = 'large';
const CATEGORIES = 'categories';
const PRODUCTS = 'products';
const ALPHA_ROWS = ['a1', 'a2', 'a3'];
const BETA_ROWS = ['b1', 'b2', 'b3'];
const GAMMA_ROWS = ['g1', 'g2', 'g3'];
const STALE_PRODUCTS = ['p1', 'p2', 'p3', 'p4'];
const CREATED_ROWS = 30;
const FULL_PAGE = 5_000;

const labelSchema = obj({ label: str() });
const letterSchema = obj({ a: str(), b: str(), c: str() });
const productSchema = obj({
  title: str(),
  category: str({ foreignKey: CATEGORIES }),
  categoryCopy: strFormula('category'),
});

describe('listChanges: incremental reading', () => {
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

  it('reads no later table and at most pageSize changed rows for a page that fills in the first table', async () => {
    const draft = await givenThreeEditedTables();

    const [first] = await draft.listEveryPageWithReads({ pageSize: 2 });

    expect(first?.reads).toEqual([
      { tableId: ALPHA, rowIds: ['a1', 'a2'], pairs: 2 },
    ]);
  });

  it('continues reading from the cursor table and row', async () => {
    const draft = await givenThreeEditedTables();

    const pages = await draft.listEveryPageWithReads({ pageSize: 2 });

    expect(pages.map(({ reads }) => reads)).toEqual([
      [{ tableId: ALPHA, rowIds: ['a1', 'a2'], pairs: 2 }],
      [
        { tableId: ALPHA, rowIds: ['a3'], pairs: 1 },
        { tableId: BETA, rowIds: ['b1'], pairs: 1 },
      ],
      [{ tableId: BETA, rowIds: ['b2', 'b3'], pairs: 2 }],
      [
        { tableId: BETA, rowIds: [], pairs: 0 },
        { tableId: GAMMA, rowIds: ['g1', 'g2'], pairs: 2 },
      ],
      [{ tableId: GAMMA, rowIds: ['g3'], pairs: 1 }],
    ]);
  });

  it('lists and reads only the table named by tableId', async () => {
    const draft = await givenThreeEditedTables();

    const pages = await draft.listEveryPageWithReads({
      tableId: BETA,
      pageSize: 2,
    });

    expect(tableIdsRead(pages)).toEqual([BETA]);
    expect(rowIdsListed(pages)).toEqual(BETA_ROWS);
  });

  it.each([1, 2, 7])(
    'pages through one large table with keysets of %i rows that list the units of one full page',
    async (pageSize) => {
      const draft = await givenLargeTableOfCreatedRows();
      const [fullPage] = await draft.listEveryPage({ pageSize: FULL_PAGE });

      const pages = await draft.listEveryPageWithReads({ pageSize });

      expect(fullPage?.units).toHaveLength(CREATED_ROWS);
      expect(unitsOfPages(pages.map(({ page }) => page))).toEqual(
        fullPage?.units,
      );
      expect(largestRowCountRead(pages)).toBeLessThanOrEqual(pageSize);
    },
  );

  it.each([1, 2, 3])(
    'reads at most %i changed rows per page, also after a row whose units ended a page',
    async (pageSize) => {
      const draft = await givenRowsWithSeveralUnits();

      const pages = await draft.listEveryPageWithReads({ pageSize });

      expect(largestRowCountRead(pages)).toBeLessThanOrEqual(pageSize);
      expect(rowIdsListed(pages)).toEqual([
        'r1',
        'r1',
        'r1',
        'r2',
        'r2',
        'r2',
        'r3',
      ]);
    },
  );

  it.each([1, 2])(
    'reads at most %i changed row ids per page also when the changed rows yield no units',
    async (pageSize) => {
      const draft = await givenRowsChangedOnlyInFormulaOutputs();
      const [fullPage] = await draft.listEveryPage({ pageSize: FULL_PAGE });

      const pages = await draft.listEveryPageWithReads({ pageSize });

      expect(fullPage?.units.map(describeUnit)).toEqual(['p9 field /title']);
      expect(unitsOfPages(pages.map(({ page }) => page))).toEqual(
        fullPage?.units,
      );
      expect(largestRowCountRead(pages)).toBeLessThanOrEqual(pageSize);
    },
  );

  it.each([1, 2, 3])(
    'reads at most %i row ids per page, each with at most two row pairs, through replacements and rename takeovers',
    async (pageSize) => {
      const draft = await givenReplacedAndTakenOverRows();
      const [fullPage] = await draft.listEveryPage({ pageSize: FULL_PAGE });

      const pages = await draft.listEveryPageWithReads({ pageSize });

      expect(fullPage?.units.map(describeUnit)).toEqual([
        'r1 rowReplace',
        'r3 rowDelete',
        'r3 rowRename',
        'r5 rowReplace',
        'r6 field /label',
      ]);
      expect(unitsOfPages(pages.map(({ page }) => page))).toEqual(
        fullPage?.units,
      );
      expect(largestRowCountRead(pages)).toBeLessThanOrEqual(pageSize);
      expect(largestPairCountRead(pages)).toBeLessThanOrEqual(2 * pageSize);
    },
  );

  async function givenThreeEditedTables(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [ALPHA]: { schema: labelSchema, rows: labelRows(ALPHA_ROWS) },
      [BETA]: { schema: labelSchema, rows: labelRows(BETA_ROWS) },
      [GAMMA]: { schema: labelSchema, rows: labelRows(GAMMA_ROWS) },
    });
    await editLabels(draft, ALPHA, ALPHA_ROWS);
    await editLabels(draft, BETA, BETA_ROWS);
    await editLabels(draft, GAMMA, GAMMA_ROWS);

    return draft;
  }

  async function editLabels(
    draft: ChangesScenario,
    tableId: string,
    rowIds: readonly string[],
  ): Promise<void> {
    for (const rowId of rowIds) {
      await draft.updateRow(tableId, rowId, { label: 'edited' });
    }
  }

  async function givenLargeTableOfCreatedRows(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [LARGE]: { schema: labelSchema },
    });
    const rowIds = Array.from(
      { length: CREATED_ROWS },
      (_, index) => `row-${index}`,
    );
    await draft.createRows(LARGE, labelRows(rowIds));

    return draft;
  }

  async function givenRowsChangedOnlyInFormulaOutputs(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: labelSchema, rows: { c1: { label: 'one' } } },
      [PRODUCTS]: {
        schema: productSchema,
        rows: Object.fromEntries(
          [...STALE_PRODUCTS, 'p9'].map((rowId) => [rowId, product('c1')]),
        ),
      },
    });
    await draft.renameRow(CATEGORIES, 'c1', 'c9');
    await draft.commit();

    for (const rowId of STALE_PRODUCTS) {
      await draft.updateRow(PRODUCTS, rowId, product('c9'));
    }

    await draft.updateRow(PRODUCTS, 'p9', product('c9', 'edited'));

    return draft;
  }

  async function givenReplacedAndTakenOverRows(): Promise<ChangesScenario> {
    const rowIds = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
    const draft = await ChangesScenario.committed(kit, {
      [ALPHA]: { schema: labelSchema, rows: labelRows(rowIds) },
    });
    await draft.removeRow(ALPHA, 'r1');
    await draft.createRows(ALPHA, labelRows(['r1']));
    await draft.removeRow(ALPHA, 'r3');
    await draft.renameRow(ALPHA, 'r4', 'r3');
    await draft.removeRow(ALPHA, 'r5');
    await draft.createRows(ALPHA, labelRows(['r5']));
    await draft.updateRow(ALPHA, 'r6', { label: 'edited' });

    return draft;
  }

  async function givenRowsWithSeveralUnits(): Promise<ChangesScenario> {
    const letters = { a: 'one', b: 'one', c: 'one' };
    const draft = await ChangesScenario.committed(kit, {
      [ALPHA]: {
        schema: letterSchema,
        rows: { r1: letters, r2: letters, r3: letters },
      },
    });
    await draft.updateRow(ALPHA, 'r1', { a: 'x', b: 'x', c: 'x' });
    await draft.updateRow(ALPHA, 'r2', { a: 'x', b: 'x', c: 'x' });
    await draft.updateRow(ALPHA, 'r3', { ...letters, a: 'x' });

    return draft;
  }
});

function labelRows(rowIds: readonly string[]) {
  return Object.fromEntries(rowIds.map((rowId) => [rowId, { label: rowId }]));
}

function readsOf(pages: readonly PageWithReads[]): ChangedRowsRead[] {
  return pages.flatMap(({ reads }) => reads);
}

function tableIdsRead(pages: readonly PageWithReads[]): string[] {
  return [...new Set(readsOf(pages).map(({ tableId }) => tableId))];
}

function largestRowCountRead(pages: readonly PageWithReads[]): number {
  return Math.max(
    ...pages.map(({ reads }) =>
      reads.reduce((count, { rowIds }) => count + rowIds.length, 0),
    ),
  );
}

function largestPairCountRead(pages: readonly PageWithReads[]): number {
  return Math.max(
    ...pages.map(({ reads }) =>
      reads.reduce((count, { pairs }) => count + pairs, 0),
    ),
  );
}

function product(category: string, title = 'one') {
  return { title, category, categoryCopy: '' };
}

function describeUnit({ kind, rowId, path }: ListedUnit): string {
  return [rowId, kind, path].filter(Boolean).join(' ');
}

function rowIdsListed(pages: readonly PageWithReads[]): string[] {
  return unitsOfPages(pages.map(({ page }) => page)).map(
    ({ rowId }) => rowId ?? '',
  );
}
