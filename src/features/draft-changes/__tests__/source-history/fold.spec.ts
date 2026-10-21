import objectHash from 'object-hash';
import { givenBranch } from './support/source-branch';
import {
  expectBlocked,
  expectTraced,
  liveTable,
  trace,
} from './support/source-results';
import {
  addTextField,
  productsSchema,
  referenceFields,
} from './support/source-schemas';

describe('Draft Changes source history: fold', () => {
  it('blocks an update recorded before its table is initialized', () => {
    const branch = givenBranch()
      .recordPendingMigration({
        changeType: 'update',
        tableId: 'orders',
        hash: objectHash(productsSchema),
        patches: addTextField('note'),
      })
      .init('orders', productsSchema);

    const result = trace(branch);

    expect(expectBlocked(result, 'SOURCE_EVENT_INVALID')).toMatchObject({
      eventIndex: 0,
      tableId: 'orders',
    });
  });

  it('blocks an init onto a live table name', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .recordPendingMigration({
        changeType: 'init',
        tableId: 'products',
        hash: objectHash(productsSchema),
        schema: productsSchema,
      });

    const result = trace(branch);

    expect(expectBlocked(result, 'SOURCE_EVENT_INVALID')).toMatchObject({
      eventIndex: 0,
      tableId: 'products',
    });
  });

  it('blocks an init whose event id is already a table identity', () => {
    const sharedIdentity = '2026-02-01T00:00:00.000Z';
    const branch = givenBranch()
      .committedTable('products', productsSchema, {
        createdId: sharedIdentity,
      })
      .init('orders', productsSchema, { id: sharedIdentity });

    const result = trace(branch);

    expect(expectBlocked(result, 'SOURCE_EVENT_INVALID')).toMatchObject({
      eventIndex: 0,
      tableId: 'orders',
    });
  });

  it('blocks a rename of a table name that is not live', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .recordPendingMigration({
        changeType: 'rename',
        tableId: 'orders',
        nextTableId: 'archive',
      });

    const result = trace(branch);

    expect(expectBlocked(result, 'SOURCE_EVENT_INVALID')).toMatchObject({
      eventIndex: 0,
      tableId: 'orders',
    });
  });

  it('blocks a remove of a table name that is not live', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .recordPendingMigration({ changeType: 'remove', tableId: 'orders' });

    const result = trace(branch);

    expect(expectBlocked(result, 'SOURCE_EVENT_INVALID')).toMatchObject({
      eventIndex: 0,
      tableId: 'orders',
    });
  });

  it('removes a self-referencing table without tainting any table', () => {
    const branch = givenBranch()
      .committedTable('categories', referenceFields({ parent: 'categories' }))
      .committedTable('products', productsSchema)
      .remove('categories');

    const history = expectTraced(trace(branch));

    expect(history.tables.map(({ taint }) => taint)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('keeps the name timeline of a tainted table through a rename', () => {
    const branch = givenBranch()
      .init('products', productsSchema, { hash: 'tampered' })
      .rename('products', 'catalog')
      .update('catalog', addTextField('color'));

    const history = expectTraced(trace(branch));

    const catalog = liveTable(history, 'catalog');
    expect(catalog.taint).toMatchObject({ code: 'SOURCE_EVENT_UNREPLAYABLE' });
    expect(
      history.pendingEvents.map(({ tableIdentity }) => tableIdentity),
    ).toEqual([catalog.identity, catalog.identity, catalog.identity]);
  });

  it('blocks a rename onto a live table name', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .committedTable('orders', productsSchema)
      .recordPendingMigration({
        changeType: 'rename',
        tableId: 'products',
        nextTableId: 'orders',
      });

    const result = trace(branch);

    expect(expectBlocked(result, 'SOURCE_EVENT_INVALID')).toMatchObject({
      eventIndex: 0,
      tableId: 'orders',
    });
  });
});
