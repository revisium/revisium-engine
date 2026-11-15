import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { arr, num, obj, ref, str } from '@revisium/schema-toolkit/mocks';
import type { JsonPatch } from '@revisium/schema-toolkit/types';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import {
  addField,
  moveField,
  removeField,
  replaceField,
} from 'src/__tests__/fixtures/ledger-steps';
import type {
  ChangedField,
  StructureChange,
} from 'src/features/partial-changes/catalogue/structure-changes';
import type { DescribedUnitRef } from 'src/features/partial-changes/selection/unit-refs';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { rowItemsOf } from '../../__tests__/support/draft-reading';

const CATEGORIES = 'categories';
const GROUPS = 'groups';
const ITEMS = 'items';
const PRODUCTS = 'products';
const TAGS = 'tags';

const addressSchema = obj({ city: str(), street: str() });
const variantsSchema = arr(obj({ color: str() }));
const sizedVariantsSchema = arr(obj({ color: str(), size: num() }));
const addSizeToVariantItems: JsonPatch = {
  op: 'add',
  path: '/properties/variants/items/properties/size',
  value: num(),
};
const productSchema = obj({
  code: str(),
  price: num(),
  address: addressSchema,
  variants: variantsSchema,
});
const productRow = {
  code: 'p1',
  price: 1,
  address: { city: 'Riga', street: 'Main' },
  variants: [{ color: 'red' }],
};

const categorySchema = obj({ title: str() });
const itemSchema = obj({ category: str(), group: str({ foreignKey: GROUPS }) });

interface SchemaCase {
  readonly change: string;
  readonly updates: JsonPatch[][];
  readonly fields: ChangedField[];
}

