import { arr, num, obj, str } from '@revisium/schema-toolkit/mocks';
import type { JsonPatch } from '@revisium/schema-toolkit/types';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';
import {
  addField,
  moveField,
  removeField,
  replaceField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import {
  analyzeStructure,
  changedPointersOf,
  createdWith,
  foreignKeyRewrite,
  pendingUpdate,
  type StructureScenario,
  unchangedPointersOf,
} from './support/table-structure-scenario';

const CATEGORIES = 'categories-identity';
const RECREATED_CATEGORIES = 'recreated-categories-identity';

const replaceTagItems: JsonPatch = {
  op: 'replace',
  path: '/properties/tags/items',
  value: str(),
};

describe('TableStructure: unchanged and changed leaves', () => {
  it.each<{ name: string; scenario: StructureScenario }>([
    {
      name: 'has the same schema and no pending migration',
      scenario: { head: obj({ code: str() }), draft: obj({ code: str() }) },
    },
    {
      name: 'differs only in its title',
      scenario: {
        head: obj({ code: str({ title: 'Code' }) }),
        draft: obj({ code: str({ title: 'SKU' }) }),
      },
    },
    {
      name: 'differs only in its description',
      scenario: {
        head: obj({ code: str() }),
        draft: obj({ code: str({ description: 'Stock keeping unit' }) }),
      },
    },
    {
      name: 'differs only in being deprecated',
      scenario: {
        head: obj({ code: str() }),
        draft: obj({ code: str({ deprecated: true }) }),
      },
    },
    {
      name: 'differs only in the annotations of its array items',
      scenario: {
        head: obj({ code: arr(obj({ part: str() })) }),
        draft: obj({ code: arr(obj({ part: str({ title: 'Part' }) })) }),
      },
    },
    {
      name: 'has a sibling changed by a pending migration',
      scenario: {
        head: obj({ code: str(), price: num() }),
        draft: obj({ code: str(), price: str() }),
        pending: [pendingUpdate(replaceField('price', str()))],
      },
    },
  ])('keeps a Draft leaf unchanged when it $name', ({ scenario }) => {
    expectUnchanged(analyzeStructure(scenario), '/code');
  });

  it.each([
    {
      name: 'a foreign key',
      headField: str({ foreignKey: 'categories' }),
      draftField: str({ foreignKey: 'groups' }),
    },
    {
      name: 'a foreign key in array items',
      headField: arr(str({ foreignKey: 'categories' })),
      draftField: arr(str({ foreignKey: 'groups' })),
    },
  ])(
    'keeps $name unchanged when a table rename rewrote the referenced table id',
    ({ headField, draftField }) => {
      const head = obj({ category: headField });

      const structure = analyzeStructure({
        head,
        draft: obj({ category: draftField }),
        headTables: { categories: CATEGORIES },
        draftTables: { groups: CATEGORIES },
        draftHistory: [
          createdWith(head),
          foreignKeyRewrite(head, 'categories', 'groups'),
        ],
      });

      expectUnchanged(structure, '/category');
    },
  );

  it.each<{ name: string; scenario: StructureScenario; leaf: string }>([
    {
      name: 'the Draft added it',
      scenario: {
        head: obj({}),
        draft: obj({ code: str() }),
        pending: [pendingUpdate(addField('code', str()))],
      },
      leaf: '/code',
    },
    {
      name: 'the Draft removed it',
      scenario: {
        head: obj({ code: str() }),
        draft: obj({}),
        pending: [pendingUpdate(removeField('code'))],
      },
      leaf: '/code',
    },
    {
      name: 'its schema differs',
      scenario: { head: obj({ code: str() }), draft: obj({ code: num() }) },
      leaf: '/code',
    },
    {
      name: 'its foreign key references another table identity with the same id',
      scenario: {
        head: obj({ category: str({ foreignKey: 'categories' }) }),
        draft: obj({ category: str({ foreignKey: 'categories' }) }),
        headTables: { categories: CATEGORIES },
        draftTables: { categories: RECREATED_CATEGORIES },
      },
      leaf: '/category',
    },
    {
      name: 'a later pending patch restored its schema',
      scenario: {
        head: obj({ code: str() }),
        draft: obj({ code: str() }),
        pending: [
          pendingUpdate(replaceField('code', num())),
          pendingUpdate(replaceField('code', str())),
        ],
      },
      leaf: '/code',
    },
    {
      name: 'a pending patch replaced an ancestor',
      scenario: {
        head: obj({ address: obj({ city: str() }) }),
        draft: obj({ address: obj({ city: str() }) }),
        pending: [pendingUpdate(replaceField('address', obj({ city: str() })))],
      },
      leaf: '/address/city',
    },
    {
      name: 'a pending patch replaced the items of its array',
      scenario: {
        head: obj({ tags: arr(str()) }),
        draft: obj({ tags: arr(str()) }),
        pending: [pendingUpdate(replaceTagItems)],
      },
      leaf: '/tags',
    },
    {
      name: 'a pending move took a field from its pointer',
      scenario: {
        head: obj({ code: str(), sku: str() }),
        draft: obj({ code: str(), sku: str() }),
        pending: [pendingUpdate(moveField('code', 'sku'))],
      },
      leaf: '/code',
    },
    {
      name: 'a pending move put a field at its pointer',
      scenario: {
        head: obj({ code: str(), sku: str() }),
        draft: obj({ code: str(), sku: str() }),
        pending: [pendingUpdate(moveField('code', 'sku'))],
      },
      leaf: '/sku',
    },
  ])('marks a leaf changed when $name', ({ scenario, leaf }) => {
    expectChanged(analyzeStructure(scenario), leaf);
  });

  it('lists each changed leaf of either schema once', () => {
    const structure = analyzeStructure({
      head: obj({ code: str(), price: num(), legacy: str() }),
      draft: obj({ code: str(), price: str(), stock: num() }),
      pending: [
        pendingUpdate(
          replaceField('price', str()),
          removeField('legacy'),
          addField('stock', num()),
        ),
      ],
    });

    expect(unchangedPointersOf(structure)).toEqual(['/code']);
    expect(changedPointersOf(structure)).toEqual([
      '/price',
      '/stock',
      '/legacy',
    ]);
  });
});

function expectUnchanged(structure: TableStructure, pointer: string): void {
  expect(unchangedPointersOf(structure)).toContain(pointer);
  expect(changedPointersOf(structure)).not.toContain(pointer);
}

function expectChanged(structure: TableStructure, pointer: string): void {
  expect(changedPointersOf(structure)).toContain(pointer);
  expect(unchangedPointersOf(structure)).not.toContain(pointer);
}
