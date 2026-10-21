import { givenBranch } from './support/source-branch';
import {
  expectBlocked,
  expectTraced,
  liveTable,
  trace,
} from './support/source-results';
import { addTextField, productsSchema } from './support/source-schemas';

describe('Draft Changes source history: reconciliation', () => {
  it('taints a table from the Draft history entry edited out of band', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .update('products', addTextField('color'))
      .update('products', addTextField('size'))
      .editDraftHistoryEntry('products', 2, (entry) => ({
        ...entry,
        patches: addTextField('weight'),
      }));

    const history = expectTraced(trace(branch));

    expect(liveTable(history, 'products')).toMatchObject({
      pendingGroups: [expect.objectContaining({ historyIndex: 1 })],
      taint: { code: 'SOURCE_HISTORY_MISMATCH', fromHistoryIndex: 2 },
    });
  });

  it('taints a live table without a Draft schema row from its start', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .update('products', addTextField('color'))
      .removeDraftSchemaRow('products');

    const history = expectTraced(trace(branch));

    expect(liveTable(history, 'products')).toMatchObject({
      pendingGroups: [],
      taint: { code: 'SOURCE_HISTORY_MISMATCH', fromHistoryIndex: 0 },
    });
  });

  it('taints a live table with malformed Draft history from its start', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .update('products', addTextField('color'))
      .replaceDraftMeta('products', [{ patches: [], hash: 'empty' }]);

    const history = expectTraced(trace(branch));

    expect(liveTable(history, 'products')).toMatchObject({
      pendingGroups: [],
      taint: { code: 'SOURCE_HISTORY_MISMATCH', fromHistoryIndex: 0 },
    });
  });

  it('keeps the fold taint when Draft history is malformed at the same index', () => {
    const branch = givenBranch()
      .init('products', productsSchema, { hash: 'tampered' })
      .replaceDraftMeta('products', {});

    const history = expectTraced(trace(branch));

    expect(liveTable(history, 'products').taint).toMatchObject({
      code: 'SOURCE_EVENT_UNREPLAYABLE',
      fromHistoryIndex: 0,
    });
  });

  it('blocks a live table name without a Draft table', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .removeDraftTable('products');

    const result = trace(branch);

    expect(expectBlocked(result, 'SOURCE_TABLES_MISMATCH')).toMatchObject({
      tableId: 'products',
    });
  });

  it('blocks a Head table whose Draft counterpart has another identity', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .replaceDraftTableCreatedId('products', 'replaced-products');

    const result = trace(branch);

    expect(expectBlocked(result, 'SOURCE_TABLES_MISMATCH')).toMatchObject({
      tableId: 'products',
      tableIdentity: 'created-products',
    });
  });

  it('blocks a pending table whose Draft counterpart has a Head identity', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .remove('products')
      .init('products', productsSchema)
      .replaceDraftTableCreatedId('products', 'created-products');

    const result = trace(branch);

    expect(expectBlocked(result, 'SOURCE_TABLES_MISMATCH')).toMatchObject({
      tableId: 'products',
    });
  });
});
