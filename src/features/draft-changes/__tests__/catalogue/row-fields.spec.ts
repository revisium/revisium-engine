import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import type { JsonSchema, JsonValue } from '@revisium/schema-toolkit/types';
import {
  buildCatalogue,
  catalogueResult,
  CATALOGUE_ROW_CREATED_ID,
  givenCatalogueScenario,
} from './support/catalogue-scenario';
import {
  moveField,
  numberField,
  objectSchema,
  project,
  requiredProjected,
  rowInput,
  stringField,
} from 'src/features/draft-changes/__tests__/schema/support/schema-projection-fixture';

const falsyRootCases: Array<{
  name: string;
  schema: JsonSchema;
  before: JsonValue;
  after: JsonValue;
  expected: object;
}> = [
  {
    name: 'zero',
    schema: numberField(0),
    before: 0,
    after: 1,
    expected: {
      status: 'catalogued',
      catalogue: {
        entries: expect.arrayContaining([
          expect.objectContaining({ before: 0, after: 1, beforeExists: true }),
        ]),
      },
    },
  },
  {
    name: 'false',
    schema: { type: 'boolean', default: false },
    before: false,
    after: true,
    expected: {
      status: 'catalogued',
      catalogue: {
        entries: expect.arrayContaining([
          expect.objectContaining({
            before: false,
            after: true,
            beforeExists: true,
          }),
        ]),
      },
    },
  },
  {
    name: 'empty string',
    schema: stringField(''),
    before: '',
    after: 'changed',
    expected: {
      status: 'catalogued',
      catalogue: {
        entries: expect.arrayContaining([
          expect.objectContaining({
            before: '',
            after: 'changed',
            beforeExists: true,
          }),
        ]),
      },
    },
  },
  {
    name: 'null',
    schema: { $ref: SystemSchemaIds.File },
    before: null,
    after: null,
    expected: { status: 'catalogued' },
  },
];

describe('draft changes catalogue row fields', () => {
  it('blocks a genuinely ambiguous dotted path instead of guessing its JSON Pointer', async () => {
    const scenario = await givenCatalogueScenario({
      headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { a: { b: 1 }, 'a.b': 1 })],
      draftRows: [
        rowInput(CATALOGUE_ROW_CREATED_ID, { a: { b: 2 }, 'a.b': 2 }),
      ],
    });
    const result = await catalogueResult(scenario);

    expect(result).toMatchObject({
      status: 'blocked',
      blockers: [{ code: 'AMBIGUOUS_PATH' }],
    });
  });

  it('omits row-field entries when actual values match despite different version metadata', async () => {
    const scenario = await givenCatalogueScenario({
      headRows: [
        {
          createdId: CATALOGUE_ROW_CREATED_ID,
          data: { title: 'same', price: 10 },
        },
      ],
      draftRows: [
        {
          createdId: CATALOGUE_ROW_CREATED_ID,
          data: { title: 'same', price: 10 },
        },
      ],
    });

    const rowFields = (await buildCatalogue(scenario)).entries.filter(
      ({ kind }) => kind === 'rowField',
    );

    expect(rowFields).toEqual([]);
  });

  it('compares actual row data when stored hash and version are unchanged', async () => {
    const scenario = await givenCatalogueScenario({
      shareStaleRowVersion: true,
      headRows: [
        {
          createdId: CATALOGUE_ROW_CREATED_ID,
          data: { title: 'Head', price: 10 },
        },
      ],
      draftRows: [
        {
          createdId: CATALOGUE_ROW_CREATED_ID,
          data: { title: 'Draft', price: 10 },
        },
      ],
    });

    const titleChange = (await buildCatalogue(scenario)).entries.find(
      ({ path }) => path === '/title',
    );

    expect(titleChange).toMatchObject({
      kind: 'rowField',
      classification: 'updated',
      before: 'Head',
      after: 'Draft',
      beforeExists: true,
      afterExists: true,
    });
  });

  it.each(falsyRootCases)(
    'retains a falsy $name Head value as a present baseline',
    async ({ schema, before, after, expected }) => {
      const scenario = await givenCatalogueScenario({
        headSchema: schema,
        draftSchema: schema,
        headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, before)],
        draftRows: [rowInput(CATALOGUE_ROW_CREATED_ID, after)],
      });

      expect(await catalogueResult(scenario)).toMatchObject(expected);
    },
  );

  it('keeps an invalid Draft row value browsable without schema validation', async () => {
    const scenario = await givenCatalogueScenario({
      headRows: [
        {
          createdId: CATALOGUE_ROW_CREATED_ID,
          data: { title: 'Head', price: 10 },
        },
      ],
      draftRows: [
        {
          createdId: CATALOGUE_ROW_CREATED_ID,
          data: { title: 42, price: 'invalid' },
        },
      ],
    });

    const entries = (await buildCatalogue(scenario)).entries;

    expect(entries.filter(({ kind }) => kind === 'rowField')).toHaveLength(2);
    expect(entries.find(({ path }) => path === '/title')?.after).toBe(42);
    expect(entries.find(({ path }) => path === '/price')?.after).toBe(
      'invalid',
    );
  });

  it('distinguishes an absent field from a present null value', async () => {
    const scenario = await givenCatalogueScenario({
      headRows: [
        {
          createdId: CATALOGUE_ROW_CREATED_ID,
          data: { title: 'Head', price: 10 },
        },
      ],
      draftRows: [
        {
          createdId: CATALOGUE_ROW_CREATED_ID,
          data: { title: null, price: 10 },
        },
      ],
    });

    const titleChange = (await buildCatalogue(scenario)).entries.find(
      ({ path }) => path === '/title',
    );

    expect(titleChange).toMatchObject({
      before: 'Head',
      after: null,
      beforeExists: true,
      afterExists: true,
    });
  });

  it('records presence separately when a field is added with a null value', async () => {
    const scenario = await givenCatalogueScenario({
      headRows: [
        { createdId: CATALOGUE_ROW_CREATED_ID, data: { title: 'Head' } },
      ],
      draftRows: [
        {
          createdId: CATALOGUE_ROW_CREATED_ID,
          data: { title: 'Head', price: null },
        },
      ],
    });

    const priceChange = (await buildCatalogue(scenario)).entries.find(
      ({ path }) => path === '/price',
    );

    expect(priceChange).toMatchObject({
      beforeExists: false,
      afterExists: true,
      after: null,
    });
  });

  it('compares against actual Draft data when a discard projection restores the old field shape', async () => {
    const headSchema = objectSchema({ price: numberField() });
    const draftSchema = objectSchema({ cost: numberField() });
    const scenario = await givenCatalogueScenario({
      headSchema,
      draftSchema,
      pending: [
        {
          patches: [moveField('/properties/price', '/properties/cost')],
          schema: draftSchema,
        },
      ],
      headRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { price: 100 })],
      draftRows: [rowInput(CATALOGUE_ROW_CREATED_ID, { cost: 120 })],
    });
    const projection = requiredProjected(
      await project({
        snapshot: scenario.snapshot,
        tableCreatedId: scenario.tableCreatedId,
        operation: 'discard',
        effects: [{ historyIndex: 1, patchIndex: 0 }],
      }),
    );

    const result = await catalogueResult({
      snapshot: scenario.snapshot,
      schemaProjections: [
        { tableCreatedId: scenario.tableCreatedId, projection },
      ],
    });
    expect(result).toMatchObject({
      status: 'catalogued',
      catalogue: {
        entries: expect.arrayContaining([
          expect.objectContaining({
            kind: 'rowField',
            path: '/cost',
            before: 100,
            after: 120,
          }),
        ]),
      },
    });
  });
});
