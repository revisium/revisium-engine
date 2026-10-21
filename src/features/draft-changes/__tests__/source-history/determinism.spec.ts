import { traceSourceHistory } from 'src/features/draft-changes/schema/source-history/trace-source-history';
import { givenBranch, permutedSnapshot } from './support/source-branch';
import {
  addReferenceField,
  addTextField,
  productsSchema,
  referencing,
} from './support/source-schemas';

function givenRichBranch() {
  return givenBranch()
    .committedTable('categories', productsSchema)
    .committedTable('products', referencing('categories'))
    .committedTable('orders', productsSchema)
    .init('archive', productsSchema)
    .update('orders', addReferenceField('archive', 'archive'))
    .update('products', addTextField('color'))
    .rename('categories', 'catalog')
    .update('orders', [{ op: 'remove', path: '/properties/archive' }])
    .remove('archive')
    .init('archive', referencing('catalog'));
}

describe('Draft Changes source history: determinism', () => {
  it('traces permuted snapshot arrays to the same history', () => {
    const snapshot = givenRichBranch().snapshot();

    const result = traceSourceHistory({ snapshot });

    expect(result).toMatchObject({ status: 'traced' });
    expect(
      traceSourceHistory({ snapshot: permutedSnapshot(snapshot) }),
    ).toEqual(result);
  });

  it('reports the same blocker for permuted snapshot arrays', () => {
    const snapshot = givenRichBranch()
      .removeDraftTable('products')
      .removeDraftTable('orders')
      .snapshot();

    const result = traceSourceHistory({ snapshot });

    expect(result).toMatchObject({
      status: 'blocked',
      blocker: { code: 'SOURCE_TABLES_MISMATCH', tableId: 'orders' },
    });
    expect(
      traceSourceHistory({ snapshot: permutedSnapshot(snapshot) }),
    ).toEqual(result);
  });

  it('leaves the traced snapshot unchanged', () => {
    const snapshot = givenRichBranch().snapshot();
    const before = structuredClone(snapshot);

    traceSourceHistory({ snapshot });

    expect(snapshot).toEqual(before);
  });
});
