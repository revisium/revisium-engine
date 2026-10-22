import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { obj, ref, str } from '@revisium/schema-toolkit/mocks';
import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';
import { publicPartOf } from 'src/features/partial-changes-poc/__tests__/support/listed-units';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';

const EDITED = '2020-01-01T00:00:00.000Z';

const articleSchema = obj({
  title: str(),
  published: ref(SystemSchemaIds.RowPublishedAt),
});

const publishedOfA1 = { tableId: 'articles', rowId: 'a1', path: '/published' };
const titleOfA1 = { tableId: 'articles', rowId: 'a1', path: '/title' };
const priceOfP1 = { tableId: 'products', rowId: 'p1', path: '/price' };
const a1 = { tableId: 'articles', rowId: 'a1' };
const p1 = { tableId: 'products', rowId: 'p1' };

describe('unit completeness: every Draft difference belongs to one unit (decision 1)', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  guardCommittedVersions(() => kit.guard);

  afterAll(async () => {
    await kit.close();
  });

  async function givenArticlesAndProducts() {
    return ChangesScenario.committed(kit, {
      articles: {
        schema: articleSchema,
        rows: { a1: { title: 'a', published: '' } },
      },
      products: { schema: productSchema, rows: { p1: product('one', 1) } },
    });
  }

  async function givenPublishedAtEditAndPriceEdit() {
    const scenario = await givenArticlesAndProducts();
    await scenario.patchRow('articles', 'a1', { published: EDITED });
    await scenario.patchRow('products', 'p1', { price: 2 });
    return scenario;
  }

  describe('a RowPublishedAt edit', () => {
    it('is listed as a field unit at the path of that field', async () => {
      const scenario = await givenPublishedAtEditAndPriceEdit();

      const units = await scenario.listAllChanges();

      expect(units.map(publicPartOf)).toEqual([
        { kind: 'field', ...publishedOfA1 },
        { kind: 'field', ...priceOfP1 },
      ]);
    });

    it('stays in the Draft after a partial commit of another table', async () => {
      const scenario = await givenPublishedAtEditAndPriceEdit();

      const result = await scenario.commit({ fields: [priceOfP1] });

      expect(result.status).toBe('applied');
      expect((await scenario.draftRow('articles', 'a1')).publishedAt).toBe(
        EDITED,
      );
      expect(await scenario.draftHasChanges()).toBe(true);
    });

    it('stays in the Draft after a partial commit of the table it references', async () => {
      const scenario = await ChangesScenario.committed(kit, {
        products: { schema: productSchema, rows: { p1: product('one', 1) } },
        reviews: {
          schema: obj({
            product: str({ foreignKey: 'products' }),
            published: ref(SystemSchemaIds.RowPublishedAt),
          }),
          rows: { r1: { product: 'p1', published: '' } },
        },
      });
      await scenario.patchRow('reviews', 'r1', { published: EDITED });
      await scenario.patchRow('products', 'p1', { price: 2 });

      const result = await scenario.commit({ fields: [priceOfP1] });

      expect(result.status).toBe('applied');
      expect((await scenario.draftRow('reviews', 'r1')).publishedAt).toBe(
        EDITED,
      );
      expect(await scenario.draftHasChanges()).toBe(true);
    });

    it('stays in the Draft after a partial revert of another table', async () => {
      const scenario = await givenPublishedAtEditAndPriceEdit();

      const result = await scenario.revert({ fields: [priceOfP1] });

      expect(result.status).toBe('applied');
      expect((await scenario.draftRow('articles', 'a1')).publishedAt).toBe(
        EDITED,
      );
      expect(await scenario.draftHasChanges()).toBe(true);
    });

    it('is committed by its field unit and read back through the field', async () => {
      const scenario = await givenPublishedAtEditAndPriceEdit();

      const result = await scenario.commit({ fields: [publishedOfA1] });

      expect(result.status).toBe('applied');
      expect((await scenario.headRow('articles', 'a1')).publishedAt).toBe(
        EDITED,
      );
      expect(
        (await scenario.readRow('head', 'articles', 'a1'))?.data,
      ).toMatchObject({ published: EDITED });
      expect((await scenario.listAllChanges()).map(publicPartOf)).toEqual([
        { kind: 'field', ...priceOfP1 },
      ]);
    });

    it('is reverted by its field unit', async () => {
      const scenario = await givenPublishedAtEditAndPriceEdit();
      const head = await scenario.headRow('articles', 'a1');

      const result = await scenario.revert({ fields: [publishedOfA1] });

      expect(result.status).toBe('applied');
      expect((await scenario.draftRow('articles', 'a1')).publishedAt).toBe(
        head.publishedAt,
      );
      expect((await scenario.draftRow('products', 'p1')).data.price).toBe(2);
    });

    it('stays in the Draft when another field of the same row is committed', async () => {
      const scenario = await givenArticlesAndProducts();
      const before = await scenario.headRow('articles', 'a1');
      await scenario.patchRow('articles', 'a1', {
        title: 'edited',
        published: EDITED,
      });

      const result = await scenario.commit({ fields: [titleOfA1] });

      expect(result.status).toBe('applied');
      const head = await scenario.headRow('articles', 'a1');
      expect({ title: head.data.title, publishedAt: head.publishedAt }).toEqual(
        { title: 'edited', publishedAt: before.publishedAt },
      );
      expect((await scenario.draftRow('articles', 'a1')).publishedAt).toBe(
        EDITED,
      );
      expect((await scenario.listAllChanges()).map(publicPartOf)).toEqual([
        { kind: 'field', ...publishedOfA1 },
      ]);
    });
  });

  describe('a difference no field owns', () => {
    async function givenPublishedAtEditAndRemovedField() {
      const scenario = await givenArticlesAndProducts();
      await scenario.patchRow('articles', 'a1', { published: EDITED });
      await scenario.removeField('articles', 'published');
      return scenario;
    }

    it('is a whole-row unit when the Draft schema has no RowPublishedAt field', async () => {
      const scenario = await givenPublishedAtEditAndRemovedField();

      const units = await scenario.listAllChanges();

      expect(units.map(publicPartOf)).toEqual([
        { kind: 'structure', tableId: 'articles' },
        { kind: 'rowColumns', ...a1, columns: ['publishedAt'] },
      ]);
    });

    it('stays in the Draft when the structure is committed, and is committed later as its own unit', async () => {
      const scenario = await givenPublishedAtEditAndRemovedField();
      const before = await scenario.headRow('articles', 'a1');

      const structure = await scenario.commit({ tables: ['articles'] });

      expect(structure.status).toBe('applied');
      expect((await scenario.headRow('articles', 'a1')).publishedAt).toBe(
        before.publishedAt,
      );
      expect((await scenario.draftRow('articles', 'a1')).publishedAt).toBe(
        EDITED,
      );

      const row = await scenario.commit({ rowColumns: [a1] });

      expect(row.status).toBe('applied');
      expect((await scenario.headRow('articles', 'a1')).publishedAt).toBe(
        EDITED,
      );
      expect(await scenario.listAllChanges()).toEqual([]);
      expect(await scenario.draftHasChanges()).toBe(false);
    });

    it('is a whole-row unit when a native writer changed the row meta', async () => {
      const scenario = await givenArticlesAndProducts();
      await scenario.writeRowMetaNatively('products', 'p1', { note: 'kept' });
      await scenario.patchRow('articles', 'a1', { title: 'edited' });

      const units = await scenario.listAllChanges();
      const partial = await scenario.commit({ fields: [titleOfA1] });

      expect(units.map(publicPartOf)).toEqual([
        { kind: 'field', ...titleOfA1 },
        { kind: 'rowColumns', ...p1, columns: ['meta'] },
      ]);
      expect(partial.status).toBe('applied');
      expect((await scenario.draftRow('products', 'p1')).meta).toEqual({
        note: 'kept',
      });
      expect((await scenario.headRow('products', 'p1')).meta).toEqual({});

      const whole = await scenario.commit({ rows: [p1] });

      expect(whole.status).toBe('applied');
      expect((await scenario.headRow('products', 'p1')).meta).toEqual({
        note: 'kept',
      });
      expect(await scenario.draftHasChanges()).toBe(false);
    });
  });

  it('makes a selected structure unit stale when a publishedAt of its table changes after the preview (N6)', async () => {
    const scenario = await givenArticlesAndProducts();
    await scenario.addField('articles', 'color', str());
    const preview = await scenario.preview('commit', { tables: ['articles'] });

    await scenario.patchRow('articles', 'a1', { published: EDITED });
    const result = await scenario.commit(
      { tables: ['articles'] },
      { expected: preview.fingerprint },
    );

    expect(result.status).toBe('stale');
  });
});
