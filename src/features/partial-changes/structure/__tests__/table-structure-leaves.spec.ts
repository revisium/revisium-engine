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
  annotatedObjectsOf,
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
const replaceCoverFileName: JsonPatch = {
  op: 'replace',
  path: '/properties/cover/properties/fileName',
  value: str(),
};
const addCustomIntoCover: JsonPatch = {
  op: 'add',
  path: '/properties/cover/properties/custom',
  value: obj({ x: str() }),
};
const moveCustomOutOfCover: JsonPatch = {
  op: 'move',
  from: '/properties/cover/properties/custom',
  path: '/properties/extracted',
};
const moveTitleIntoExtracted: JsonPatch = {
  op: 'move',
  from: '/properties/title',
  path: '/properties/extracted/properties/newTitle',
};
const file = () => ref(SystemSchemaIds.File);

const codeAndPrice = obj({ code: str(), price: num() });
const coverAndTitle = obj({ cover: file(), title: str() });
const coverAndExtracted = obj({
  cover: file(),
  extracted: obj({ x: str(), newTitle: str() }),
});

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
      name: 'a pending patch replaced a field inside its File',
      scenario: {
        head: coverAndTitle,
        draft: coverAndTitle,
        pending: [pendingUpdate(replaceCoverFileName)],
      },
      leaf: '/cover',
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
    head: JsonSchema;
    draft: JsonSchema;
    pending: Migration[];
    structureBound: string[];
    unchanged: string[];
  }>([
    {
      name: 'the source and the target of a move',
      head: codeAndPrice,
      draft: obj({ sku: str(), price: num() }),
      pending: [pendingUpdate(moveField('code', 'sku'))],
      structureBound: ['/sku', '/code'],
      unchanged: ['/price'],
    },
    {
      name: 'the pointer of a move reverted inside the Draft',
      head: codeAndPrice,
      draft: obj({ code: str(), price: num() }),
      pending: [
        pendingUpdate(moveField('code', 'sku')),
        pendingUpdate(moveField('sku', 'code')),
      ],
      structureBound: ['/code'],
      unchanged: ['/price'],
    },
    {
      name: 'the fields of one migration that moves a field into an object taken out of a File',
      head: coverAndTitle,
      draft: coverAndExtracted,
      pending: [
        pendingUpdate(
          addCustomIntoCover,
          moveCustomOutOfCover,
          moveTitleIntoExtracted,
        ),
      ],
      structureBound: [
        '/cover',
        '/extracted/x',
        '/extracted/newTitle',
        '/title',
      ],
      unchanged: [],
    },
  ])(
    'keeps $name structure-bound',
    ({ head, draft, pending, structureBound, unchanged }) => {
      const structure = analyzeStructure({ head, draft, pending });

      expect(changedPointersOf(structure)).toEqual(structureBound);
      expect(unchangedPointersOf(structure)).toEqual(unchanged);
    },
  );

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

  it('describes a field moved into an object that the same migration took out of a File as moved from its Head path', () => {
    const structure = analyzeStructure({
      head: coverAndTitle,
      draft: coverAndExtracted,
      pending: [
        pendingUpdate(
          addCustomIntoCover,
          moveCustomOutOfCover,
          moveTitleIntoExtracted,
        ),
      ],
    });

    expect(describedChangesOf(structure)).toEqual([
      { pointer: '/cover', change: 'changed' },
      { pointer: '/extracted/x', change: 'added' },
      { pointer: '/extracted/newTitle', change: 'moved', from: '/title' },
    ]);
  });
});

describe('TableStructure: annotating replaces', () => {
  it.each<{ name: string; scenario: StructureScenario; pointer: string }>([
    {
      name: 'a published-at field replaced with a string and back',
      pointer: '/releasedAt',
      scenario: {
        head: obj({ releasedAt: ref(SystemSchemaIds.RowPublishedAt) }),
        draft: obj({ releasedAt: ref(SystemSchemaIds.RowPublishedAt) }),
        pending: [
          pendingUpdate(replaceField('releasedAt', str())),
          pendingUpdate(
            replaceField('releasedAt', ref(SystemSchemaIds.RowPublishedAt)),
          ),
        ],
      },
    },
    {
      name: 'a system field switched to another system field and back',
      pointer: '/stamp',
      scenario: {
        head: obj({ stamp: ref(SystemSchemaIds.RowCreatedAt) }),
        draft: obj({ stamp: ref(SystemSchemaIds.RowCreatedAt) }),
        pending: [
          pendingUpdate(
            replaceField('stamp', ref(SystemSchemaIds.RowUpdatedAt)),
          ),
          pendingUpdate(
            replaceField('stamp', ref(SystemSchemaIds.RowCreatedAt)),
          ),
        ],
      },
    },
  ])(
    'describes $name as changed, since a $ref is no annotation (AS-60c)',
    ({ scenario, pointer }) => {
      expect(describedChangesOf(analyzeStructure(scenario))).toEqual([
        { pointer, change: 'changed' },
      ]);
    },
  );
});

describe('TableStructure: pending migrations that do not replay', () => {
  it.each<{
    name: string;
    scenario: StructureScenario;
    described: DescribedChange[];
  }>([
    {
      name: 'a patch addresses no field',
      scenario: {
        head: codeAndPrice,
        draft: obj({ sku: str(), price: num() }),
        pending: [
          pendingUpdate(moveField('code', 'sku'), removeField('stock')),
        ],
      },
      described: [
        { pointer: '/sku', change: 'added' },
        { pointer: '/code', change: 'removed' },
      ],
    },
    {
      name: 'the patches that take a field out of a File are split across migrations, which native refuses',
      scenario: {
        head: coverAndTitle,
        draft: coverAndExtracted,
        pending: [
          pendingUpdate(addCustomIntoCover),
          pendingUpdate(moveCustomOutOfCover),
          pendingUpdate(moveTitleIntoExtracted),
        ],
      },
      described: [
        { pointer: '/extracted/x', change: 'added' },
        { pointer: '/extracted/newTitle', change: 'added' },
        { pointer: '/title', change: 'removed' },
      ],
    },
  ])(
    'compares the leaves of Head and Draft without moves when $name',
    ({ scenario, described }) => {
      expect(describedChangesOf(analyzeStructure(scenario))).toEqual(described);
    },
  );

  it('describes a leaf whose Head and Draft schemas differ only in a validating annotation as annotated, and no object, when the patches do not replay (AS-60c)', () => {
    const structure = analyzeStructure({
      head: obj({
        code: str({ default: 'none' }),
        price: num(),
        address: obj({ city: str() }),
      }),
      draft: obj({
        code: str(),
        price: num({ description: 'In euros' }),
        address: obj({ city: str() }, { description: 'Where to ship' }),
      }),
      pending: [pendingUpdate(removeField('stock'))],
    });

    expect(describedChangesOf(structure)).toEqual([
      { pointer: '/code', change: 'annotated', annotations: ['default'] },
    ]);
    expect(annotatedObjectsOf(structure)).toEqual([]);
  });

  it('keeps the leaf that a patch path names structure-bound', () => {
    const structure = analyzeStructure({
      head: codeAndPrice,
      draft: codeAndPrice,
      pending: [
        pendingUpdate(replaceField('price', num()), removeField('stock')),
      ],
    });

    expect(changedPointersOf(structure)).toEqual(['/price']);
    expect(unchangedPointersOf(structure)).toEqual(['/code']);
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
