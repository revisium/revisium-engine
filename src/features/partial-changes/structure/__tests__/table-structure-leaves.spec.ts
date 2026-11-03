import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { arr, num, obj, ref, str } from '@revisium/schema-toolkit/mocks';
import type {
  JsonPatch,
  JsonSchema,
  Migration,
} from '@revisium/schema-toolkit/types';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';
import {
  addField,
  moveField,
  removeField,
  replaceField,
} from 'src/__tests__/fixtures/ledger-steps';
import {
  analyzeStructure,
  changedPointersOf,
  createdWith,
  describedChangesOf,
  type DescribedChange,
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
const moveColorOutOfVariantItems: JsonPatch = {
  op: 'move',
  from: '/properties/variants/items/properties/color',
  path: '/properties/color',
};
const moveColorIntoVariantItems: JsonPatch = {
  op: 'move',
  from: '/properties/color',
  path: '/properties/variants/items/properties/color',
};
const moveFileNameOutOfCover: JsonPatch = {
  op: 'move',
  from: '/properties/cover/properties/fileName',
  path: '/properties/name',
};
const moveTitleIntoCover: JsonPatch = {
  op: 'move',
  from: '/properties/title',
  path: '/properties/cover/properties/title',
};
const replaceAssetFileName: JsonPatch = {
  op: 'replace',
  path: '/properties/asset/properties/fileName',
  value: num(),
};
const file = () => ref(SystemSchemaIds.File);

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

describe('TableStructure: moved leaves', () => {
  it.each<{
    name: string;
    draft: JsonSchema;
    pending: Migration[];
    structureBound: string[];
  }>([
    {
      name: 'the source and the target of a move',
      draft: obj({ sku: str(), price: num() }),
      pending: [pendingUpdate(moveField('code', 'sku'))],
      structureBound: ['/sku', '/code'],
    },
    {
      name: 'the pointer of a move reverted inside the Draft',
      draft: obj({ code: str(), price: num() }),
      pending: [
        pendingUpdate(moveField('code', 'sku')),
        pendingUpdate(moveField('sku', 'code')),
      ],
      structureBound: ['/code'],
    },
  ])('keeps $name structure-bound', ({ draft, pending, structureBound }) => {
    const structure = analyzeStructure({
      head: obj({ code: str(), price: num() }),
      draft,
      pending,
    });

    expect(changedPointersOf(structure)).toEqual(structureBound);
    expect(unchangedPointersOf(structure)).toEqual(['/price']);
  });

  it.each<{
    name: string;
    scenario: StructureScenario;
    described: DescribedChange[];
  }>([
    {
      name: 'out of the items of an array as added, and the array as changed',
      scenario: {
        head: obj({ variants: arr(obj({ color: str(), size: str() })) }),
        draft: obj({ variants: arr(obj({ size: str() })), color: str() }),
        pending: [pendingUpdate(moveColorOutOfVariantItems)],
      },
      described: [
        { pointer: '/variants', change: 'changed' },
        { pointer: '/color', change: 'added' },
      ],
    },
    {
      name: 'into the items of an array as removed, and the array as changed',
      scenario: {
        head: obj({ variants: arr(obj({ size: str() })), color: str() }),
        draft: obj({ variants: arr(obj({ color: str(), size: str() })) }),
        pending: [pendingUpdate(moveColorIntoVariantItems)],
      },
      described: [
        { pointer: '/variants', change: 'changed' },
        { pointer: '/color', change: 'removed' },
      ],
    },
    {
      name: 'out of a File as added, and the File as changed',
      scenario: {
        head: obj({ cover: file() }),
        draft: obj({ cover: file(), name: str() }),
        pending: [pendingUpdate(moveFileNameOutOfCover)],
      },
      described: [
        { pointer: '/cover', change: 'changed' },
        { pointer: '/name', change: 'added' },
      ],
    },
    {
      name: 'into a File as removed, and the File as changed',
      scenario: {
        head: obj({ title: str(), cover: file() }),
        draft: obj({ cover: file() }),
        pending: [pendingUpdate(moveTitleIntoCover)],
      },
      described: [
        { pointer: '/cover', change: 'changed' },
        { pointer: '/title', change: 'removed' },
      ],
    },
  ])('describes a field moved $name', ({ scenario, described }) => {
    expect(describedChangesOf(analyzeStructure(scenario))).toEqual(described);
  });

  it('describes a File moved to the path of a removed object and rewritten inside as changed from its Head path', () => {
    const structure = analyzeStructure({
      head: obj({ asset: obj({ fileName: str() }), cover: file() }),
      draft: obj({ asset: file() }),
      pending: [
        pendingUpdate(removeField('asset')),
        pendingUpdate(moveField('cover', 'asset')),
        pendingUpdate(replaceAssetFileName),
      ],
    });

    expect(describedChangesOf(structure)).toEqual([
      { pointer: '/asset', change: 'changed', from: '/cover' },
      { pointer: '/asset/fileName', change: 'removed' },
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