describe('what a changed field of a structure change holds', () => {
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

  describe('a changed table', () => {
    it.each<SchemaCase>([
      {
        change: 'a field whose type changed by its Head and Draft schema',
        updates: [[replaceField('price', str())]],
        fields: [
          { path: '/price', change: 'changed', before: num(), after: str() },
        ],
      },
      {
        change: 'an added field by its Draft schema alone',
        updates: [[addField('sku', str())]],
        fields: [{ path: '/sku', change: 'added', after: str() }],
      },
      {
        change: 'a removed field by its Head schema alone',
        updates: [[removeField('price')]],
        fields: [{ path: '/price', change: 'removed', before: num() }],
      },
      {
        change: 'a moved field with an unchanged schema by its Head path alone',
        updates: [[moveField('code', 'sku')]],
        fields: [{ path: '/sku', change: 'moved', from: '/code' }],
      },
      {
        change:
          'a moved field whose type changed by its Head path and both schemas',
        updates: [[moveField('price', 'cost')], [replaceField('cost', str())]],
        fields: [
          {
            path: '/cost',
            change: 'changed',
            from: '/price',
            before: num(),
            after: str(),
          },
        ],
      },
      {
        change:
          'an annotated field by its annotations and both schemas, which hold their values',
        updates: [[replaceField('price', num({ description: 'In euros' }))]],
        fields: [
          {
            path: '/price',
            change: 'annotated',
            annotations: ['description'],
            before: num(),
            after: num({ description: 'In euros' }),
          },
        ],
      },
      {
        change:
          'an annotated object by the own keywords of its schemas, without its fields',
        updates: [
          [
            replaceField(
              'address',
              obj({ city: str(), street: str() }, { title: 'Address' }),
            ),
          ],
        ],
        fields: [
          {
            path: '/address',
            change: 'annotated',
            annotations: ['title'],
            before: { type: 'object' },
            after: { type: 'object', title: 'Address' },
          },
        ],
      },
      {
        change:
          'the fields of an object replaced with an equal schema as changed by equal schemas, since the patch rewrote their values',
        updates: [[replaceField('address', addressSchema)]],
        fields: [
          {
            path: '/address/city',
            change: 'changed',
            before: str(),
            after: str(),
          },
          {
            path: '/address/street',
            change: 'changed',
            before: str(),
            after: str(),
          },
        ],
      },
      {
        change: 'an array field by its whole schema, items included',
        updates: [[addSizeToVariantItems]],
        fields: [
          {
            path: '/variants',
            change: 'changed',
            before: variantsSchema,
            after: sizedVariantsSchema,
          },
        ],
      },
    ])('describes $change', async ({ updates, fields }) => {
      const draft = await givenCommittedProducts();

      for (const patches of updates) {
        await draft.updateTable(PRODUCTS, patches);
      }

      expect(await structureChangeOf(draft, PRODUCTS)).toEqual({
        table: 'changed',
        fields,
        views: false,
      });
    });

    it.each<SchemaCase>([
      {
        change:
          'an object that became a text field as the added field and the removed fields of the object',
        updates: [[replaceField('address', str())]],
        fields: [
          { path: '/address', change: 'added', after: str() },
          { path: '/address/city', change: 'removed', before: str() },
          { path: '/address/street', change: 'removed', before: str() },
        ],
      },
      {
        change:
          'a number field that became an object as the removed field and the added fields of the object',
        updates: [[replaceField('price', obj({ amount: num() }))]],
        fields: [
          { path: '/price', change: 'removed', before: num() },
          { path: '/price/amount', change: 'added', after: num() },
        ],
      },
      {
        change: 'a text field that became an array as changed by both schemas',
        updates: [[replaceField('code', arr(str()))]],
        fields: [
          {
            path: '/code',
            change: 'changed',
            before: str(),
            after: arr(str()),
          },
        ],
      },
      {
        change:
          'an array that became an object as the removed array and the added fields of the object',
        updates: [[replaceField('variants', obj({ color: str() }))]],
        fields: [
          { path: '/variants', change: 'removed', before: variantsSchema },
          { path: '/variants/color', change: 'added', after: str() },
        ],
      },
    ])('describes $change', async ({ updates, fields }) => {
      const draft = await givenCommittedProducts();

      for (const patches of updates) {
        await draft.updateTable(PRODUCTS, patches);
      }

      expect(await structureChangeOf(draft, PRODUCTS)).toEqual({
        table: 'changed',
        fields,
        views: false,
      });
    });

    it('describes a default that an update reset by the old and the new default', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [PRODUCTS]: { schema: obj({ code: str({ default: 'none' }) }) },
      });
      await draft.updateTable(PRODUCTS, [addField('sku', str())]);

      expect(await structureChangeOf(draft, PRODUCTS)).toEqual({
        table: 'changed',
        fields: [
          {
            path: '/code',
            change: 'annotated',
            annotations: ['default'],
            before: str({ default: 'none' }),
            after: str(),
          },
          { path: '/sku', change: 'added', after: str() },
        ],
        views: false,
      });
    });

    it.each<{ change: string; field: string; foreignKey: string }>([
      {
        change: 'a reference given to a text field',
        field: 'category',
        foreignKey: CATEGORIES,
      },
      {
        change: 'a reference pointed at another table',
        field: 'group',
        foreignKey: CATEGORIES,
      },
    ])(
      'describes $change by the referenced table of each side',
      async ({ field, foreignKey }) => {
        const draft = await givenCommittedItems();
        await draft.updateTable(ITEMS, [
          replaceField(field, str({ foreignKey })),
        ]);

        const structure = await structureChangeOf(draft, ITEMS);

        expect(structure.fields).toEqual([
          {
            path: `/${field}`,
            change: 'changed',
            before: itemSchema.properties[field],
            after: str({ foreignKey }),
          },
        ]);
      },
    );

    it('describes a File field by its reference schema', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateTable(PRODUCTS, [
        addField('cover', ref(SystemSchemaIds.File)),
      ]);

      expect((await structureChangeOf(draft, PRODUCTS)).fields).toEqual([
        { path: '/cover', change: 'added', after: ref(SystemSchemaIds.File) },
      ]);
    });
  });

  it('gives each description its own schemas, so a caller that edits one changes no other', async () => {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: productRow, p2: { ...productRow, code: 'p2' } },
      },
    });
    await draft.updateTable(PRODUCTS, [replaceField('price', str())]);

    const [first, second] = await rowStructuresOf(draft);
    const edited = first?.fields[0]?.after as Record<string, unknown>;
    edited.type = 'number';

    expect(second?.fields).toEqual([
      { path: '/price', change: 'changed', before: num(), after: str() },
    ]);
  });

  describe('a replaced table', () => {
    it('describes each field by the schema of the removed Head table and of the created Draft table', async () => {
      const draft = await givenCommittedProducts();
      await draft.removeTable(PRODUCTS);
      await draft.createTable(
        PRODUCTS,
        obj({
          code: str({ default: 'none' }),
          price: str(),
          sku: str(),
          address: addressSchema,
          variants: variantsSchema,
        }),
      );

      expect(await structureChangeOf(draft, PRODUCTS)).toEqual({
        table: 'replaced',
        fields: [
          {
            path: '/code',
            change: 'annotated',
            annotations: ['default'],
            before: str(),
            after: str({ default: 'none' }),
          },
          { path: '/price', change: 'changed', before: num(), after: str() },
          { path: '/sku', change: 'added', after: str() },
        ],
        views: false,
      });
    });
  });

  describe('a created or removed table', () => {
    it.each<{
      change: string;
      edit: (draft: ChangesScenario) => Promise<void>;
      table: StructureChange['table'];
    }>([
      {
        change: 'a created table',
        edit: (draft) => draft.createTable(TAGS, obj({ label: str() })),
        table: 'created',
      },
      {
        change: 'a removed table',
        edit: (draft) => draft.removeTable(PRODUCTS),
        table: 'removed',
      },
    ])(
      'describes $change as a whole, without a field',
      async ({ edit, table }) => {
        const draft = await givenCommittedProducts();
        await edit(draft);

        const units = await draft.listEveryUnit();

        expect(structureUnitsOf(units)).toEqual([
          { table, fields: [], views: false },
        ]);
      },
    );
  });

  function givenCommittedProducts(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: { schema: productSchema, rows: { p1: productRow } },
    });
  }

  function givenCommittedItems(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: {} },
      [GROUPS]: { schema: categorySchema, rows: {} },
      [ITEMS]: { schema: itemSchema, rows: {} },
    });
  }
});

async function rowStructuresOf(
  draft: ChangesScenario,
): Promise<StructureChange[]> {
  const items = rowItemsOf([await draft.readDraftRowChanges({ first: 100 })]);

  return items.flatMap(({ selection }) =>
    selection.state === 'goesWith' && selection.unit.structureChange
      ? [selection.unit.structureChange]
      : [],
  );
}

async function structureChangeOf(
  draft: ChangesScenario,
  tableId: string,
): Promise<StructureChange> {
  const { units } = await draft.readUnitList({ tableId });
  const [structureChange] = structureUnitsOf(units);

  if (!structureChange) {
    throw new Error(`The table ${tableId} has no structure unit`);
  }

  return structureChange;
}

function structureUnitsOf(
  units: readonly DescribedUnitRef[],
): StructureChange[] {
  return units.flatMap(({ structureChange }) =>
    structureChange ? [structureChange] : [],
  );
}
