import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { ChangesScenario } from './support/changes-scenario';

const PRODUCTS = 'products';
const productSchema = obj({ code: str(), price: num() });

describe('committed versions guard', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(() => {
    kit.guard.forget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it('accepts native Draft edits after a commit', async () => {
    const draft = await givenCommittedProducts();

    await draft.updateRow(PRODUCTS, 'p1', { code: 'changed', price: 1 });
    await draft.renameRow(PRODUCTS, 'p2', 'p9');
    await draft.writeRowColumns(PRODUCTS, 'p1', { meta: { note: 'draft' } });
    await draft.createRows(PRODUCTS, { p3: { code: 'three', price: 3 } });

    await expect(kit.guard.verify()).resolves.toBeUndefined();
  });

  it('reports a committed row version changed in place', async () => {
    const draft = await givenCommittedProducts();
    const { versionId } = await draft.row('head', PRODUCTS, 'p1');

    await kit.prisma.row.update({
      where: { versionId },
      data: { data: { code: 'rewritten', price: 1 } },
    });

    await expect(kit.guard.verify()).rejects.toThrow(
      `committed row version ${versionId} changed`,
    );
  });

  it('reports a row link removed from a committed table version', async () => {
    const draft = await givenCommittedProducts();
    const tableVersionId = await draft.tableVersionId('head', PRODUCTS);

    await kit.prisma.table.update({
      where: { versionId: tableVersionId },
      data: {
        rows: {
          disconnect: {
            versionId: (await draft.row('head', PRODUCTS, 'p2')).versionId,
          },
        },
      },
    });

    await expect(kit.guard.verify()).rejects.toThrow(
      `committed table version ${tableVersionId} changed`,
    );
  });

  it('reports a committed version that became mutable', async () => {
    const draft = await givenCommittedProducts();
    const { versionId } = await draft.row('head', PRODUCTS, 'p1');

    await kit.prisma.row.update({
      where: { versionId },
      data: { readonly: false },
    });

    await expect(kit.guard.verify()).rejects.toThrow(
      `committed row version ${versionId} is mutable`,
    );
  });

  it('reports a committed table version that holds two rows with one id', async () => {
    const draft = await givenCommittedProducts();
    const tableVersionId = await draft.tableVersionId('head', PRODUCTS);
    const p1 = await draft.row('head', PRODUCTS, 'p1');

    await kit.prisma.row.create({
      data: {
        ...p1,
        versionId: `${p1.versionId}-copy`,
        createdId: `${p1.createdId}-copy`,
        data: p1.data ?? {},
        meta: p1.meta ?? {},
        tables: { connect: { versionId: tableVersionId } },
      },
    });

    await expect(kit.guard.verify()).rejects.toThrow(
      `committed table version ${tableVersionId} holds two rows with id p1`,
    );
  });

  function givenCommittedProducts(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: productSchema,
        rows: {
          p1: { code: 'one', price: 1 },
          p2: { code: 'two', price: 2 },
        },
      },
    });
  }
});
