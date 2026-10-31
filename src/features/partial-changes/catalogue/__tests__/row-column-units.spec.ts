import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { obj, ref, str } from '@revisium/schema-toolkit/mocks';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import {
  addField,
  removeField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { expectEveryDifferenceOwnedOnce } from '../../__tests__/support/column-ownership';

const ARTICLES = 'articles';
const RELEASE_DATE = '2030-01-01T00:00:00.000Z';

const publishedAt = () => ref(SystemSchemaIds.RowPublishedAt);
const articleSchema = obj({ title: str() });
const releasedArticleSchema = obj({ title: str(), releasedAt: publishedAt() });
const reviewedArticleSchema = obj({
  title: str(),
  releasedAt: publishedAt(),
  reviewedAt: publishedAt(),
});

describe('ChangeCatalogue: owners of publishedAt, meta and schemaHash', () => {
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

  describe('publishedAt', () => {
    it('lists a publishedAt edit as the field unit of an unchanged published-at field', async () => {
      const draft = await givenCommittedArticle(releasedArticleSchema, {
        title: 'one',
        releasedAt: '',
      });
      await draft.updateRow(ARTICLES, 'a1', {
        title: 'one',
        releasedAt: RELEASE_DATE,
      });

      const catalogue = await draft.readCatalogue([ARTICLES]);

      expect(catalogue.unitsOf(ARTICLES)).toEqual([
        { kind: 'field', tableId: ARTICLES, rowId: 'a1', path: '/releasedAt' },
      ]);
      expectEveryDifferenceOwnedOnce(catalogue);
    });

    it('lists a publishedAt edit as rowColumns when the schema has several RowPublishedAt leaves', async () => {
      const draft = await givenCommittedArticle(reviewedArticleSchema, {
        title: 'one',
        releasedAt: '',
        reviewedAt: '',
      });
      await draft.updateRow(ARTICLES, 'a1', {
        title: 'one',
        releasedAt: RELEASE_DATE,
        reviewedAt: '',
      });

      const catalogue = await draft.readCatalogue([ARTICLES]);

      expect(catalogue.unitsOf(ARTICLES)).toEqual([
        {
          kind: 'rowColumns',
          tableId: ARTICLES,
          rowId: 'a1',
          columns: ['publishedAt'],
        },
      ]);
      expectEveryDifferenceOwnedOnce(catalogue);
    });

    it('lists a publishedAt difference as rowColumns after the structure removed the published-at field', async () => {
      const draft = await givenCommittedArticle(releasedArticleSchema, {
        title: 'one',
        releasedAt: '',
      });
      await draft.updateRow(ARTICLES, 'a1', {
        title: 'one',
        releasedAt: RELEASE_DATE,
      });
      await draft.updateTable(ARTICLES, [removeField('releasedAt')]);

      const catalogue = await draft.readCatalogue([ARTICLES]);

      expect(catalogue.unitsOf(ARTICLES)).toEqual([
        {
          kind: 'rowColumns',
          tableId: ARTICLES,
          rowId: 'a1',
          columns: ['publishedAt'],
        },
      ]);
      expectEveryDifferenceOwnedOnce(catalogue);
    });

    it('lists no row unit for a publishedAt edit of a published-at field the structure added', async () => {
      const draft = await givenCommittedArticle(articleSchema, {
        title: 'one',
      });
      await draft.updateTable(ARTICLES, [
        addField('releasedAt', publishedAt()),
      ]);
      await draft.updateRow(ARTICLES, 'a1', {
        title: 'one',
        releasedAt: RELEASE_DATE,
      });

      const catalogue = await draft.readCatalogue([ARTICLES]);

      expect(catalogue.unitsOf(ARTICLES)).toEqual([]);
      expectEveryDifferenceOwnedOnce(catalogue);
    });

    it('leaves a publishedAt edit of a published-at field the structure added to the structure when the row has a field edit', async () => {
      const draft = await givenCommittedArticle(articleSchema, {
        title: 'one',
      });
      await draft.updateTable(ARTICLES, [
        addField('releasedAt', publishedAt()),
      ]);
      await draft.updateRow(ARTICLES, 'a1', {
        title: 'edited',
        releasedAt: RELEASE_DATE,
      });

      const catalogue = await draft.readCatalogue([ARTICLES]);

      expect(catalogue.unitsOf(ARTICLES)).toEqual([
        { kind: 'field', tableId: ARTICLES, rowId: 'a1', path: '/title' },
      ]);
      expectEveryDifferenceOwnedOnce(catalogue);
    });
  });

  describe('meta and schemaHash', () => {
    it('lists a meta edit as rowColumns', async () => {
      const draft = await givenCommittedArticle(articleSchema, {
        title: 'one',
      });
      await draft.writeRowColumns(ARTICLES, 'a1', { meta: { note: 'one' } });

      const catalogue = await draft.readCatalogue([ARTICLES]);

      expect(catalogue.unitsOf(ARTICLES)).toEqual([
        {
          kind: 'rowColumns',
          tableId: ARTICLES,
          rowId: 'a1',
          columns: ['meta'],
        },
      ]);
      expectEveryDifferenceOwnedOnce(catalogue);
    });

    it('lists a schemaHash difference under an unchanged structure as rowColumns', async () => {
      const draft = await givenCommittedArticle(articleSchema, {
        title: 'one',
      });
      await draft.writeRowColumns(ARTICLES, 'a1', { schemaHash: 'other' });

      const catalogue = await draft.readCatalogue([ARTICLES]);

      expect(catalogue.unitsOf(ARTICLES)).toEqual([
        {
          kind: 'rowColumns',
          tableId: ARTICLES,
          rowId: 'a1',
          columns: ['schemaHash'],
        },
      ]);
      expectEveryDifferenceOwnedOnce(catalogue);
    });

    it('lists every differing row column of a row in one rowColumns unit', async () => {
      const draft = await givenCommittedArticle(reviewedArticleSchema, {
        title: 'one',
        releasedAt: '',
        reviewedAt: '',
      });
      await draft.updateRow(ARTICLES, 'a1', {
        title: 'one',
        releasedAt: RELEASE_DATE,
        reviewedAt: '',
      });
      await draft.writeRowColumns(ARTICLES, 'a1', {
        meta: { note: 'one' },
        schemaHash: 'other',
      });

      const catalogue = await draft.readCatalogue([ARTICLES]);

      expect(catalogue.unitsOf(ARTICLES)).toEqual([
        {
          kind: 'rowColumns',
          tableId: ARTICLES,
          rowId: 'a1',
          columns: ['publishedAt', 'meta', 'schemaHash'],
        },
      ]);
      expectEveryDifferenceOwnedOnce(catalogue);
    });
  });

  function givenCommittedArticle(
    schema: JsonSchema,
    data: Record<string, string>,
  ): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [ARTICLES]: { schema, rows: { a1: data } },
    });
  }
});
