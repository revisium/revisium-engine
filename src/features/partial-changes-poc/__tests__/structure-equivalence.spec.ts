import { obj, str } from '@revisium/schema-toolkit/mocks';
import type { Migration } from '@revisium/schema-toolkit/types';
import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  orderSchema,
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';

const viewsOf = (name: string) => ({
  version: 1,
  defaultViewId: 'default',
  views: [{ id: 'default', name, columns: [{ field: 'data.title' }] }],
});

describe('whole-Draft equivalence with structure changes (BR-005 oracle)', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  guardCommittedVersions(() => kit.guard);

  afterAll(async () => {
    await kit.close();
  });

  async function givenStructuralDraft() {
    const scenario = await ChangesScenario.committed(
      kit,
      {
        products: {
          schema: productSchema,
          rows: { p1: product('one', 1), p2: product('two', 2) },
        },
        orders: {
          schema: orderSchema,
          rows: { o1: { product: 'p1', note: '' } },
        },
        tags: { schema: obj({ label: str() }), rows: { t1: { label: 't' } } },
      },
      (draft) => draft.updateViews('products', viewsOf('All')),
    );
    await scenario.addField('products', 'color', str());
    await scenario.patchRow('products', 'p1', { price: 11, color: 'red' });
    await scenario.renameTable('products', 'goods');
    await scenario.createRow('goods', 'p3', {
      ...product('three', 3),
      color: '',
    });
    await scenario.removeTable('tags');
    await scenario.createTable('labels', obj({ name: str() }));
    await scenario.createRow('labels', 'l1', { name: 'label' });
    await scenario.updateViews('goods', viewsOf('Goods'));
    await scenario.patchRow('orders', 'o1', { note: 'edited' });
    return scenario;
  }

  it('commits all units exactly as native createRevision', async () => {
    const partial = await givenStructuralDraft();
    const native = await givenStructuralDraft();
    const draftTables = await partial.tableVersions('draft');
    const draftLedger = await partial.ledger('draft');

    const result = await partial.commit({ all: true });
    await native.commitNatively();

    expect(result.status).toBe('applied');
    expect(await partial.tableVersions('head')).toEqual(draftTables);
    expect(await partial.ledger('head')).toEqual(draftLedger);
    expect(await partial.ledger('draft')).toEqual(draftLedger);
    expect(await partial.userContent('head')).toEqual(
      await native.userContent('head'),
    );
    expect(await partial.schemas('head')).toEqual(await native.schemas('head'));
    expect(await partial.views('head', 'goods')).toEqual(
      await native.views('head', 'goods'),
    );
    expect(shapeOf(await partial.ledger('head'))).toEqual(
      shapeOf(await native.ledger('head')),
    );
    expect(await partial.draftHasChanges()).toBe(false);
  });

  it('reverts all units exactly as native revertChanges', async () => {
    const partial = await givenStructuralDraft();
    const native = await givenStructuralDraft();
    const headTables = await partial.tableVersions('head');
    const headLedger = await partial.ledger('head');

    const result = await partial.revert({ all: true });
    await native.revertNatively();

    expect(result.status).toBe('applied');
    expect(await partial.tableVersions('draft')).toEqual(headTables);
    expect(await partial.ledger('draft')).toEqual(headLedger);
    expect(await partial.userContent('draft')).toEqual(
      await native.userContent('draft'),
    );
    expect(await partial.schemas('draft')).toEqual(
      await native.schemas('draft'),
    );
    expect(await partial.draftHasChanges()).toBe(false);
  });
});

function shapeOf(ledger: Migration[]) {
  return ledger.map(({ id: _id, ...migration }) => migration);
}
