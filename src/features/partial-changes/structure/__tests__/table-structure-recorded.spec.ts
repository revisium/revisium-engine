import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import type { JsonPatch } from '@revisium/schema-toolkit/types';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';
import {
  addField,
  removeField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import {
  analyzeStructure,
  createdWith,
  foreignKeyRewrite,
  pendingUpdate,
  type StructureScenario,
} from './support/table-structure-scenario';

const createdProducts = obj({ code: str() });
const pricedProducts = obj({ code: str(), price: num() });
const referrer = obj({ category: str({ foreignKey: 'categories' }) });

const historyWithPrice = [
  createdWith(createdProducts),
  [addField('price', num())],
];

describe('TableStructure: pending history and recorded structure', () => {
  it('takes the Draft history after its Head prefix as pending', () => {
    const structure = analyzeStructure({
      head: createdProducts,
      draft: obj({ code: str(), price: num(), stock: num() }),
      pending: [
        pendingUpdate(addField('price', num())),
        pendingUpdate(addField('stock', num())),
      ],
    });

    expect(pendingPatchesOf(structure)).toEqual([
      [addField('price', num())],
      [addField('stock', num())],
    ]);
  });

  it.each<{ name: string; scenario: StructureScenario }>([
    {
      name: 'is shorter than the Head history',
      scenario: {
        head: pricedProducts,
        draft: pricedProducts,
        headHistory: historyWithPrice,
        draftHistory: [createdWith(createdProducts)],
      },
    },
    {
      name: 'changes an entry of the Head history',
      scenario: {
        head: pricedProducts,
        draft: obj({ code: str(), price: str() }),
        headHistory: historyWithPrice,
        draftHistory: [
          createdWith(createdProducts),
          [addField('price', str())],
        ],
      },
    },
  ])(
    'finds that the Draft history does not extend the Head history when it $name',
    ({ scenario }) => {
      expect(analyzeStructure(scenario).pendingHistory).toEqual({
        extendsHead: false,
      });
    },
  );

  it.each<{ name: string; scenario: StructureScenario }>([
    {
      name: 'nothing is pending and the schemas are equal',
      scenario: { head: createdProducts, draft: createdProducts },
    },
    {
      name: 'the pending history replayed from the Head schema gives the Draft schema',
      scenario: {
        head: createdProducts,
        draft: pricedProducts,
        pending: [pendingUpdate(addField('price', num()))],
      },
    },
    {
      name: 'a table rename rewrote the foreign key without a migration',
      scenario: {
        head: referrer,
        draft: obj({ category: str({ foreignKey: 'groups' }) }),
        draftHistory: [
          createdWith(referrer),
          foreignKeyRewrite(referrer, 'categories', 'groups'),
        ],
      },
    },
  ])('records the Draft structure when $name', ({ scenario }) => {
    expect(analyzeStructure(scenario).recorded).toBe(true);
  });

  it.each<{ name: string; scenario: StructureScenario }>([
    {
      name: 'the Draft schema changed without history',
      scenario: { head: createdProducts, draft: pricedProducts },
    },
    {
      name: 'a pending patch does not apply to the Head schema',
      scenario: {
        head: createdProducts,
        draft: createdProducts,
        pending: [pendingUpdate(removeField('missing'))],
      },
    },
    {
      name: 'the Draft history does not extend the Head history',
      scenario: {
        head: pricedProducts,
        draft: pricedProducts,
        headHistory: historyWithPrice,
        draftHistory: [createdWith(createdProducts)],
      },
    },
  ])('finds the Draft structure unrecorded when $name', ({ scenario }) => {
    expect(analyzeStructure(scenario).recorded).toBe(false);
  });
});

function pendingPatchesOf(structure: TableStructure): JsonPatch[][] {
  const { pendingHistory } = structure;

  if (!pendingHistory.extendsHead) {
    return [];
  }

  return pendingHistory.entries.map((entry) => entry.patches);
}
