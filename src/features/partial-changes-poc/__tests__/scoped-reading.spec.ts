import { obj, str } from '@revisium/schema-toolkit/mocks';
import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import { guardCommittedVersions } from 'src/features/partial-changes-poc/__tests__/support/committed-versions-guard';
import { publicPartOf } from 'src/features/partial-changes-poc/__tests__/support/listed-units';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  orderSchema,
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';
import { DEFAULT_LIMITS } from 'src/features/partial-changes-poc/planning/operation-limits.service';
import { SnapshotReader } from 'src/features/partial-changes-poc/snapshot/snapshot-reader.service';
import type { TablePair } from 'src/features/partial-changes-poc/snapshot/snapshot.types';

const MAX_CHANGED_ROWS = 3;
const LOGS = ['l1', 'l2', 'l3', 'l4', 'l5'];

const logSchema = obj({ entry: str() });
const priceOfP1 = { tableId: 'products', rowId: 'p1', path: '/price' };

describe('scoped reading: an operation reads changed rows of the affected tables only (decision 3)', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit({
      limits: { ...DEFAULT_LIMITS, maxChangedRows: MAX_CHANGED_ROWS },
    });
  });

  guardCommittedVersions(() => kit.guard);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await kit.close();
  });

  async function givenPriceEditAndBusyUnrelatedTable() {
    const scenario = await ChangesScenario.committed(kit, {
      products: { schema: productSchema, rows: { p1: product('one', 1) } },
      orders: {
        schema: orderSchema,
        rows: {
          o1: { product: 'p1', note: '' },
          o2: { product: 'p1', note: '' },
          o3: { product: 'p1', note: '' },
        },
      },
      logs: {
        schema: logSchema,
        rows: Object.fromEntries(LOGS.map((id) => [id, { entry: '' }])),
      },
    });
    await scenario.patchRow('products', 'p1', { price: 2 });
    for (const id of LOGS) {
      await scenario.patchRow('logs', id, { entry: 'edited' });
    }
    return scenario;
  }

  it('previews one field without reading the unrelated table', async () => {
    const scenario = await givenPriceEditAndBusyUnrelatedTable();

    const preview = await scenario.preview('commit', { fields: [priceOfP1] });

    expect(preview.status).toBe('ready');
    expect(preview.estimate.changedRows).toBe(1);
  });

  it('commits one field although an unrelated table holds more changed rows than the limit', async () => {
    const scenario = await givenPriceEditAndBusyUnrelatedTable();

    const result = await scenario.commit({ fields: [priceOfP1] });

    expect(result.status).toBe('applied');
    expect((await scenario.headRow('products', 'p1')).data.price).toBe(2);
    expect((await scenario.headRow('logs', 'l1')).data.entry).toBe('');
    expect((await scenario.draftRow('logs', 'l1')).data.entry).toBe('edited');
  });

  it('reverts one field although an unrelated table holds more changed rows than the limit', async () => {
    const scenario = await givenPriceEditAndBusyUnrelatedTable();

    const result = await scenario.revert({ fields: [priceOfP1] });

    expect(result.status).toBe('applied');
    expect((await scenario.draftRow('products', 'p1')).data.price).toBe(1);
    expect((await scenario.draftRow('logs', 'l5')).data.entry).toBe('edited');
  });

  it('counts the changed rows of tables connected through a foreign key', async () => {
    const scenario = await givenPriceEditAndBusyUnrelatedTable();
    for (const id of ['o1', 'o2', 'o3']) {
      await scenario.patchRow('orders', id, { note: 'edited' });
    }

    const preview = await scenario.preview('commit', { fields: [priceOfP1] });

    expect(preview.status).toBe('blocked');
    expect(preview.estimate.changedRows).toBe(4);
    expect(preview.blockers).toEqual([
      expect.objectContaining({ code: 'tooLarge' }),
    ]);
  });

  it('reads every table for all: true', async () => {
    const scenario = await givenPriceEditAndBusyUnrelatedTable();

    const preview = await scenario.preview('commit', { all: true });

    expect(preview.status).toBe('blocked');
    expect(preview.estimate.changedRows).toBe(1 + LOGS.length);
  });

  it('keeps the Draft version of an unread table that has only content-equal edits', async () => {
    const scenario = await givenPriceEditAndBusyUnrelatedTable();
    for (const id of LOGS) {
      await scenario.patchRow('logs', id, { entry: '' });
    }
    const draftLogs = await scenario.draftRow('logs', 'l1');

    const result = await scenario.commit({ fields: [priceOfP1] });

    expect(result.status).toBe('applied');
    expect((await scenario.draftRow('logs', 'l1')).versionId).toBe(
      draftLogs.versionId,
    );
    expect(await scenario.draftHasChanges()).toBe(true);
  });

  describe('listChanges', () => {
    async function givenEditsInTwoTables() {
      const scenario = await ChangesScenario.committed(kit, {
        alpha: { schema: logSchema, rows: { a1: { entry: '' } } },
        beta: { schema: logSchema, rows: { b1: { entry: '' } } },
      });
      await scenario.patchRow('alpha', 'a1', { entry: 'edited' });
      await scenario.patchRow('beta', 'b1', { entry: 'edited' });
      return scenario;
    }

    function recordReadTables(): string[] {
      const read: string[] = [];
      const reader = kit.module.get(SnapshotReader);
      const attach = reader.attachChangedRows.bind(reader);
      jest
        .spyOn(reader, 'attachChangedRows')
        .mockImplementation(async (tables: TablePair[]) => {
          read.push(
            ...tables
              .filter(
                (pair) =>
                  pair.head &&
                  pair.draft &&
                  !pair.draft.system &&
                  pair.head.versionId !== pair.draft.versionId,
              )
              .map((pair) => pair.draft?.id ?? ''),
          );
          return attach(tables);
        });
      return read;
    }

    it('reads the changed rows of the tables of one page only', async () => {
      const scenario = await givenEditsInTwoTables();
      const read = recordReadTables();

      const page = await scenario.listChanges({ limit: 1 });

      expect(page.units.map(publicPartOf)).toEqual([
        { kind: 'field', tableId: 'alpha', rowId: 'a1', path: '/entry' },
      ]);
      expect(read).toEqual(['alpha']);
      expect(page.nextCursor).toBeDefined();
    });

    it('continues with the next table from the cursor', async () => {
      const scenario = await givenEditsInTwoTables();
      const first = await scenario.listChanges({ limit: 1 });
      const read = recordReadTables();

      const second = await scenario.listChanges({
        cursor: first.nextCursor,
        limit: 1,
      });

      expect(second.units.map(publicPartOf)).toEqual([
        { kind: 'field', tableId: 'beta', rowId: 'b1', path: '/entry' },
      ]);
      expect(read).toEqual(['beta']);
      expect(second.nextCursor).toBeUndefined();
    });

    it('lists the units of one table with a tableId filter', async () => {
      const scenario = await givenEditsInTwoTables();
      const read = recordReadTables();

      const page = await scenario.listChanges({ tableId: 'beta' });

      expect(page.units.map(publicPartOf)).toEqual([
        { kind: 'field', tableId: 'beta', rowId: 'b1', path: '/entry' },
      ]);
      expect(read).toEqual(['beta']);
    });
  });
});
