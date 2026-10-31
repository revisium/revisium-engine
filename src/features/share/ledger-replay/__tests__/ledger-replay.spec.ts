import { arr, num, obj, str } from '@revisium/schema-toolkit/mocks';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
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
  unreplayableOf,
  update,
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

    it('refuses a foreign key to a missing table', () => {
      const initProducts = init('products', productSchema);

      const replay = replayOf(initProducts);

      expect(unreplayableOf(replay)).toEqual({
        products: failure(
          initProducts,
          'Foreign key target "categories" does not exist',
        ),
      });
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

    it('refuses an update of a missing table', () => {
      const updateProducts = update('products', [addField('price', num())]);

      const replay = replayOf(updateProducts);

      expect(unreplayableOf(replay)).toEqual({
        products: failure(updateProducts, 'Table "products" does not exist'),
      });
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

    it('refuses a missing table', () => {
      const renameCategories = rename('categories', 'groups');

      const replay = replayOf(renameCategories);

      expect(unreplayableOf(replay)).toEqual({
        categories: failure(
          renameCategories,
          'Table "categories" does not exist',
        ),
      });
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

    it('refuses a missing table', () => {
      const removeCategories = remove('categories');

      const replay = replayOf(removeCategories);

      expect(unreplayableOf(replay)).toEqual({
        categories: failure(
          removeCategories,
          'Table "categories" does not exist',
        ),
      });
    });
  });

  describe('starting schemas', () => {
    it('replays the ledger on top of the given schemas', () => {
      const replay = replayLedger({
        ledger: [init('products', productSchema)],
        refs,
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

    it('moves an unreplayable table with its failure and rewrites its referrers when it is renamed', () => {
      const firstFailure = failingUpdate();

      const replay = replayOf(
        init('categories', categorySchema),
        init('products', productSchema),
        firstFailure,
        rename('categories', 'groups'),
      );

      expect(unreplayableOf(replay)).toEqual({
        groups: failure(firstFailure, 'Not found "missing" in "/properties"'),
      });
      expect(schemasOf(replay)).toEqual({
        products: obj({ category: str({ foreignKey: 'groups' }) }),
      });
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
