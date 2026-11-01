import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  isLedgered,
  traceTableSlots,
} from 'src/features/share/ledger-replay/table-slots';
import { addField, init, remove, rename, update } from './support/ledger-steps';

const categorySchema = obj({ title: str() });
const productSchema = obj({ code: str() });

describe('traceTableSlots', () => {
  describe('slots', () => {
    it('follows a table through a chain of renames together with its updates', () => {
      const ledger = [
        init('categories', categorySchema),
        rename('categories', 'groups'),
        update('groups', [addField('code', str())]),
        rename('groups', 'sections'),
      ];

      expect(traceTableSlots(ledger)).toEqual([
        {
          tableIds: ['categories', 'groups', 'sections'],
          migrations: ledger,
          currentTableId: 'sections',
        },
      ]);
    });

    it('keeps one slot for a table renamed back to its id', () => {
      const ledger = [
        init('categories', categorySchema),
        rename('categories', 'groups'),
        rename('groups', 'categories'),
      ];

      expect(traceTableSlots(ledger)).toEqual([
        {
          tableIds: ['categories', 'groups', 'categories'],
          migrations: ledger,
          currentTableId: 'categories',
        },
      ]);
    });

    it('opens a second slot for a table re-created at the id of a removed table', () => {
      const removedTable = [
        init('categories', categorySchema),
        remove('categories'),
      ];
      const recreate = init('categories', categorySchema);

      expect(traceTableSlots([...removedTable, recreate])).toEqual([
        { tableIds: ['categories'], migrations: removedTable },
        {
          tableIds: ['categories'],
          migrations: [recreate],
          currentTableId: 'categories',
        },
      ]);
    });

    it('swaps two tables through a temporary id', () => {
      const initCategories = init('categories', categorySchema);
      const initProducts = init('products', productSchema);
      const renameCategories = rename('categories', 'swapping');
      const renameProducts = rename('products', 'categories');
      const renameSwapping = rename('swapping', 'products');

      const slots = traceTableSlots([
        initCategories,
        initProducts,
        renameCategories,
        renameProducts,
        renameSwapping,
      ]);

      expect(slots).toEqual([
        {
          tableIds: ['categories', 'swapping', 'products'],
          migrations: [initCategories, renameCategories, renameSwapping],
          currentTableId: 'products',
        },
        {
          tableIds: ['products', 'categories'],
          migrations: [initProducts, renameProducts],
          currentTableId: 'categories',
        },
      ]);
    });

    it('reports transient tables with every id they used, so tables that shared an id can be grouped', () => {
      const firstTransient = [
        init('imports', productSchema),
        rename('imports', 'staging'),
        remove('staging'),
      ];
      const secondTransient = [
        init('staging', productSchema),
        remove('staging'),
      ];

      expect(traceTableSlots([...firstTransient, ...secondTransient])).toEqual([
        { tableIds: ['imports', 'staging'], migrations: firstTransient },
        { tableIds: ['staging'], migrations: secondTransient },
      ]);
    });
  });

  describe('broken lineage', () => {
    it('opens a broken slot for an update of an id without an open slot', () => {
      const updateProducts = update('products', [addField('price', num())]);

      expect(traceTableSlots([updateProducts])).toEqual([
        {
          tableIds: ['products'],
          migrations: [updateProducts],
          currentTableId: 'products',
          brokenBy: updateProducts,
        },
      ]);
    });

    it('moves the broken slot of a rename of an id without an open slot to the new id', () => {
      const renameCategories = rename('categories', 'groups');
      const updateGroups = update('groups', [addField('code', str())]);

      expect(traceTableSlots([renameCategories, updateGroups])).toEqual([
        {
          tableIds: ['categories', 'groups'],
          migrations: [renameCategories, updateGroups],
          currentTableId: 'groups',
          brokenBy: renameCategories,
        },
      ]);
    });

    it('closes the broken slot of a remove of an id without an open slot', () => {
      const removeCategories = remove('categories');

      expect(traceTableSlots([removeCategories])).toEqual([
        {
          tableIds: ['categories'],
          migrations: [removeCategories],
          brokenBy: removeCategories,
        },
      ]);
    });

    it('breaks the lineage of a table renamed into an occupied id and of the table it displaces', () => {
      const initCategories = init('categories', categorySchema);
      const initGroups = init('groups', categorySchema);
      const renameIntoGroups = rename('categories', 'groups');

      const slots = traceTableSlots([
        initCategories,
        initGroups,
        renameIntoGroups,
      ]);

      expect(slots).toEqual([
        {
          tableIds: ['categories', 'groups'],
          migrations: [initCategories, renameIntoGroups],
          currentTableId: 'groups',
          brokenBy: renameIntoGroups,
        },
        {
          tableIds: ['groups'],
          migrations: [initGroups],
          brokenBy: renameIntoGroups,
        },
      ]);
    });

    it('breaks the lineage of a table created at an occupied id and of the table it displaces', () => {
      const initCategories = init('categories', categorySchema);
      const repeatedInit = init('categories', categorySchema);

      expect(traceTableSlots([initCategories, repeatedInit])).toEqual([
        {
          tableIds: ['categories'],
          migrations: [initCategories],
          brokenBy: repeatedInit,
        },
        {
          tableIds: ['categories'],
          migrations: [repeatedInit],
          currentTableId: 'categories',
          brokenBy: repeatedInit,
        },
      ]);
    });
  });

  describe('starting identities', () => {
    it('continues the tables of the Head before the pending migrations open new slots', () => {
      const renameCategories = rename('categories', 'groups');
      const updateProducts = update('products', [addField('price', num())]);
      const removeProducts = remove('products');
      const recreateProducts = init('products', productSchema);

      const slots = traceTableSlots(
        [renameCategories, updateProducts, removeProducts, recreateProducts],
        ['categories', 'products', 'tags'],
      );

      expect(slots).toEqual([
        {
          startingTableId: 'categories',
          tableIds: ['categories', 'groups'],
          migrations: [renameCategories],
          currentTableId: 'groups',
        },
        {
          startingTableId: 'products',
          tableIds: ['products'],
          migrations: [updateProducts, removeProducts],
        },
        {
          startingTableId: 'tags',
          tableIds: ['tags'],
          migrations: [],
          currentTableId: 'tags',
        },
        {
          tableIds: ['products'],
          migrations: [recreateProducts],
          currentTableId: 'products',
        },
      ]);
    });
  });
});

describe('isLedgered', () => {
  it('treats a table renamed through recorded migrations as ledgered under its new id only', () => {
    const slots = traceTableSlots([
      init('categories', categorySchema),
      rename('categories', 'groups'),
    ]);

    expect(isLedgered(slots, 'groups')).toBe(true);
    expect(isLedgered(slots, 'categories')).toBe(false);
  });

  it('treats a table whose id the ledger removed and never re-created as unledgered', () => {
    const slots = traceTableSlots([
      init('categories', categorySchema),
      remove('categories'),
    ]);

    expect(isLedgered(slots, 'categories')).toBe(false);
  });

  it('treats a table whose lineage is broken as unledgered', () => {
    const slots = traceTableSlots([rename('categories', 'groups')]);

    expect(isLedgered(slots, 'groups')).toBe(false);
  });

  it('treats a starting table as ledgered', () => {
    const slots = traceTableSlots([], ['categories']);

    expect(isLedgered(slots, 'categories')).toBe(true);
  });
});
