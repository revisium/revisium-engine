import { givenBranch } from './support/source-branch';
import {
  expectTraced,
  headTable,
  liveTable,
  pendingTable,
  trace,
} from './support/source-results';
import {
  addReferenceField,
  addTextField,
  productsSchema,
  referenceFields,
  referencing,
  referencingWithSharedField,
  sharedFieldRefs,
} from './support/source-schemas';

function givenReferrerWithSharedFieldWhoseTargetIsRenamed() {
  return givenBranch()
    .writtenWithSchemaRefs(sharedFieldRefs)
    .committedTable('categories', productsSchema)
    .committedTable('orders', referencingWithSharedField('categories'))
    .rename('categories', 'catalog');
}

describe('Draft Changes source history: references', () => {
  it('taints a pending table initialized with a reference to a table that is not live', () => {
    const branch = givenBranch().init('orders', referencing('archive'));

    const history = expectTraced(trace(branch));

    expect(liveTable(history, 'orders')).toMatchObject({
      pendingGroups: [],
      taint: { code: 'SOURCE_REFERENCE_INCONSISTENT', fromHistoryIndex: 0 },
    });
  });

  it('ignores an empty foreign key as natively', () => {
    const branch = givenBranch().init('orders', referenceFields({ ref: '' }));

    const history = expectTraced(trace(branch));

    const orders = liveTable(history, 'orders');
    expect(orders.taint).toBeUndefined();
    expect(orders.pendingGroups[0]?.foreignKeys).toEqual([]);
  });

  it('taints a table from the update adding a reference to a table that is not live', () => {
    const branch = givenBranch()
      .committedTable('orders', productsSchema)
      .update('orders', addReferenceField('archive', 'archive'));

    const history = expectTraced(trace(branch));

    expect(liveTable(history, 'orders')).toMatchObject({
      pendingGroups: [],
      taint: { code: 'SOURCE_REFERENCE_INCONSISTENT', fromHistoryIndex: 1 },
    });
  });

  it('taints a pending referrer from its next group when its target is removed', () => {
    const branch = givenBranch()
      .init('products', productsSchema)
      .init('orders', referencing('products'))
      .remove('products');

    const history = expectTraced(trace(branch));

    expect(liveTable(history, 'orders')).toMatchObject({
      pendingGroups: [expect.objectContaining({ historyIndex: 0 })],
      taint: { code: 'SOURCE_REFERENCE_INCONSISTENT', fromHistoryIndex: 1 },
    });
  });

  it('keeps the earlier pending groups of a Head referrer whose target is removed', () => {
    const branch = givenBranch()
      .committedTable('products', productsSchema)
      .committedTable('orders', referencing('products'))
      .update('orders', addTextField('note'))
      .remove('products');

    const history = expectTraced(trace(branch));

    expect(liveTable(history, 'orders')).toMatchObject({
      pendingGroups: [expect.objectContaining({ historyIndex: 1 })],
      taint: { code: 'SOURCE_REFERENCE_INCONSISTENT', fromHistoryIndex: 2 },
    });
  });

  it('resolves a reference to a tainted table without tainting the referrer', () => {
    const branch = givenBranch()
      .init('products', productsSchema, { hash: 'tampered' })
      .init('orders', referencing('products'));

    const history = expectTraced(trace(branch));

    const orders = liveTable(history, 'orders');
    expect(orders.taint).toBeUndefined();
    expect(orders.pendingGroups[0]?.foreignKeys).toEqual([
      {
        path: '/properties/products',
        targetTableId: 'products',
        targetIdentity: pendingTable(history, 0).identity,
      },
    ]);
  });

  it('adds no rename group to a referrer that is already tainted', () => {
    const branch = givenBranch()
      .committedTable('categories', productsSchema)
      .committedTable('orders', referencing('categories'))
      .update('orders', addReferenceField('archive', 'archive'))
      .rename('categories', 'catalog');

    const history = expectTraced(trace(branch));

    expect(liveTable(history, 'orders')).toMatchObject({
      pendingGroups: [],
      taint: { code: 'SOURCE_REFERENCE_INCONSISTENT', fromHistoryIndex: 1 },
    });
  });

  it('taints a renamed target referrer whose shared schema refs the trace is not given', () => {
    const branch = givenReferrerWithSharedFieldWhoseTargetIsRenamed();

    const history = expectTraced(trace(branch));

    expect(headTable(history, 'orders')).toMatchObject({
      pendingGroups: [],
      taint: { code: 'SOURCE_EVENT_UNREPLAYABLE', fromHistoryIndex: 1 },
    });
  });

  it('retargets a renamed target referrer whose shared schema refs the trace is given', () => {
    const branch = givenReferrerWithSharedFieldWhoseTargetIsRenamed();

    const history = expectTraced(trace(branch, sharedFieldRefs));

    const orders = headTable(history, 'orders');
    expect(orders.taint).toBeUndefined();
    expect(orders.pendingGroups).toEqual([
      expect.objectContaining({
        historyIndex: 1,
        origin: { kind: 'renameReference', eventIndex: 0 },
      }),
    ]);
  });

  it('leaves a stale reference without identity in a rename group', () => {
    const branch = givenBranch()
      .committedTable('categories', productsSchema)
      .committedTable('products', referencing('categories', 'archive'))
      .rename('categories', 'catalog');

    const history = expectTraced(trace(branch));

    expect(liveTable(history, 'products').pendingGroups).toEqual([
      {
        historyIndex: 1,
        origin: { kind: 'renameReference', eventIndex: 0 },
        foreignKeys: [
          { path: '/properties/archive', targetTableId: 'archive' },
          {
            path: '/properties/categories',
            targetTableId: 'catalog',
            targetIdentity: 'created-categories',
          },
        ],
      },
    ]);
  });
});
