import { obj, str } from '@revisium/schema-toolkit/mocks';
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

const ALPHA = 'alpha';
const BETA = 'beta';
const GAMMA = 'gamma';
const LARGE = 'large';
const ALPHA_ROWS = ['a1', 'a2', 'a3'];
const BETA_ROWS = ['b1', 'b2', 'b3'];
const GAMMA_ROWS = ['g1', 'g2', 'g3'];
const CREATED_ROWS = 30;
const FULL_PAGE = 5_000;

const labelSchema = obj({ label: str() });
const letterSchema = obj({ a: str(), b: str(), c: str() });

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

    expect(first?.reads).toEqual([{ tableId: ALPHA, rowIds: ['a1', 'a2'] }]);
  });

  it('continues reading from the cursor table and row', async () => {
    const draft = await givenThreeEditedTables();

    const pages = await draft.listEveryPageWithReads({ pageSize: 2 });

    expect(pages.map(({ reads }) => reads)).toEqual([
      [{ tableId: ALPHA, rowIds: ['a1', 'a2'] }],
      [
        { tableId: ALPHA, rowIds: ['a3'] },
        { tableId: BETA, rowIds: ['b1'] },
      ],
      [{ tableId: BETA, rowIds: ['b2', 'b3'] }],
      [
        { tableId: BETA, rowIds: [] },
        { tableId: GAMMA, rowIds: ['g1', 'g2'] },
      ],
      [{ tableId: GAMMA, rowIds: ['g3'] }],
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

function rowIdsListed(pages: readonly PageWithReads[]): string[] {
  return unitsOfPages(pages.map(({ page }) => page)).map(
    ({ rowId }) => rowId ?? '',
  );
}
