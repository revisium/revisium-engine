import { str } from '@revisium/schema-toolkit/mocks';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import { Replica } from 'src/features/partial-changes-poc/__tests__/support/replica';
import {
  orderSchema,
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';

const ASYNC_THRESHOLD = 3;

describe('async table migrations', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit({
      migrationOptions: { threshold: ASYNC_THRESHOLD, workerMode: 'disabled' },
    });
  });

  guardCommittedVersions(() => kit.guard);

  afterAll(async () => {
    await kit.close();
  });

  async function givenBackgroundColorUpdate() {
    const scenario = await ChangesScenario.committed(kit, {
      products: {
        schema: productSchema,
        rows: {
          p1: product('one', 1),
          p2: product('two', 2),
          p3: product('three', 3),
        },
      },
      orders: {
        schema: orderSchema,
        rows: { o1: { product: 'p1', note: '' } },
      },
    });
    await scenario.patchRow('orders', 'o1', { note: 'edited' });
    const migrationId = await scenario.startBackgroundUpdate('products', [
      { op: 'add', path: '/properties/color', value: str() },
    ]);
    return { scenario, migrationId };
  }

  const editedOrder = { rows: [{ tableId: 'orders', rowId: 'o1' }] };

  describe('while the migration is active', () => {
    it('refuses a partial commit with the native migration lock', async () => {
      const { scenario } = await givenBackgroundColorUpdate();
      const revisions = await scenario.revisionCount();

      await expect(scenario.commit(editedOrder)).rejects.toBeInstanceOf(
        MigrationLockedException,
      );
      expect(await scenario.revisionCount()).toBe(revisions);
    });

    it('refuses a partial revert with the native migration lock', async () => {
      const { scenario } = await givenBackgroundColorUpdate();

      await expect(scenario.revert(editedOrder)).rejects.toBeInstanceOf(
        MigrationLockedException,
      );
      expect((await scenario.draftRow('orders', 'o1')).data.note).toBe(
        'edited',
      );
    });

    it('reports the active migration in the preview', async () => {
      const { scenario } = await givenBackgroundColorUpdate();

      const preview = await scenario.preview('commit', editedOrder);

      expect(preview.status).toBe('blocked');
      expect(preview.blockers).toEqual([
        expect.objectContaining({
          code: 'migrationInProgress',
          tableId: 'products',
        }),
      ]);
    });
  });

  it('records that the background swap rewrites the Head schema row it shares with the Draft (known native defect)', async () => {
    const { scenario, migrationId } = await givenBackgroundColorUpdate();

    await kit.migrations.processMigration(migrationId);
    kit.guard.acceptKnownNativeMutation();

    expect((await scenario.schemas('head')).products).toEqual(
      (await scenario.schemas('draft')).products,
    );
    expect((await scenario.schemas('head')).products).not.toEqual(
      productSchema,
    );
  });

  describe('after a migration completed on a Draft-owned schema row', () => {
    async function givenUnrecordedColorOnRenamedTable() {
      const scenario = await ChangesScenario.committed(kit, {
        products: {
          schema: productSchema,
          rows: {
            p1: product('one', 1),
            p2: product('two', 2),
            p3: product('three', 3),
          },
        },
        orders: {
          schema: orderSchema,
          rows: { o1: { product: 'p1', note: '' } },
        },
      });
      await scenario.renameTable('orders', 'purchases');
      await scenario.renameTable('products', 'goods');
      await scenario.patchRow('purchases', 'o1', { note: 'edited' });
      const migrationId = await scenario.startBackgroundUpdate('goods', [
        { op: 'add', path: '/properties/color', value: str() },
      ]);
      await kit.migrations.processMigration(migrationId);
      return scenario;
    }

    it('blocks the structure whose change the ledger does not record', async () => {
      const scenario = await givenUnrecordedColorOnRenamedTable();

      const result = await scenario.commitWithRequired({ tables: ['goods'] });

      expect(result.status).toBe('blocked');
      expect(result.blockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'unrecordedStructureChange',
            tableId: 'goods',
          }),
        ]),
      );
    });

    it('still commits data of another table', async () => {
      const scenario = await givenUnrecordedColorOnRenamedTable();
      const headSchemas = await scenario.schemas('head');

      const result = await scenario.commit({
        fields: [{ tableId: 'purchases', rowId: 'o1', path: '/note' }],
      });

      expect(result.status).toBe('applied');
      expect((await scenario.headRow('orders', 'o1')).data.note).toBe('edited');
      expect(await scenario.schemas('head')).toEqual(headSchemas);
    });

    it('records that native createRevision publishes a Head a replica cannot reproduce', async () => {
      const scenario = await givenUnrecordedColorOnRenamedTable();
      const replica = await Replica.create(kit);

      await scenario.commitNatively();
      await replica.syncFromHead(scenario);

      expect(await replica.headSchemas()).not.toEqual(
        await scenario.schemas('head'),
      );
    });
  });
});
