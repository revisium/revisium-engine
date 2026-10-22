import { str } from '@revisium/schema-toolkit/mocks';
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

describe('whole-Draft equivalence with native commit and revert (BR-005 oracle)', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  guardCommittedVersions(() => kit.guard);

  afterAll(async () => {
    await kit.close();
  });

  async function givenMixedDraft(withStructure: boolean) {
    const scenario = await ChangesScenario.committed(kit, {
      products: {
        schema: productSchema,
        rows: {
          p1: product('one', 1),
          p2: product('two', 2),
          p4: product('four', 4),
        },
      },
      orders: {
        schema: orderSchema,
        rows: { o1: { product: 'p4', note: '' } },
      },
    });
    await scenario.patchRow('products', 'p1', { price: 11 });
    await scenario.createRow('products', 'p3', product('three', 3));
    await scenario.removeRow('products', 'p2');
    await scenario.renameRow('products', 'p4', 'p4b');
    await scenario.patchRow('orders', 'o1', { note: 'edited' });
    if (withStructure) {
      await scenario.addField('orders', 'color', str());
      await scenario.createTable('tags', productSchema);
      await scenario.createRow('tags', 't1', product('tag', 0));
    }
    return scenario;
  }

  describe.each([
    ['data changes', false],
    ['data and structure changes', true],
  ])('with %s', (_name, withStructure) => {
    it('commits all units exactly as native createRevision', async () => {
      const partial = await givenMixedDraft(withStructure);
      const native = await givenMixedDraft(withStructure);
      const draftTables = await partial.tableVersions('draft');

      const result = await partial.commit({ all: true });
      await native.commitNatively();

      expect(result.status).toBe('applied');
      expect(await partial.tableVersions('head')).toEqual(draftTables);
      expect(await partial.tableVersions('draft')).toEqual(draftTables);
      expect(await partial.draftHasChanges()).toBe(false);
      expect(await partial.userContent('head')).toEqual(
        await native.userContent('head'),
      );
      expect(await partial.userContent('draft')).toEqual(
        await native.userContent('draft'),
      );
    });

    it('reverts all units exactly as native revertChanges', async () => {
      const partial = await givenMixedDraft(withStructure);
      const native = await givenMixedDraft(withStructure);
      const headTables = await partial.tableVersions('head');

      const result = await partial.revert({ all: true });
      await native.revertNatively();

      expect(result.status).toBe('applied');
      expect(await partial.tableVersions('draft')).toEqual(headTables);
      expect(await partial.draftHasChanges()).toBe(false);
      expect(await partial.userContent('draft')).toEqual(
        await native.userContent('draft'),
      );
    });
  });
});
