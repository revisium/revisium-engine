import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  arr,
  num,
  numFormula,
  obj,
  ref,
  str,
} from '@revisium/schema-toolkit/mocks';
import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
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
  STRUCTURE_TABLE_CHANGES,
} from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import { ANNOTATION_KEYWORDS } from 'src/features/partial-changes/structure/normalized-leaf-schema';
import { STRUCTURE_FIELD_CHANGES } from 'src/features/partial-changes/structure/table-structure';
import type { UnitRef } from 'src/features/partial-changes/selection/unit-refs';
import { addressedUnitOfListed } from '../../__tests__/support/change-listing';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';

const ALBUMS = 'albums';
const CATEGORIES = 'categories';
const GROUPS = 'groups';
const ITEMS = 'items';
const MEDIA = 'media';
const MEMOS = 'memos';
const NOTES = 'notes';
const PRODUCTS = 'products';
const SCRATCH = 'scratch';
const SHIPMENTS = 'shipments';
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

const describedAddressSchema = obj(
  { city: str(), street: str() },
  { description: 'Where to ship' },
);
const parcelsSchema = arr(obj({ weight: num() }));
const shipmentSchema = obj({
  code: str(),
  shipping: obj({ address: addressSchema, parcels: parcelsSchema }),
});

const mediaSchema = obj({ title: str(), cover: ref(SystemSchemaIds.File) });
const albumSchema = obj({
  album: obj({ cover: ref(SystemSchemaIds.File), name: str() }),
});

const emptyFile = {
  status: '',
  fileId: '',
  url: '',
  fileName: '',
  hash: '',
  extension: '',
  mimeType: '',
  size: 0,
  width: 0,
  height: 0,
};

const productRow = {
  code: 'p1',
  price: 1,
  address: { city: 'Riga', street: 'Main' },
  variants: [{ color: 'red' }],
};

