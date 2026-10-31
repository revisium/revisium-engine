import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { num, obj, ref, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import {
  addField,
  replaceField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import type { RowPairIds } from '../../__tests__/support/snapshot-reading';

const PRODUCTS = 'products';
const CATEGORIES = 'categories';
const ARTICLES = 'articles';
const RELEASE_DATE = '2030-01-01T00:00:00.000Z';

const publishedAt = () => ref(SystemSchemaIds.RowPublishedAt);
const productSchema = obj({
  code: str(),
  price: num(),
  releasedAt: publishedAt(),
});
const categorySchema = obj({ title: str() });
const articleSchema = obj({ title: str() });

describe('ChangesSnapshotReader: changed rows', () => {
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

  describe('under an unchanged structure', () => {
    it.each<{
      difference: string;
      edit: (draft: ChangesScenario) => Promise<void>;
      pairs: RowPairIds[];
    }>([
      {
        difference: 'data at an unchanged leaf',
        edit: (draft) => draft.updateRow(PRODUCTS, 'p1', product('renamed', 1)),
        pairs: [{ head: 'p1', draft: 'p1' }],
      },
      {
        difference: 'publishedAt',
        edit: (draft) =>
          draft.updateRow(PRODUCTS, 'p1', product('one', 1, RELEASE_DATE)),
        pairs: [{ head: 'p1', draft: 'p1' }],
      },
      {
        difference: 'meta',
        edit: (draft) =>
          draft.writeRowColumns(PRODUCTS, 'p1', { meta: { note: 'reviewed' } }),
        pairs: [{ head: 'p1', draft: 'p1' }],
      },
      {
        difference: 'schemaHash',
        edit: (draft) =>
          draft.writeRowColumns(PRODUCTS, 'p1', { schemaHash: 'other-schema' }),
        pairs: [{ head: 'p1', draft: 'p1' }],
      },
      {
        difference: 'id (a rename)',
        edit: (draft) => draft.renameRow(PRODUCTS, 'p1', 'p9'),
        pairs: [{ head: 'p1', draft: 'p9' }],
      },
      {
        difference: 'existence (a created row)',
        edit: (draft) =>
          draft.createRows(PRODUCTS, { p3: product('three', 3) }),
        pairs: [{ draft: 'p3' }],
      },
      {
        difference: 'existence (a deleted row)',
        edit: (draft) => draft.removeRow(PRODUCTS, 'p2'),
        pairs: [{ head: 'p2' }],
      },
      {
        difference: 'identity (a replaced row)',
        edit: async (draft) => {
          await draft.removeRow(PRODUCTS, 'p2');
          await draft.createRows(PRODUCTS, { p2: product('two', 2) });
        },
        pairs: [{ draft: 'p2' }, { head: 'p2' }],
      },
    ])(
      'loads the pair of a row that differs in $difference',
      async ({ edit, pairs }) => {
        const draft = await givenCommittedProducts();
        await edit(draft);

        const changes = await draft.readChangedRows([PRODUCTS]);

        expect(changes.pairsOf(PRODUCTS)).toEqual(pairs);
        expect(changes.count).toBe(pairs.length);
      },
    );

    it('loads every column of both versions of a changed pair', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(
        PRODUCTS,
        'p1',
        product('renamed', 1, RELEASE_DATE),
      );

      const changes = await draft.readChangedRows([PRODUCTS]);

      expect(changes.rowPairOf(PRODUCTS, 'p1')).toEqual({
        identity: (await draft.row('head', PRODUCTS, 'p1')).createdId,
        head: await draft.row('head', PRODUCTS, 'p1'),
        draft: await draft.row('draft', PRODUCTS, 'p1'),
      });
    });

    it('does not load a Draft row version that is content-equal to its Head version', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateRow(PRODUCTS, 'p1', product('changed', 1));
      await draft.updateRow(PRODUCTS, 'p1', product('one', 1));

      const changes = await draft.readChangedRows([PRODUCTS]);

      expect(await draft.hasDraftVersion(PRODUCTS, 'p1')).toBe(true);
      expect(changes.pairsOf(PRODUCTS)).toEqual([]);
      expect(changes.count).toBe(0);
    });
  });

  describe('under a changed structure', () => {
    it('does not load a row that differs only at a changed field and in schemaHash', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateTable(PRODUCTS, [replaceField('price', str())]);
      await draft.updateRow(PRODUCTS, 'p2', {
        ...product('renamed', 2),
        price: '2',
      });

      const changes = await draft.readChangedRows([PRODUCTS]);

      expect(changes.pairsOf(PRODUCTS)).toEqual([{ head: 'p2', draft: 'p2' }]);
      expect(changes.count).toBe(1);
    });

    it('does not load a row that differs only in a publishedAt owned by the structure', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [ARTICLES]: {
          schema: articleSchema,
          rows: { a1: { title: 'one' }, a2: { title: 'two' } },
        },
      });
      await draft.updateTable(ARTICLES, [
        addField('releasedAt', publishedAt()),
      ]);
      await draft.updateRow(ARTICLES, 'a1', {
        title: 'one',
        releasedAt: RELEASE_DATE,
      });
      await draft.updateRow(ARTICLES, 'a2', {
        title: 'edited',
        releasedAt: '',
      });

      const changes = await draft.readChangedRows([ARTICLES]);

      expect(changes.pairsOf(ARTICLES)).toEqual([{ head: 'a2', draft: 'a2' }]);
      expect(changes.count).toBe(1);
    });
  });

  it('does not load a row of a renamed table that differs only in a stale schemaHash', async () => {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [PRODUCTS]: {
        schema: obj({ code: str(), category: str({ foreignKey: CATEGORIES }) }),
        rows: { p1: { code: 'one', category: 'c1' } },
      },
    });
    await draft.renameTable(CATEGORIES, 'groups');
    await draft.commit();
    await draft.renameTable(PRODUCTS, 'goods');
    await draft.updateRow('goods', 'p1', { code: 'one', category: 'c1' });

    const changes = await draft.readChangedRows(['goods']);

    expect(changes.pairsOf('goods')).toEqual([]);
    expect(changes.count).toBe(0);
  });

  it('reads the changed rows of the given tables only', async () => {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: { schema: productSchema, rows: { p1: product('one', 1) } },
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
    });
    await draft.updateRow(PRODUCTS, 'p1', product('changed', 1));
    await draft.updateRow(CATEGORIES, 'c1', { title: 'changed' });

    const changes = await draft.readChangedRows([PRODUCTS]);

    expect(changes.readTableIds).toEqual([PRODUCTS]);
    expect(changes.count).toBe(1);
  });

  function givenCommittedProducts(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: product('one', 1), p2: product('two', 2) },
      },
    });
  }
});

function product(code: string, price: number, releasedAt = '') {
  return { code, price, releasedAt };
}
