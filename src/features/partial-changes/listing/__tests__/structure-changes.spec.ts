import { arr, num, numFormula, obj, str } from '@revisium/schema-toolkit/mocks';
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
import type { UnitKind } from 'src/features/partial-changes/catalogue/unit';
import {
  type ChangedField,
  type ListedUnit,
  TABLE_CHANGES,
} from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import { FIELD_CHANGES } from 'src/features/partial-changes/structure/table-structure';
import type { UnitRef } from 'src/features/partial-changes/selection/unit-refs';
import { addressedUnitOfListed } from '../../__tests__/support/change-listing';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';

const CATEGORIES = 'categories';
const GROUPS = 'groups';
const MEMOS = 'memos';
const NOTES = 'notes';
const PRODUCTS = 'products';
const SCRATCH = 'scratch';
const TAGS = 'tags';

const categorySchema = obj({ title: str() });
const labelSchema = obj({ label: str() });
const addressSchema = obj({ city: str(), street: str() });
const productSchema = obj({
  code: str(),
  price: num(),
  address: addressSchema,
  variants: arr(obj({ color: str() })),
});

const addZipToAddress: JsonPatch = {
  op: 'add',
  path: '/properties/address/properties/zip',
  value: str(),
};
const addSizeToVariantItems: JsonPatch = {
  op: 'add',
  path: '/properties/variants/items/properties/size',
  value: str(),
};

