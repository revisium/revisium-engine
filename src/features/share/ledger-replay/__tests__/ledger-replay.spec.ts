import { VALIDATE_JSON_FIELD_NAME_ERROR_MESSAGE } from 'src/features/share/utils/validateUrlLikeId/validateJsonFieldName';
import { arr, num, numFormula, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  JsonSchemaTypeName,
  type JsonSchema,
} from '@revisium/schema-toolkit/types';
import { replayLedger } from 'src/features/share/ledger-replay/ledger-replay';
import {
  addField,
  failure,
  init,
  moveField,
  refs,
  remove,
  removeField,
  rename,
  replaceField,
  replayOf,
  schemasOf,
  unattributedFailure,
  unattributedOf,
  unreplayableOf,
  update,
  validator,
} from './support/ledger-steps';

const categorySchema = obj({ title: str() });
const tagSchema = obj({ label: str() });
const productSchema = obj({ category: str({ foreignKey: 'categories' }) });
const nodeSchema = obj({ parent: str({ foreignKey: 'nodes' }) });

describe('replayLedger', () => {
  describe('init', () => {
    it('creates the table with the schema of the migration', () => {
      const replay = replayOf(init('categories', categorySchema));

      expect(schemasOf(replay)).toEqual({ categories: categorySchema });
      expect(unreplayableOf(replay)).toEqual({});
    });

    it('creates a table that references an existing table', () => {
      const replay = replayOf(
        init('categories', categorySchema),
        init('products', productSchema),
      );

      expect(schemasOf(replay)).toEqual({
        categories: categorySchema,
        products: productSchema,
      });
    });

    it('creates a table that references itself', () => {
      const replay = replayOf(init('nodes', nodeSchema));

      expect(schemasOf(replay)).toEqual({ nodes: nodeSchema });
      expect(unreplayableOf(replay)).toEqual({});
    });

    it('refuses a taken table id', () => {
      const repeatedInit = init('categories', tagSchema);

      const replay = replayOf(init('categories', categorySchema), repeatedInit);

      expect(unreplayableOf(replay)).toEqual({
        categories: failure(repeatedInit, 'Table "categories" already exists'),
      });
      expect(schemasOf(replay)).toEqual({});
    });

    it('refuses a foreign key to a missing table without taking the id', () => {
      const initProducts = init('products', productSchema);

      const replay = replayOf(initProducts);

      expect(unattributedOf(replay)).toEqual([
        unattributedFailure(
          initProducts,
          'Foreign key target "categories" does not exist',
        ),
      ]);
      expect(unreplayableOf(replay)).toEqual({});
    });

    it('creates a table at an id whose earlier creation failed', () => {
      const replay = replayOf(
        init('products', productSchema),
        init('categories', categorySchema),
        init('products', productSchema),
      );

      expect(schemasOf(replay)).toEqual({
        categories: categorySchema,
        products: productSchema,
      });
      expect(unreplayableOf(replay)).toEqual({});
    });
  });

  describe('update', () => {
    it('applies add, remove, replace and move patches as the synchronous update does', () => {
      const replay = replayOf(
        init('products', obj({ code: str(), price: num(), weight: num() })),
        update('products', [
          addField('stock', num()),
          removeField('weight'),
          replaceField('price', str()),
          moveField('code', 'sku'),
        ]),
      );

      expect(schemasOf(replay)).toEqual({
        products: obj({ price: str(), sku: str(), stock: num() }),
      });
    });

    it('adds a reference of the table to itself', () => {
      const replay = replayOf(
        init('nodes', obj({})),
        update('nodes', [addField('parent', str({ foreignKey: 'nodes' }))]),
      );

      expect(schemasOf(replay)).toEqual({ nodes: nodeSchema });
      expect(unreplayableOf(replay)).toEqual({});
    });

    it('refuses an update of a missing table without taking the id', () => {
      const updateProducts = update('products', [addField('price', num())]);

      const replay = replayOf(updateProducts);

      expect(unattributedOf(replay)).toEqual([
        unattributedFailure(updateProducts, 'Table "products" does not exist'),
      ]);
      expect(unreplayableOf(replay)).toEqual({});
    });

    it('refuses a patch that does not apply', () => {
      const removeMissingField = update('categories', [removeField('missing')]);

      const replay = replayOf(
        init('categories', categorySchema),
        removeMissingField,
      );

      expect(unreplayableOf(replay)).toEqual({
        categories: failure(
          removeMissingField,
          'Not found "missing" in "/properties"',
        ),
      });
      expect(schemasOf(replay)).toEqual({});
    });

    it('refuses a foreign key to a missing table', () => {
      const addCategory = update('products', [
        addField('category', str({ foreignKey: 'categories' })),
      ]);

      const replay = replayOf(init('products', obj({})), addCategory);

      expect(unreplayableOf(replay)).toEqual({
        products: failure(
          addCategory,
          'Foreign key target "categories" does not exist',
        ),
      });
    });
  });

  describe('rename', () => {
    it('moves the table to the new id', () => {
      const replay = replayOf(
        init('categories', categorySchema),
        rename('categories', 'groups'),
      );

      expect(schemasOf(replay)).toEqual({ groups: categorySchema });
    });

    it('rewrites the foreign keys of every referrer', () => {
      const replay = replayOf(
        init('categories', categorySchema),
        init('products', productSchema),
        init(
          'orders',
          obj({
            categories: arr(str({ foreignKey: 'categories' })),
            line: obj({ category: str({ foreignKey: 'categories' }) }),
          }),
        ),
        rename('categories', 'groups'),
      );

      expect(schemasOf(replay)).toEqual({
        groups: categorySchema,
        products: obj({ category: str({ foreignKey: 'groups' }) }),
        orders: obj({
          categories: arr(str({ foreignKey: 'groups' })),
          line: obj({ category: str({ foreignKey: 'groups' }) }),
        }),
      });
    });

    it('rewrites a reference of the table to itself', () => {
      const replay = replayOf(
        init('nodes', nodeSchema),
        rename('nodes', 'tree'),
      );

      expect(schemasOf(replay)).toEqual({
        tree: obj({ parent: str({ foreignKey: 'tree' }) }),
      });
    });

    it('refuses a taken id and leaves the table and its referrers unchanged', () => {
      const renameIntoGroups = rename('categories', 'groups');

      const replay = replayOf(
        init('categories', categorySchema),
        init('products', productSchema),
        init('groups', tagSchema),
        renameIntoGroups,
      );

      expect(unreplayableOf(replay)).toEqual({
        categories: failure(renameIntoGroups, 'Table "groups" already exists'),
      });
      expect(schemasOf(replay)).toEqual({
        products: productSchema,
        groups: tagSchema,
      });
    });

    it('refuses a missing table without taking an id', () => {
      const renameCategories = rename('categories', 'groups');

      const replay = replayOf(renameCategories);

      expect(unattributedOf(replay)).toEqual([
        unattributedFailure(
          renameCategories,
          'Table "categories" does not exist',
        ),
      ]);
      expect(unreplayableOf(replay)).toEqual({});
    });

    it('renames a table into an id that a failed step named', () => {
      const replay = replayOf(
        update('groups', [addField('price', num())]),
        init('categories', categorySchema),
        rename('categories', 'groups'),
      );

      expect(schemasOf(replay)).toEqual({ groups: categorySchema });
      expect(unreplayableOf(replay)).toEqual({});
    });
  });

  describe('remove', () => {
    it('removes the table', () => {
      const replay = replayOf(
        init('categories', categorySchema),
        remove('categories'),
      );

      expect(schemasOf(replay)).toEqual({});
      expect(unreplayableOf(replay)).toEqual({});
    });

    it('removes a table that references only itself', () => {
      const replay = replayOf(init('nodes', nodeSchema), remove('nodes'));

      expect(schemasOf(replay)).toEqual({});
      expect(unreplayableOf(replay)).toEqual({});
    });

    it('refuses a table that another table references', () => {
      const removeCategories = remove('categories');

      const replay = replayOf(
        init('categories', categorySchema),
        init('products', productSchema),
        removeCategories,
      );

      expect(unreplayableOf(replay)).toEqual({
        categories: failure(
          removeCategories,
          'Table "categories" is referenced by "products"',
        ),
      });
      expect(schemasOf(replay)).toEqual({ products: productSchema });
    });

    it('refuses a missing table without taking the id', () => {
      const removeCategories = remove('categories');

      const replay = replayOf(removeCategories);

      expect(unattributedOf(replay)).toEqual([
        unattributedFailure(
          removeCategories,
          'Table "categories" does not exist',
        ),
      ]);
      expect(unreplayableOf(replay)).toEqual({});
    });
  });

  describe('native validation', () => {
    it('refuses an update whose patched schema breaks a formula', () => {
      const removePrice = update('products', [removeField('price')]);

      const replay = replayOf(
        init('products', obj({ price: num(), total: numFormula('price * 2') })),
        removePrice,
      );

      expect(unreplayableOf(replay)).toEqual({
        products: failure(
          removePrice,
          `Formula validation error in field "total": Unknown field 'price' in formula`,
        ),
      });
    });

    it('refuses a table with an invalid field name', () => {
      const initProducts = init('products', obj({ __hidden: str() }));

      const replay = replayOf(initProducts);

      expect(unattributedOf(replay)).toEqual([
        unattributedFailure(
          initProducts,
          `Invalid field names: __hidden. ${VALIDATE_JSON_FIELD_NAME_ERROR_MESSAGE}`,
        ),
      ]);
    });

    it('refuses an added field with an invalid nested field name', () => {
      const addDetails = update('products', [
        addField('details', obj({ __hidden: str() })),
      ]);

      const replay = replayOf(
        init('products', obj({ code: str() })),
        addDetails,
      );

      expect(unreplayableOf(replay)).toEqual({
        products: failure(
          addDetails,
          `Invalid field names: __hidden. ${VALIDATE_JSON_FIELD_NAME_ERROR_MESSAGE}`,
        ),
      });
    });

    it('refuses a schema that violates the meta-schema', () => {
      const initProducts = init('products', {
        type: JsonSchemaTypeName.Object,
        additionalProperties: false,
        required: ['code'],
        properties: { code: { type: JsonSchemaTypeName.String } as JsonSchema },
      });

      const replay = replayOf(initProducts);

      expect(unattributedOf(replay)).toEqual([
        unattributedFailure(
          initProducts,
          expect.stringMatching(/^schema is not valid: /),
        ),
      ]);
    });

    it('refuses a patch that violates the patch schema', () => {
      const replaceCode = update('products', [
        replaceField('code', { type: JsonSchemaTypeName.Number } as JsonSchema),
      ]);

      const replay = replayOf(
        init('products', obj({ code: str() })),
        replaceCode,
      );

      expect(unreplayableOf(replay)).toEqual({
        products: failure(
          replaceCode,
          expect.stringMatching(/^patches is not valid: /),
        ),
      });
    });

    it('refuses an update without patches', () => {
      const emptyUpdate = update('products', []);

      const replay = replayOf(
        init('products', obj({ code: str() })),
        emptyUpdate,
      );

      expect(unreplayableOf(replay)).toEqual({
        products: failure(emptyUpdate, 'Invalid length of patches'),
      });
    });
  });

  describe('starting schemas', () => {
    it('replays the ledger on top of the given schemas', () => {
      const replay = replayLedger({
        ledger: [init('products', productSchema)],
        refs,
        validator,
        schemas: new Map([['categories', categorySchema]]),
      });

      expect(schemasOf(replay)).toEqual({
        categories: categorySchema,
        products: productSchema,
      });
    });

    it('leaves the given schemas unchanged', () => {
      const schemas = new Map<string, JsonSchema>([
        ['categories', categorySchema],
        ['products', productSchema],
      ]);

      replayLedger({
        ledger: [
          rename('categories', 'groups'),
          update('products', [addField('price', num())]),
        ],
        refs,
        validator,
        schemas,
      });

      expect(Object.fromEntries(schemas)).toEqual({
        categories: obj({ title: str() }),
        products: obj({ category: str({ foreignKey: 'categories' }) }),
      });
    });
  });

  describe('failure isolation', () => {
    const failingUpdate = () => update('categories', [removeField('missing')]);

    it('keeps replaying the other tables after a failure', () => {
      const replay = replayOf(
        init('categories', categorySchema),
        init('tags', tagSchema),
        failingUpdate(),
        update('tags', [addField('weight', num())]),
      );

      expect(schemasOf(replay)).toEqual({
        tags: obj({ label: str(), weight: num() }),
      });
      expect(Object.keys(unreplayableOf(replay))).toEqual(['categories']);
    });

    it('keeps the first failure of a table', () => {
      const firstFailure = failingUpdate();

      const replay = replayOf(
        init('categories', categorySchema),
        firstFailure,
        update('categories', [addField('weight', num())]),
      );

      expect(unreplayableOf(replay)).toEqual({
        categories: failure(
          firstFailure,
          'Not found "missing" in "/properties"',
        ),
      });
    });

    it('makes a new table unreplayable when its foreign key names an unreplayable table', () => {
      const initProducts = init('products', productSchema);

      const replay = replayOf(
        init('categories', categorySchema),
        failingUpdate(),
        initProducts,
      );

      expect(unreplayableOf(replay).products).toEqual(
        failure(initProducts, 'Depends on unreplayable table "categories"'),
      );
    });

    it('keeps an existing referrer replayable while none of its later steps depends on the unreplayable table', () => {
      const replay = replayOf(
        init('categories', categorySchema),
        init('products', productSchema),
        failingUpdate(),
      );

      expect(schemasOf(replay)).toEqual({ products: productSchema });
    });

    it('makes an existing referrer unreplayable when its later update keeps a foreign key to an unreplayable table', () => {
      const addPrice = update('products', [addField('price', num())]);

      const replay = replayOf(
        init('categories', categorySchema),
        init('products', productSchema),
        failingUpdate(),
        addPrice,
      );

      expect(unreplayableOf(replay).products).toEqual(
        failure(addPrice, 'Depends on unreplayable table "categories"'),
      );
    });

    it('moves an unreplayable table with its failure when it is renamed', () => {
      const firstFailure = failingUpdate();

      const replay = replayOf(
        init('categories', categorySchema),
        firstFailure,
        rename('categories', 'groups'),
      );

      expect(unreplayableOf(replay)).toEqual({
        groups: failure(firstFailure, 'Not found "missing" in "/properties"'),
      });
    });

    it('makes a referrer unreplayable when the rename of an unreplayable table rewrites it', () => {
      const renameCategories = rename('categories', 'groups');

      const replay = replayOf(
        init('categories', categorySchema),
        init('products', productSchema),
        failingUpdate(),
        renameCategories,
      );

      expect(unreplayableOf(replay).products).toEqual(
        failure(renameCategories, 'Depends on unreplayable table "groups"'),
      );
      expect(schemasOf(replay)).toEqual({});
    });

    it('keeps the earlier failure of a referrer that the rename of an unreplayable table rewrites', () => {
      const failingProductsUpdate = update('products', [
        removeField('missing'),
      ]);

      const replay = replayOf(
        init('categories', categorySchema),
        init('products', productSchema),
        failingProductsUpdate,
        failingUpdate(),
        rename('categories', 'groups'),
      );

      expect(unreplayableOf(replay).products).toEqual(
        failure(failingProductsUpdate, 'Not found "missing" in "/properties"'),
      );
    });

    it('refuses to remove a table that an unreplayable table still references', () => {
      const failingProductsUpdate = update('products', [
        removeField('missing'),
      ]);
      const removeCategories = remove('categories');

      const replay = replayOf(
        init('categories', categorySchema),
        init('products', productSchema),
        failingProductsUpdate,
        removeCategories,
      );

      expect(unreplayableOf(replay)).toEqual({
        categories: failure(
          removeCategories,
          'Table "categories" is referenced by "products"',
        ),
        products: failure(
          failingProductsUpdate,
          'Not found "missing" in "/properties"',
        ),
      });
    });

    it('keeps the id of a table whose removal was refused', () => {
      const removeCategories = remove('categories');

      const replay = replayOf(
        init('categories', categorySchema),
        init('products', productSchema),
        update('products', [removeField('missing')]),
        removeCategories,
        init('categories', tagSchema),
      );

      expect(unreplayableOf(replay).categories).toEqual(
        failure(
          removeCategories,
          'Table "categories" is referenced by "products"',
        ),
      );
    });

    it('rewrites the references of an unreplayable referrer when the table it names is renamed', () => {
      const removeGroups = remove('groups');

      const replay = replayOf(
        init('categories', categorySchema),
        init('products', productSchema),
        update('products', [removeField('missing')]),
        rename('categories', 'groups'),
        removeGroups,
      );

      expect(unreplayableOf(replay).groups).toEqual(
        failure(removeGroups, 'Table "groups" is referenced by "products"'),
      );
    });

    it('refuses a rename into the id of an unreplayable table', () => {
      const renameIntoCategories = rename('tags', 'categories');

      const replay = replayOf(
        init('categories', categorySchema),
        init('tags', tagSchema),
        failingUpdate(),
        renameIntoCategories,
      );

      expect(unreplayableOf(replay).tags).toEqual(
        failure(
          renameIntoCategories,
          'Depends on unreplayable table "categories"',
        ),
      );
    });

    it('closes an unreplayable table when it is removed', () => {
      const replay = replayOf(
        init('categories', categorySchema),
        failingUpdate(),
        remove('categories'),
      );

      expect(unreplayableOf(replay)).toEqual({});
      expect(schemasOf(replay)).toEqual({});
    });

    it('replays a table re-created at the id of a removed unreplayable table', () => {
      const replay = replayOf(
        init('categories', categorySchema),
        failingUpdate(),
        remove('categories'),
        init('categories', tagSchema),
      );

      expect(schemasOf(replay)).toEqual({ categories: tagSchema });
      expect(unreplayableOf(replay)).toEqual({});
    });
  });
});