const addZipToAddress: JsonPatch = {
  op: 'add',
  path: '/properties/address/properties/zip',
  value: str(),
};
const removeStreetFromAddress: JsonPatch = {
  op: 'remove',
  path: '/properties/address/properties/street',
};
const addSizeToVariantItems: JsonPatch = {
  op: 'add',
  path: '/properties/variants/items/properties/size',
  value: str(),
};
const describeVariantItems: JsonPatch = {
  op: 'replace',
  path: '/properties/variants/items',
  value: obj({ color: str() }, { description: 'A colour variant' }),
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
        change: 'a field moved to another path',
        patches: [moveField('code', 'sku')],
        fields: [{ path: '/sku', change: 'moved', from: '/code' }],
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
      {
        change: 'a field whose description changed',
        patches: [replaceField('price', num({ description: 'In euros' }))],
        fields: [
          { path: '/price', change: 'annotated', annotations: ['description'] },
        ],
      },
    ];

    it.each(fieldCases)(
      'describes $change by its data pointer',
      async ({ patches, fields }) => {
        const draft = await givenCommittedProducts();
        await draft.updateTable(PRODUCTS, patches);

        const structure = await listedStructureOf(draft, PRODUCTS);

        expect(structure.structureChange).toEqual({
          table: 'changed',
          fields,
          views: false,
        });
      },
    );

    it('covers every value of STRUCTURE_FIELD_CHANGES', () => {
      const changes = fieldCases.flatMap(({ fields }) =>
        fields.map(({ change }) => change),
      );

      expect(new Set(changes)).toEqual(new Set(STRUCTURE_FIELD_CHANGES));
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

      expect(structure.structureChange).toEqual({
        table: 'changed',
        fields,
        views: false,
      });
    });

    it.each<{ change: string; updates: JsonPatch[][]; fields: ChangedField[] }>(
      [
        {
          change:
            'a moved field whose type changed as changed from its Head path',
          updates: [
            [moveField('price', 'cost')],
            [replaceField('cost', str())],
          ],
          fields: [{ path: '/cost', change: 'changed', from: '/price' }],
        },
        {
          change: 'a field moved twice as moved from its first path',
          updates: [[moveField('code', 'sku')], [moveField('sku', 'article')]],
          fields: [{ path: '/article', change: 'moved', from: '/code' }],
        },
        {
          change: 'a field added where a moved field was as added',
          updates: [[moveField('code', 'sku')], [addField('code', num())]],
          fields: [
            { path: '/code', change: 'added' },
            { path: '/sku', change: 'moved', from: '/code' },
          ],
        },
        {
          change: 'every field of a moved object as moved from its Head path',
          updates: [[moveField('address', 'location')]],
          fields: [
            { path: '/location/city', change: 'moved', from: '/address/city' },
            {
              path: '/location/street',
              change: 'moved',
              from: '/address/street',
            },
          ],
        },
        {
          change: 'a move reverted inside the Draft as no field',
          updates: [[moveField('code', 'sku')], [moveField('sku', 'code')]],
          fields: [],
        },
      ],
    )('describes $change', async ({ updates, fields }) => {
      const draft = await givenCommittedProducts();

      for (const patches of updates) {
        await draft.updateTable(PRODUCTS, patches);
      }

      const structure = await listedStructureOf(draft, PRODUCTS);

      expect(structure.structureChange).toEqual({
        table: 'changed',
        fields,
        views: false,
      });
    });

    it.each<{ change: string; updates: JsonPatch[][]; fields: ChangedField[] }>(
      [
        {
          change:
            'a field replaced with another default, which the stored schema does not keep, as no field',
          updates: [[replaceField('code', str({ default: 'none' }))]],
          fields: [],
        },
        {
          change:
            'a field given a title and a description as annotated by both, in code-point order',
          updates: [
            [
              replaceField(
                'code',
                str({ title: 'Code', description: 'Article code' }),
              ),
            ],
          ],
          fields: [
            {
              path: '/code',
              change: 'annotated',
              annotations: ['description', 'title'],
            },
          ],
        },
        {
          change: 'a field given a title and deprecated as annotated by both',
          updates: [
            [replaceField('code', str({ title: 'Code', deprecated: true }))],
          ],
          fields: [
            {
              path: '/code',
              change: 'annotated',
              annotations: ['deprecated', 'title'],
            },
          ],
        },
        {
          change:
            'a field whose description was changed twice as annotated by its description',
          updates: [
            [replaceField('code', str({ description: 'Code' }))],
            [replaceField('code', str({ description: 'Article code' }))],
          ],
          fields: [
            {
              path: '/code',
              change: 'annotated',
              annotations: ['description'],
            },
          ],
        },
        {
          change: 'a field made read-only and given a media type as annotated',
          updates: [
            [
              replaceField(
                'code',
                str({ readOnly: true, contentMediaType: 'text/markdown' }),
              ),
            ],
          ],
          fields: [
            {
              path: '/code',
              change: 'annotated',
              annotations: ['contentMediaType', 'readOnly'],
            },
          ],
        },
        {
          change:
            'an object whose description changed as that object annotated by its description, and none of its unchanged fields',
          updates: [[replaceField('address', describedAddressSchema)]],
          fields: [
            {
              path: '/address',
              change: 'annotated',
              annotations: ['description'],
            },
          ],
        },
        {
          change:
            'a field added to an object that a later patch gave a description as the annotated object and the added field',
          updates: [
            [addZipToAddress],
            [
              replaceField(
                'address',
                obj(
                  { city: str(), street: str(), zip: str() },
                  { description: 'Where to ship' },
                ),
              ),
            ],
          ],
          fields: [
            {
              path: '/address',
              change: 'annotated',
              annotations: ['description'],
            },
            { path: '/address/zip', change: 'added' },
          ],
        },
        {
          change:
            'an object that lost a field and then got a description as the annotated object and the removed field',
          updates: [
            [removeStreetFromAddress],
            [
              replaceField(
                'address',
                obj({ city: str() }, { description: 'Where to ship' }),
              ),
            ],
          ],
          fields: [
            {
              path: '/address',
              change: 'annotated',
              annotations: ['description'],
            },
            { path: '/address/street', change: 'removed' },
          ],
        },
        {
          change:
            'a field given a description by a replace of its object as that field alone',
          updates: [
            [
              replaceField(
                'address',
                obj({ city: str({ description: 'Town' }), street: str() }),
              ),
            ],
          ],
          fields: [
            {
              path: '/address/city',
              change: 'annotated',
              annotations: ['description'],
            },
          ],
        },
        {
          change:
            'an object and one of its fields given descriptions and a title as both, each by its own keywords',
          updates: [
            [
              replaceField(
                'address',
                obj(
                  { city: str({ description: 'Town' }), street: str() },
                  { title: 'Address', description: 'Where to ship' },
                ),
              ),
            ],
          ],
          fields: [
            {
              path: '/address',
              change: 'annotated',
              annotations: ['description', 'title'],
            },
            {
              path: '/address/city',
              change: 'annotated',
              annotations: ['description'],
            },
          ],
        },
        {
          change:
            'an array whose item field got a description as annotated by that keyword',
          updates: [
            [
              replaceField(
                'variants',
                arr(obj({ color: str({ description: 'Colour' }) })),
              ),
            ],
          ],
          fields: [
            {
              path: '/variants',
              change: 'annotated',
              annotations: ['description'],
            },
          ],
        },
        {
          change:
            'the items of an array given a description as a change of the array',
          updates: [[describeVariantItems]],
          fields: [{ path: '/variants', change: 'changed' }],
        },
        {
          change:
            'an array whose item object got a description through a replace of the array as the array annotated by that keyword',
          updates: [
            [
              replaceField(
                'variants',
                arr(obj({ color: str() }, { description: 'A colour variant' })),
              ),
            ],
          ],
          fields: [
            {
              path: '/variants',
              change: 'annotated',
              annotations: ['description'],
            },
          ],
        },
        {
          change: 'a field whose default and type changed as changed',
          updates: [[replaceField('price', str({ default: 'free' }))]],
          fields: [{ path: '/price', change: 'changed' }],
        },
        {
          change:
            'a field whose type changed and was restored with a description as changed',
          updates: [
            [replaceField('price', str())],
            [replaceField('price', num({ description: 'In euros' }))],
          ],
          fields: [{ path: '/price', change: 'changed' }],
        },
        {
          change:
            'a moved object that a later patch gave a description as its changed leaves and no object',
          updates: [
            [moveField('address', 'location')],
            [replaceField('location', describedAddressSchema)],
          ],
          fields: [
            {
              path: '/location/city',
              change: 'changed',
              from: '/address/city',
            },
            {
              path: '/location/street',
              change: 'changed',
              from: '/address/street',
            },
          ],
        },
        {
          change:
            'a moved field whose description changed as changed from its Head path',
          updates: [
            [moveField('code', 'sku')],
            [replaceField('sku', str({ description: 'Article' }))],
          ],
          fields: [{ path: '/sku', change: 'changed', from: '/code' }],
        },
      ],
    )('describes $change (AS-60c)', async ({ updates, fields }) => {
      const draft = await givenCommittedProducts();

      for (const patches of updates) {
        await draft.updateTable(PRODUCTS, patches);
      }

      const structure = await listedStructureOf(draft, PRODUCTS);

      expect(structure.structureChange).toEqual({
        table: 'changed',
        fields,
        views: false,
      });
    });

    it('describes a field whose stored default changed as annotated by its default (AS-60c)', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [PRODUCTS]: {
          schema: obj({ code: str({ default: 'none' }), price: num() }),
        },
      });
      await draft.updateTable(PRODUCTS, [
        replaceField('code', str({ default: 'unknown' })),
      ]);

      const structure = await listedStructureOf(draft, PRODUCTS);

      expect(structure.structureChange).toEqual({
        table: 'changed',
        fields: [
          { path: '/code', change: 'annotated', annotations: ['default'] },
        ],
        views: false,
      });
    });

    it.each<{ change: string; shipping: JsonSchema; fields: ChangedField[] }>([
      {
        change: 'an outer object given a description as that object alone',
        shipping: obj(
          { address: addressSchema, parcels: parcelsSchema },
          { description: 'How it travels' },
        ),
        fields: [
          {
            path: '/shipping',
            change: 'annotated',
            annotations: ['description'],
          },
        ],
      },
      {
        change: 'an inner object given a description as the inner object alone',
        shipping: obj({
          address: describedAddressSchema,
          parcels: parcelsSchema,
        }),
        fields: [
          {
            path: '/shipping/address',
            change: 'annotated',
            annotations: ['description'],
          },
        ],
      },
      {
        change:
          'an outer and an inner object given descriptions as both objects',
        shipping: obj(
          { address: describedAddressSchema, parcels: parcelsSchema },
          { description: 'How it travels' },
        ),
        fields: [
          {
            path: '/shipping',
            change: 'annotated',
            annotations: ['description'],
          },
          {
            path: '/shipping/address',
            change: 'annotated',
            annotations: ['description'],
          },
        ],
      },
      {
        change:
          'the item object of an array inside an object given a description as the array',
        shipping: obj({
          address: addressSchema,
          parcels: arr(obj({ weight: num() }, { description: 'One box' })),
        }),
        fields: [
          {
            path: '/shipping/parcels',
            change: 'annotated',
            annotations: ['description'],
          },
        ],
      },
    ])(
      'describes in nested objects $change (AS-60c)',
      async ({ shipping, fields }) => {
        const draft = await givenCommittedShipments();
        await draft.updateTable(SHIPMENTS, [
          replaceField('shipping', shipping),
        ]);

        const structure = await listedStructureOf(draft, SHIPMENTS);

        expect(structure.structureChange).toEqual({
          table: 'changed',
          fields,
          views: false,
        });
      },
    );

    it.each([
      {
        change: 'a field below an object whose description changed',
        patches: [replaceField('address', describedAddressSchema)],
        editedRow: {
          ...productRow,
          address: { city: 'Tallinn', street: 'Main' },
        },
        path: '/address/city',
      },
      {
        change: 'an annotated field',
        patches: [replaceField('code', str({ description: 'Article' }))],
        editedRow: { ...productRow, code: 'edited' },
        path: '/code',
      },
    ])(
      'keeps the values of $change with the structure unit, which a field selector requires (AS-60c)',
      async ({ patches, editedRow, path }) => {
        const draft = await givenCommittedProducts();
        await draft.updateTable(PRODUCTS, patches);
        await draft.updateRow(PRODUCTS, 'p1', editedRow);

        const { units } = await draft.listChanges({ tableId: PRODUCTS });
        const preview = await draft.previewChanges({
          operation: 'commit',
          selection: { fields: [{ tableId: PRODUCTS, rowId: 'p1', path }] },
        });

        expect(units.map(addressedUnitOfListed)).toEqual([
          { kind: 'structure', tableId: PRODUCTS },
        ]);
        expect(preview).toMatchObject({
          status: 'required',
          required: [
            {
              unit: { kind: 'structure', tableId: PRODUCTS },
              reason: { code: 'structureBoundData', path },
            },
          ],
        });
      },
    );

    it.each([
      { operation: 'commit', side: 'head', code: 'edited', city: 'Tallinn' },
      { operation: 'revert', side: 'draft', code: 'p1', city: 'Riga' },
    ] as const)(
      'applies the values of annotated fields and objects with the structure on $operation (AS-60c)',
      async ({ operation, side, code, city }) => {
        const draft = await givenCommittedProducts();
        await draft.updateTable(PRODUCTS, [
          replaceField('code', str({ description: 'Article' })),
          replaceField('address', describedAddressSchema),
        ]);
        await draft.updateRow(PRODUCTS, 'p1', {
          ...productRow,
          code: 'edited',
          address: { city: 'Tallinn', street: 'Main' },
        });
        const options = {
          selection: { structures: [{ tableId: PRODUCTS }] },
        };

        const result =
          operation === 'commit'
            ? await draft.commitChanges(options)
            : await draft.revertChanges(options);

        expect(result).toMatchObject({ status: 'applied' });
        expect(
          (await draft.rows(side, PRODUCTS)).map(({ data }) => data),
        ).toEqual([{ ...productRow, code, address: { city, street: 'Main' } }]);
      },
    );

    it.each<{
      change: string;
      updates: JsonPatch[][];
      fields: ChangedField[];
    }>([
      {
        change:
          'an object removed and added again with a description as its fields and no object',
        updates: [
          [removeField('address')],
          [addField('address', describedAddressSchema)],
        ],
        fields: [
          { path: '/address/city', change: 'changed' },
          { path: '/address/street', change: 'changed' },
        ],
      },
      {
        change:
          'an object replaced with its own schema with unsorted required and a description as the annotated object alone',
        updates: [
          [
            replaceField('address', {
              ...describedAddressSchema,
              required: ['street', 'city'],
            } as JsonSchema),
          ],
        ],
        fields: [
          {
            path: '/address',
            change: 'annotated',
            annotations: ['description'],
          },
        ],
      },
    ])('describes $change (AS-60c)', async ({ updates, fields }) => {
      const draft = await givenCommittedProducts();

      for (const patches of updates) {
        await draft.updateTable(PRODUCTS, patches);
      }

      const structure = await listedStructureOf(draft, PRODUCTS);

      expect(structure.structureChange).toEqual({
        table: 'changed',
        fields,
        views: false,
      });
    });

    it('describes an object one replace gave a field and a description as the annotated object, the added field and its rewritten fields (AS-60c)', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [PRODUCTS]: { schema: productSchema, rows: {} },
      });
      await draft.updateTable(PRODUCTS, [
        replaceField(
          'address',
          obj(
            { city: str(), street: str(), zip: str() },
            { description: 'Where to ship' },
          ),
        ),
      ]);

      const structure = await listedStructureOf(draft, PRODUCTS);

      expect(structure.structureChange).toEqual({
        table: 'changed',
        fields: [
          {
            path: '/address',
            change: 'annotated',
            annotations: ['description'],
          },
          { path: '/address/city', change: 'changed' },
          { path: '/address/street', change: 'changed' },
          { path: '/address/zip', change: 'added' },
        ],
        views: false,
      });
    });

    it('describes a default that a later update of another field reset as annotated by its default (AS-60c)', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [PRODUCTS]: {
          schema: obj({ code: str({ default: 'none' }), price: num() }),
        },
      });
      await draft.updateTable(PRODUCTS, [replaceField('price', str())]);

      const structure = await listedStructureOf(draft, PRODUCTS);

      expect(structure.structureChange).toEqual({
        table: 'changed',
        fields: [
          { path: '/code', change: 'annotated', annotations: ['default'] },
          { path: '/price', change: 'changed' },
        ],
        views: false,
      });
    });

    it('describes a File given a description as annotated by its description (AS-60c)', async () => {
      const draft = await givenCommittedMedia();
      await draft.updateTable(MEDIA, [
        replaceField(
          'cover',
          ref(SystemSchemaIds.File, { description: 'Cover image' }),
        ),
      ]);

      const structure = await listedStructureOf(draft, MEDIA);

      expect(structure.structureChange).toEqual({
        table: 'changed',
        fields: [
          {
            path: '/cover',
            change: 'annotated',
            annotations: ['description'],
          },
        ],
        views: false,
      });
    });

    it('describes an object whose replace dropped a field held inside its File as rewritten, although the replace adds only a description (AS-60c)', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [ALBUMS]: { schema: albumSchema, rows: {} },
      });
      await draft.updateTable(ALBUMS, [
        {
          op: 'add',
          path: '/properties/album/properties/cover/properties/custom',
          value: obj({ x: str() }),
        },
        replaceField(
          'album',
          obj(
            { cover: ref(SystemSchemaIds.File), name: str() },
            { description: 'An album' },
          ),
        ),
      ]);

      const structure = await listedStructureOf(draft, ALBUMS);

      expect(structure.structureChange).toEqual({
        table: 'changed',
        fields: [
          { path: '/album', change: 'annotated', annotations: ['description'] },
          { path: '/album/cover', change: 'changed' },
          { path: '/album/name', change: 'changed' },
        ],
        views: false,
      });
    });

    it.each<{
      change: string;
      before: (draft: ChangesScenario) => Promise<void>;
      foreignKey: string;
      after?: (draft: ChangesScenario) => Promise<void>;
      fields: ChangedField[];
    }>([
      {
        change:
          'a referrer given a description after a rename of its referenced table as annotated by its description',
        before: (draft) => draft.renameTable(CATEGORIES, GROUPS),
        foreignKey: GROUPS,
        fields: [
          {
            path: '/category',
            change: 'annotated',
            annotations: ['description'],
          },
        ],
      },
      {
        change:
          'a referrer given a description after its referenced table was renamed and another took its id as annotated, reading the replaced id as a Head id',
        before: async (draft) => {
          await draft.renameTable(CATEGORIES, GROUPS);
          await draft.createTable(CATEGORIES, categorySchema);
        },
        foreignKey: GROUPS,
        fields: [
          {
            path: '/category',
            change: 'annotated',
            annotations: ['description'],
          },
        ],
      },
      {
        change:
          'a referrer pointed at the table that took the id of its renamed referenced table as changed',
        before: async (draft) => {
          await draft.renameTable(CATEGORIES, GROUPS);
          await draft.createTable(CATEGORIES, categorySchema);
        },
        foreignKey: CATEGORIES,
        fields: [{ path: '/category', change: 'changed' }],
      },
      {
        change:
          'a referrer given a description between two renames of its referenced table as changed, since the id between them names no table',
        before: (draft) => draft.renameTable(CATEGORIES, GROUPS),
        foreignKey: GROUPS,
        after: (draft) => draft.renameTable(GROUPS, TAGS),
        fields: [{ path: '/category', change: 'changed' }],
      },
    ])(
      'describes $change (AS-60c)',
      async ({ before, foreignKey, after, fields }) => {
        const draft = await ChangesScenario.committed(kit, {
          [CATEGORIES]: { schema: categorySchema, rows: {} },
          [ITEMS]: {
            schema: obj({ category: str({ foreignKey: CATEGORIES }) }),
            rows: {},
          },
        });
        await before(draft);
        await draft.updateTable(ITEMS, [
          replaceField(
            'category',
            str({ foreignKey, description: 'Its group' }),
          ),
        ]);
        await after?.(draft);

        const structure = await listedStructureOf(draft, ITEMS);

        expect(structure.structureChange).toEqual({
          table: 'changed',
          fields,
          views: false,
        });
      },
    );

    it('covers every value of ANNOTATION_KEYWORDS', async () => {
      const draft = await givenCommittedProducts();
      await draft.updateTable(PRODUCTS, [
        replaceField(
          'code',
          str({
            title: 'Code',
            description: 'Article code',
            deprecated: true,
            readOnly: true,
            contentMediaType: 'text/markdown',
          }),
        ),
      ]);
      const created = await ChangesScenario.committed(kit, {
        [PRODUCTS]: { schema: obj({ code: str({ default: 'none' }) }) },
      });
      await created.updateTable(PRODUCTS, [addField('sku', str())]);

      const annotations = [
        ...changedFieldsOf(await listedStructureOf(draft, PRODUCTS)),
        ...changedFieldsOf(await listedStructureOf(created, PRODUCTS)),
      ].flatMap((field) => field.annotations ?? []);

      expect(new Set(annotations)).toEqual(new Set(ANNOTATION_KEYWORDS));
    });

    it.each([
      {
        change: 'a moved field',
        updates: [[moveField('code', 'sku')]],
        editedRow: {
          sku: 'edited',
          price: 2,
          address: productRow.address,
          variants: productRow.variants,
        },
      },
      {
        change: 'a field whose move was reverted',
        updates: [[moveField('code', 'sku')], [moveField('sku', 'code')]],
        editedRow: { ...productRow, code: 'edited', price: 2 },
      },
    ])(
      'keeps the values of $change with the structure unit',
      async ({ updates, editedRow }) => {
        const draft = await givenCommittedProducts();

        for (const patches of updates) {
          await draft.updateTable(PRODUCTS, patches);
        }

        await draft.updateRow(PRODUCTS, 'p1', editedRow);

        const { units } = await draft.listChanges({ tableId: PRODUCTS });

        expect(units.map(addressedUnitOfListed)).toEqual([
          { kind: 'structure', tableId: PRODUCTS },
          { kind: 'field', tableId: PRODUCTS, rowId: 'p1', path: '/price' },
        ]);
      },
    );

    it('keeps a File that a row changed after a pending patch inside the File with the structure unit, which lists the File as changed', async () => {
      const draft = await givenCommittedMediaWithEmptyCover();
      await draft.updateTable(MEDIA, [replaceFileNameOf('cover', str())]);
      await draft.updateRow(MEDIA, 'm1', { title: 'edited', cover: emptyFile });
      await draft.uploadFile(MEDIA, 'm1', 'cover');

      const { units } = await draft.listChanges({ tableId: MEDIA });

      expect(units.map(addressedUnitOfListed)).toEqual([
        { kind: 'structure', tableId: MEDIA },
        { kind: 'field', tableId: MEDIA, rowId: 'm1', path: '/title' },
      ]);
      expect(unitOfKind(units, 'structure').structureChange).toEqual({
        table: 'changed',
        fields: [{ path: '/cover', change: 'changed' }],
        views: false,
      });
    });

    it('describes a moved File whose content a later patch rewrote as changed from its Head path', async () => {
      const draft = await givenCommittedMedia();
      await draft.updateTable(MEDIA, [moveField('cover', 'asset')]);
      await draft.updateTable(MEDIA, [replaceFileNameOf('asset', num())]);
      await draft.updateTable(MEDIA, [replaceFileNameOf('asset', str())]);

      const structure = await listedStructureOf(draft, MEDIA);

      expect(structure.structureChange).toEqual({
        table: 'changed',
        fields: [{ path: '/asset', change: 'changed', from: '/cover' }],
        views: false,
      });
    });

    it('describes a field moved, in the update that took an object out of a File, into that object as moved from its Head path', async () => {
      const draft = await givenCommittedMedia();
      await draft.updateTable(MEDIA, [
        addCustomIntoCover,
        moveCustomOutOfCover,
        moveTitleIntoExtracted,
      ]);

      const structure = await listedStructureOf(draft, MEDIA);

      expect(structure.structureChange).toEqual({
        table: 'changed',
        fields: [
          { path: '/cover', change: 'changed' },
          { path: '/extracted/newTitle', change: 'moved', from: '/title' },
          { path: '/extracted/x', change: 'added' },
        ],
        views: false,
      });
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
          selector: { structures: [{ tableId: TAGS }] },
          structureChange: { table: 'created', fields: [], views: false },
        },
      },
      {
        change: 'a removed table as a whole',
        edit: (draft) => draft.removeTable(CATEGORIES),
        listed: {
          kind: 'structure',
          tableId: CATEGORIES,
          selector: { structures: [{ tableId: CATEGORIES }] },
          structureChange: { table: 'removed', fields: [], views: false },
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
          selector: { structures: [{ tableId: GROUPS }] },
          structureChange: {
            table: 'changed',
            fields: [{ path: '/color', change: 'added' }],
            views: false,
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
          selector: { structures: [{ tableId: CATEGORIES }] },
          structureChange: {
            table: 'replaced',
            fields: [
              { path: '/label', change: 'added' },
              { path: '/title', change: 'removed' },
            ],
            views: false,
          },
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
          selector: { structures: [{ tableId: SCRATCH }] },
          structureChange: { table: 'transient', fields: [], views: false },
        },
      },
    ];

    it.each(tableCases)('describes $change', async ({ edit, listed }) => {
      const draft = await givenCommittedCategories();
      await edit(draft);

      const page = await draft.listChanges();

      expect(page.units).toEqual([listed]);
    });

    it('lists the fields of a replaced table against the removed Head table', async () => {
      const draft = await givenCommittedProducts();
      await draft.removeTable(PRODUCTS);
      await draft.createTable(
        PRODUCTS,
        obj({ code: str({ default: 'none' }), price: str(), sku: str() }),
      );

      const structure = await listedStructureOf(draft, PRODUCTS);

      expect(structure.structureChange).toEqual({
        table: 'replaced',
        fields: [
          { path: '/address/city', change: 'removed' },
          { path: '/address/street', change: 'removed' },
          { path: '/code', change: 'annotated', annotations: ['default'] },
          { path: '/price', change: 'changed' },
          { path: '/sku', change: 'added' },
          { path: '/variants', change: 'removed' },
        ],
        views: false,
      });
    });

    it('reports no object of a replaced table, nor a leaf whose description alone changed (AS-60c)', async () => {
      const draft = await givenCommittedProducts();
      await draft.removeTable(PRODUCTS);
      await draft.createTable(
        PRODUCTS,
        obj({
          code: str({ description: 'Article code' }),
          price: num(),
          address: describedAddressSchema,
          variants: arr(obj({ color: str() })),
        }),
      );

      const structure = await listedStructureOf(draft, PRODUCTS);

      expect(structure.structureChange).toEqual({
        table: 'replaced',
        fields: [],
        views: false,
      });
    });

    it('covers every value of STRUCTURE_TABLE_CHANGES', () => {
      const changes = tableCases.map(
        ({ listed }) => listed.structureChange?.table,
      );

      expect(new Set(changes)).toEqual(new Set(STRUCTURE_TABLE_CHANGES));
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
        selector: { structures: [{ tableId: CATEGORIES }] },
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
        selector: { structures: [{ tableId: NOTES, side: 'head' }] },
        structureChange: { table: 'removed', fields: [], views: false },
      });
      expect(renamed).toEqual({
        kind: 'structure',
        tableId: NOTES,
        previousTableId: MEMOS,
        selector: { structures: [{ tableId: NOTES }] },
        structureChange: { table: 'changed', fields: [], views: false },
      });
      expect(field?.structure).toEqual({
        kind: 'structure',
        tableId: NOTES,
        previousTableId: MEMOS,
        selector: { structures: [{ tableId: NOTES }] },
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
        rows: { p1: productRow },
      },
    });
  }

  function changedFieldsOf(unit: ListedUnit): readonly ChangedField[] {
    return unit.structureChange?.fields ?? [];
  }

  function givenCommittedShipments(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [SHIPMENTS]: {
        schema: shipmentSchema,
        rows: {
          s1: {
            code: 's1',
            shipping: {
              address: { city: 'Riga', street: 'Main' },
              parcels: [{ weight: 1 }],
            },
          },
        },
      },
    });
  }

  function givenCommittedMedia(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [MEDIA]: { schema: mediaSchema, rows: {} },
    });
  }

  function givenCommittedMediaWithEmptyCover(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [MEDIA]: {
        schema: mediaSchema,
        rows: { m1: { title: 'one', cover: emptyFile } },
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

function replaceFileNameOf(field: string, value: JsonSchema): JsonPatch {
  return {
    op: 'replace',
    path: `/properties/${field}/properties/fileName`,
    value,
  };
}

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
