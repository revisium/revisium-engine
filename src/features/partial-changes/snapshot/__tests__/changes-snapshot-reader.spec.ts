import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import type { Migration } from '@revisium/schema-toolkit/types';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { Row } from 'src/engine-prisma-types';
import type {
  ChangesSnapshot,
  RevisionRows,
  TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { addField } from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import type { TableViewsData } from 'src/features/views/types';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';

const PRODUCTS = 'products';
const CATEGORIES = 'categories';
const TAGS = 'tags';
const LEGACY = 'legacy';
const ORDERS = 'orders';

const productSchema = obj({ code: str(), price: num() });
const titledSchema = obj({ title: str() });
const productViews: TableViewsData = {
  version: 1,
  defaultViewId: 'default',
  views: [{ id: 'default', name: 'Default' }],
};

describe('ChangesSnapshotReader: snapshot', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it('pairs the user tables of Head and Draft by identity', async () => {
    const draft = await givenCommittedTables(
      PRODUCTS,
      CATEGORIES,
      TAGS,
      LEGACY,
    );
    await draft.updateRow(PRODUCTS, 'first', { code: 'changed', price: 1 });
    await draft.renameTable(CATEGORIES, 'groups');
    await draft.removeTable(LEGACY);
    await draft.createTable(ORDERS, titledSchema);

    const snapshot = await draft.readSnapshot();

    expect(tablePairsOf(snapshot)).toEqual([
      { head: CATEGORIES, draft: 'groups', versions: 'different' },
      { head: LEGACY },
      { draft: ORDERS },
      { head: PRODUCTS, draft: PRODUCTS, versions: 'different' },
      { head: TAGS, draft: TAGS, versions: 'same' },
    ]);
  });

  it('attaches the schema and its history to every table version', async () => {
    const draft = await givenCommittedTables(PRODUCTS);
    await draft.updateTable(PRODUCTS, [addField('stock', num())]);

    const { head, draft: draftVersion } = pairOf(
      await draft.readSnapshot(),
      PRODUCTS,
    );

    expect(head?.schema).toEqual(productSchema);
    expect(head?.history).toHaveLength(1);
    expect(draftVersion?.schema).toEqual(
      obj({ code: str(), price: num(), stock: num() }),
    );
    expect(draftVersion?.history).toHaveLength(2);
  });

  it('reads the system rows of both revisions', async () => {
    const draft = await givenCommittedTables(PRODUCTS, LEGACY);
    await draft.createTable(ORDERS, titledSchema);
    await draft.removeTable(LEGACY);
    await draft.updateViews(PRODUCTS, productViews);
    await draft.createSharedSchema('money', obj({ amount: num() }));

    const { systemRows } = await draft.readSnapshot();

    expect(rowIdsOf(systemRows.schemas)).toEqual({
      head: [LEGACY, PRODUCTS],
      draft: [ORDERS, PRODUCTS],
    });
    expect(migrationsOf(systemRows.migrations)).toEqual({
      head: ['init legacy', 'init products'],
      draft: ['init legacy', 'init orders', 'init products', 'remove legacy'],
    });
    expect(rowIdsOf(systemRows.views)).toEqual({ head: [], draft: [PRODUCTS] });
    expect(rowIdsOf(systemRows.sharedSchemas)).toEqual({
      head: [],
      draft: ['money'],
    });
  });

  describe('row digest of a Draft table version', () => {
    it('stays the same while the rows do not change', async () => {
      const draft = await givenEditedProducts();

      expect(await draft.readDraftRowDigest(PRODUCTS)).toBe(
        await draft.readDraftRowDigest(PRODUCTS),
      );
    });

    it('changes on a meta edit that leaves the data hash unchanged', async () => {
      const draft = await givenEditedProducts();
      const before = await draft.readDraftRowDigest(PRODUCTS);

      await draft.writeRowColumns(PRODUCTS, 'first', {
        meta: { note: 'reviewed' },
      });

      expect(await draft.readDraftRowDigest(PRODUCTS)).not.toBe(before);
    });

    async function givenEditedProducts(): Promise<ChangesScenario> {
      const draft = await givenCommittedTables(PRODUCTS);
      await draft.updateRow(PRODUCTS, 'first', { code: 'changed', price: 1 });

      return draft;
    }
  });

  function givenCommittedTables(
    ...tableIds: string[]
  ): Promise<ChangesScenario> {
    return ChangesScenario.committed(
      kit,
      Object.fromEntries(
        tableIds.map((tableId) => [tableId, fixtureOf(tableId)]),
      ),
    );
  }
});

function fixtureOf(tableId: string) {
  if (tableId === PRODUCTS) {
    return {
      schema: productSchema,
      rows: { first: { code: 'one', price: 1 } },
    };
  }

  return { schema: titledSchema, rows: { first: { title: 'one' } } };
}

interface TablePairIds {
  readonly head?: string;
  readonly draft?: string;
  readonly versions?: 'same' | 'different';
}

function tablePairsOf(snapshot: ChangesSnapshot): TablePairIds[] {
  return snapshot.tables
    .map(tablePairIdsOf)
    .sort((left, right) => firstIdOf(left).localeCompare(firstIdOf(right)));
}

function tablePairIdsOf({ head, draft }: TablePair): TablePairIds {
  if (!draft) {
    return { head: head?.id };
  }

  if (!head) {
    return { draft: draft.id };
  }

  if (head.versionId === draft.versionId) {
    return { head: head.id, draft: draft.id, versions: 'same' };
  }

  return { head: head.id, draft: draft.id, versions: 'different' };
}

function firstIdOf({ head, draft }: TablePairIds): string {
  return head ?? draft ?? '';
}

function pairOf(snapshot: ChangesSnapshot, tableId: string): TablePair {
  const pair = snapshot.tables.find(({ head }) => head?.id === tableId);

  if (!pair) {
    throw new Error(`Table ${tableId} is not in Head`);
  }

  return pair;
}

function rowIdsOf(rows: RevisionRows) {
  return {
    head: sortedIds(rows.head),
    draft: sortedIds(rows.draft),
  };
}

function migrationsOf(rows: RevisionRows) {
  return {
    head: rows.head.map(migrationOf).sort(),
    draft: rows.draft.map(migrationOf).sort(),
  };
}

function migrationOf(row: Row): string {
  const migration = row.data as unknown as Migration;

  return `${migration.changeType} ${migration.tableId}`;
}

function sortedIds(rows: readonly Row[]): string[] {
  return rows.map((row) => row.id).sort();
}
