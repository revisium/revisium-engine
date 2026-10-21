import { givenBranch } from './support/source-branch';
import { expectBlocked, expectTraced, trace } from './support/source-results';
import { addTextField, productsSchema } from './support/source-schemas';

describe('Draft Changes source history: ledger', () => {
  it('blocks a Draft without a ledger while Head keeps ledger rows', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .withoutDraftLedger();

    const result = trace(branch);

    expectBlocked(result, 'SOURCE_LEDGER_INVALID');
  });

  it('blocks pending events published at the same instant', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .update('products', addTextField('color'), {
        id: '2026-02-01T10:00:00.000Z',
      })
      .update('products', addTextField('size'), {
        id: '2026-02-01T05:00:00-05:00',
      });

    const result = trace(branch);

    expectBlocked(result, 'SOURCE_LEDGER_INVALID');
  });

  it('blocks a pending ledger row that is not a valid migration', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .recordPendingLedgerRow({ changeType: 'init', tableId: 'orders' });

    const result = trace(branch);

    expect(expectBlocked(result, 'SOURCE_LEDGER_INVALID')).toMatchObject({
      eventIndex: 0,
    });
  });

  it('blocks a pending ledger row whose id differs from its migration id', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .recordPendingLedgerRow(
        {
          changeType: 'remove',
          id: '2026-03-01T00:00:00.000Z',
          tableId: 'products',
        },
        { id: '2026-03-02T00:00:00.000Z' },
      );

    const result = trace(branch);

    expect(expectBlocked(result, 'SOURCE_LEDGER_INVALID')).toMatchObject({
      eventIndex: 0,
    });
  });

  it('blocks pending ledger rows that repeat an id', () => {
    const repeatedId = '2026-03-01T00:00:00.000Z';
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .committedTable('orders', productsSchema)
      .recordPendingLedgerRow(
        { changeType: 'remove', id: repeatedId, tableId: 'products' },
        { id: repeatedId },
      )
      .recordPendingLedgerRow(
        { changeType: 'remove', id: repeatedId, tableId: 'orders' },
        { id: repeatedId, publishedAt: '2026-03-02T00:00:00.000Z' },
      );

    const result = trace(branch);

    expect(expectBlocked(result, 'SOURCE_LEDGER_INVALID')).toMatchObject({
      eventIndex: 1,
    });
  });

  it('traces a pending event published before the latest Head event', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .committedTable('orders', productsSchema)
      .update('products', addTextField('color'), {
        id: '2025-12-31T00:00:00.000Z',
      });

    const history = expectTraced(trace(branch));

    expect(history.pendingEvents.map(({ migration }) => migration.id)).toEqual([
      '2025-12-31T00:00:00.000Z',
    ]);
  });
});
