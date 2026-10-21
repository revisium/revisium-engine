import { givenBranch } from './support/source-branch';
import {
  expectTraced,
  headTable,
  liveTable,
  trace,
} from './support/source-results';
import {
  addTextField,
  productsSchema,
  removeMissingField,
} from './support/source-schemas';

describe('Draft Changes source history: taints', () => {
  it('taints a pending table whose init hash does not match its schema', () => {
    const branch = givenBranch().init('products', productsSchema, {
      hash: 'tampered',
    });

    const history = expectTraced(trace(branch));

    expect(liveTable(history, 'products')).toMatchObject({
      pendingGroups: [],
      taint: { code: 'SOURCE_EVENT_UNREPLAYABLE', fromHistoryIndex: 0 },
    });
  });

  it('taints a table from the update whose patches cannot be applied', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .update('products', addTextField('color'))
      .recordPendingMigration({
        changeType: 'update',
        tableId: 'products',
        hash: 'unreplayable',
        patches: removeMissingField(),
      });

    const history = expectTraced(trace(branch));

    expect(liveTable(history, 'products')).toMatchObject({
      pendingGroups: [expect.objectContaining({ historyIndex: 1 })],
      taint: { code: 'SOURCE_EVENT_UNREPLAYABLE', fromHistoryIndex: 2 },
    });
  });

  it('taints a Head table with malformed history from its start', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema, { meta: {} })
      .recordPendingMigration({
        changeType: 'update',
        tableId: 'products',
        hash: 'unverified',
        patches: addTextField('color'),
      });

    const history = expectTraced(trace(branch));

    const products = headTable(history, 'products');
    expect(products).toMatchObject({
      pendingGroups: [],
      taint: { code: 'SOURCE_HISTORY_MISMATCH', fromHistoryIndex: 0 },
    });
    expect(history.pendingEvents[0]?.tableIdentity).toBe(products.identity);
  });
});