describe('listChanges: structure changes', () => {
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

  describe('fields of a changed table', () => {
    const fieldCases: FieldCase[] = [
      {
        change: 'an added field',
        patches: [addField('sku', str())],
        fields: [{ path: '/sku', change: 'added' }],
      },
      {
        change: 'a removed field',
        patches: [removeField('price')],
        fields: [{ path: '/price', change: 'removed' }],
      },
      {
        change: 'a changed field type',
        patches: [replaceField('price', str())],
        fields: [{ path: '/price', change: 'changed' }],
      },
      {
        change:
          'a moved field as removed at its Head path and added at its Draft path',
        patches: [moveField('code', 'sku')],
        fields: [
          { path: '/code', change: 'removed' },
          { path: '/sku', change: 'added' },
        ],
      },
      {
        change: 'a field added to a nested object',
        patches: [addZipToAddress],
        fields: [{ path: '/address/zip', change: 'added' }],
      },
      {
        change:
          'a field added to the items of an array as a change of the array',
        patches: [addSizeToVariantItems],
        fields: [{ path: '/variants', change: 'changed' }],
      },
    ];

    it.each(fieldCases)(
      'describes $change by its data pointer',
      async ({ patches, fields }) => {
        const draft = await givenCommittedProducts();
        await draft.updateTable(PRODUCTS, patches);

        const structure = await listedStructureOf(draft, PRODUCTS);

        expect(structure.structureChange).toEqual({ table: 'changed', fields });
      },
    );

    it('covers every value of FIELD_CHANGES', () => {
      const changes = fieldCases.flatMap(({ fields }) =>
        fields.map(({ change }) => change),
      );

      expect(new Set(changes)).toEqual(new Set(FIELD_CHANGES));
    });

    it.each<{ change: string; updates: JsonPatch[][]; fields: ChangedField[] }>(
      [
        {
          change: 'a field whose later pending patch restored its Head schema',
          updates: [
            [replaceField('price', str())],
            [replaceField('price', num())],
          ],
          fields: [{ path: '/price', change: 'changed' }],
        },
        {
          change:
            'every field of an object a pending patch replaced with an equal schema',
          updates: [[replaceField('address', addressSchema)]],
          fields: [
            { path: '/address/city', change: 'changed' },
            { path: '/address/street', change: 'changed' },
          ],
        },
      ],
    )('lists $change as changed', async ({ updates, fields }) => {
      const draft = await givenCommittedProducts();

      for (const patches of updates) {
        await draft.updateTable(PRODUCTS, patches);
      }

      const structure = await listedStructureOf(draft, PRODUCTS);

      expect(structure.structureChange).toEqual({ table: 'changed', fields });
    });

    it('lists input and computed fields in code-point order of their paths', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateTable(PRODUCTS, [
        addField('total', numFormula('price * 2')),
        addField('Weight', num()),
        removeField('code'),
      ]);

      const structure = await listedStructureOf(draft, PRODUCTS);

      expect(structure.structureChange?.fields).toEqual([
        { path: '/Weight', change: 'added' },
        { path: '/code', change: 'removed' },
        { path: '/total', change: 'added' },
      ]);
    });
  });

  describe('tables', () => {
    const tableCases: TableCase[] = [
      {
        change: 'a created table as a whole',
        edit: (draft) => draft.createTable(TAGS, labelSchema),
        listed: {
          kind: 'structure',
          tableId: TAGS,
          selector: { tables: [TAGS] },
          structureChange: { table: 'created', fields: [] },
        },
      },
      {
        change: 'a removed table as a whole',
        edit: (draft) => draft.removeTable(CATEGORIES),
        listed: {
          kind: 'structure',
          tableId: CATEGORIES,
          selector: { tables: [CATEGORIES] },
          structureChange: { table: 'removed', fields: [] },
        },
      },
      {
        change: 'a renamed table with a field change as changed',
        edit: async (draft) => {
          await draft.renameTable(CATEGORIES, GROUPS);
          await draft.updateTable(GROUPS, [addField('color', str())]);
        },
        listed: {
          kind: 'structure',
          tableId: GROUPS,
          previousTableId: CATEGORIES,
          selector: { tables: [GROUPS] },
          structureChange: {
            table: 'changed',
            fields: [{ path: '/color', change: 'added' }],
          },
        },
      },
      {
        change: 'a removed table whose id was created again as replaced',
        edit: async (draft) => {
          await draft.removeTable(CATEGORIES);
          await draft.createTable(CATEGORIES, labelSchema);
        },
        listed: {
          kind: 'structure',
          tableId: CATEGORIES,
          selector: { tables: [CATEGORIES] },
          structureChange: { table: 'replaced', fields: [] },
        },
      },
      {
        change: 'a table created and removed inside the Draft as transient',
        edit: async (draft) => {
          await draft.createTable(SCRATCH, labelSchema);
          await draft.removeTable(SCRATCH);
        },
        listed: {
          kind: 'structure',
          tableId: SCRATCH,
          selector: { tables: [SCRATCH] },
          structureChange: { table: 'transient', fields: [] },
        },
      },
    ];

    it.each(tableCases)('describes $change', async ({ edit, listed }) => {
      const draft = await givenCommittedCategories();
      await edit(draft);

      const page = await draft.listChanges();

      expect(page.units).toEqual([listed]);
    });

    it('covers every value of TABLE_CHANGES', () => {
      const changes = tableCases.map(
        ({ listed }) => listed.structureChange?.table,
      );

      expect(new Set(changes)).toEqual(new Set(TABLE_CHANGES));
    });
  });

  describe('structure of other units', () => {
    it('refers a row unit to the structure unit of its table by a selector that resolves to exactly that unit', async () => {
      const draft = await givenCommittedCategories();
      await draft.updateTable(CATEGORIES, [addField('color', str())]);
      await draft.updateRow(CATEGORIES, 'c1', {
        title: 'edited',
        color: 'red',
      });

      const field = await listedUnitOf(draft, 'field');

      expect(field.structure).toEqual({
        kind: 'structure',
        tableId: CATEGORIES,
        selector: { tables: [CATEGORIES] },
      });
      await expectToResolveToExactly(draft, field.structure);
    });

    it('refers the rows of a table that took over a removed table id to the renamed table, and lists the removed one on the Head side', async () => {
      const draft = await givenCommittedNotesAndMemos();
      await draft.removeTable(NOTES);
      await draft.renameTable(MEMOS, NOTES);
      await draft.updateRow(NOTES, 'm1', { label: 'edited' });

      const [removed, renamed, field] = (await draft.listChanges()).units;

      expect(removed).toEqual({
        kind: 'structure',
        tableId: NOTES,
        side: 'head',
        selector: { tables: [{ tableId: NOTES, side: 'head' }] },
        structureChange: { table: 'removed', fields: [] },
      });
      expect(renamed).toEqual({
        kind: 'structure',
        tableId: NOTES,
        previousTableId: MEMOS,
        selector: { tables: [NOTES] },
        structureChange: { table: 'changed', fields: [] },
      });
      expect(field?.structure).toEqual({
        kind: 'structure',
        tableId: NOTES,
        previousTableId: MEMOS,
        selector: { tables: [NOTES] },
      });
      await expectToResolveToExactly(draft, removed);
      await expectToResolveToExactly(draft, field?.structure);
    });
  });

  async function expectToResolveToExactly(
    draft: ChangesScenario,
    unit: UnitRef | undefined,
  ): Promise<void> {
    if (!unit) {
      throw new Error('The listing gave no unit to resolve');
    }

    await expect(draft.resolveSelection(unit.selector)).resolves.toEqual({
      selected: [addressedUnitOfListed(unit)],
      excluded: [],
      required: [],
      blockers: [],
      unmatched: {},
    });
  }

  async function listedStructureOf(
    draft: ChangesScenario,
    tableId: string,
  ): Promise<ListedUnit> {
    const { units } = await draft.listChanges({ tableId });

    return unitOfKind(units, 'structure');
  }

  async function listedUnitOf(
    draft: ChangesScenario,
    kind: UnitKind,
  ): Promise<ListedUnit> {
    const { units } = await draft.listChanges();

    return unitOfKind(units, kind);
  }

  function givenCommittedProducts(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: {
          p1: {
            code: 'p1',
            price: 1,
            address: { city: 'Riga', street: 'Main' },
            variants: [{ color: 'red' }],
          },
        },
      },
    });
  }

  function givenCommittedCategories(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
    });
  }

  function givenCommittedNotesAndMemos(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [MEMOS]: { schema: labelSchema, rows: { m1: { label: 'one' } } },
      [NOTES]: { schema: labelSchema, rows: { n1: { label: 'one' } } },
    });
  }
});

interface FieldCase {
  readonly change: string;
  readonly patches: JsonPatch[];
  readonly fields: ChangedField[];
}

interface TableCase {
  readonly change: string;
  readonly edit: (draft: ChangesScenario) => Promise<void>;
  readonly listed: ListedUnit;
}

function unitOfKind(units: readonly ListedUnit[], kind: UnitKind): ListedUnit {
  const unit = units.find((listed) => listed.kind === kind);

  if (!unit) {
    throw new Error(`The listing has no ${kind} unit`);
  }

  return unit;
}
