import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  addField,
  removeField,
  replaceField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
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
