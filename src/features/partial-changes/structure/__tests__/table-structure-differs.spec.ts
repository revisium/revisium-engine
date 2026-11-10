import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  addField,
  removeField,
  rename,
  replaceField,
} from 'src/__tests__/fixtures/ledger-steps';
import {
  analyzeStructure,
  createdWith,
  pendingUpdate,
  type StructureScenario,
} from './support/table-structure-scenario';

const products = obj({ code: str() });

describe('TableStructure: whether the structure differs', () => {
  it('finds the structure unchanged when the schemas are equal and nothing is pending', () => {
    expect(analyzeStructure({ head: products, draft: products }).differs).toBe(
      false,
    );
  });

  it.each<{ name: string; scenario: StructureScenario }>([
    {
      name: 'a pending migration changed the schema',
      scenario: {
        head: products,
        draft: obj({ code: str(), price: num() }),
        pending: [pendingUpdate(addField('price', num()))],
      },
    },
    {
      name: 'the schemas differ only in a title, without history',
      scenario: {
        head: obj({ code: str({ title: 'Code' }) }),
        draft: obj({ code: str({ title: 'SKU' }) }),
      },
    },
    {
      name: 'the pending history restored the Head schema',
      scenario: {
        head: products,
        draft: products,
        pending: [
          pendingUpdate(addField('price', num())),
          pendingUpdate(removeField('price')),
        ],
      },
    },
    {
      name: 'the Draft renamed the table',
      scenario: { head: products, draft: products, draftTableId: 'goods' },
    },
    {
      name: 'a pending rename is attributed to the table, although it renamed the table back',
      scenario: {
        head: products,
        draft: products,
        pending: [rename('products', 'goods'), rename('goods', 'products')],
      },
    },
    {
      name: 'a pending migration touches a leaf the history does not record',
      scenario: {
        head: products,
        draft: products,
        pending: [pendingUpdate(replaceField('code', str()))],
        draftHistory: [createdWith(products)],
      },
    },
  ])('finds that the structure differs when $name', ({ scenario }) => {
    expect(analyzeStructure(scenario).differs).toBe(true);
  });
});

describe('TableStructure: whether the structure differs beyond the table id', () => {
  it.each<{ name: string; scenario: StructureScenario }>([
    {
      name: 'the Draft only renamed the table',
      scenario: { head: products, draft: products, draftTableId: 'goods' },
    },
    {
      name: 'only pending renames are attributed to the table',
      scenario: {
        head: products,
        draft: products,
        draftTableId: 'goods',
        pending: [rename('products', 'goods')],
      },
    },
  ])('finds nothing beyond the table id when $name', ({ scenario }) => {
    expect(analyzeStructure(scenario).differsBeyondTableId).toBe(false);
  });

  it.each<{ name: string; scenario: StructureScenario }>([
    {
      name: 'a pending update restored the Head schema of a renamed table',
      scenario: {
        head: products,
        draft: products,
        draftTableId: 'goods',
        pending: [
          rename('products', 'goods'),
          pendingUpdate(addField('price', num())),
          pendingUpdate(removeField('price')),
        ],
      },
    },
    {
      name: 'the schemas of a renamed table differ only in a title',
      scenario: {
        head: obj({ code: str({ title: 'Code' }) }),
        draft: obj({ code: str({ title: 'SKU' }) }),
        draftTableId: 'goods',
      },
    },
  ])('finds a difference beyond the table id when $name', ({ scenario }) => {
    expect(analyzeStructure(scenario).differsBeyondTableId).toBe(true);
  });
});
