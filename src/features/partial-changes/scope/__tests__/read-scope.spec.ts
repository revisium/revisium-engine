import { obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type {
  FieldRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import {
  addField,
  removeField,
  replaceField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { unitsOfTable } from '../../__tests__/support/scoped-reading';

const CATEGORIES = 'categories';
const PRODUCTS = 'products';
const ORDERS = 'orders';
const LOGS = 'logs';
const TAGS = 'tags';
const NOTES = 'notes';
const MEMOS = 'memos';
const LETTERS = 'letters';
const FOREIGN_KEY_CHAIN = [CATEGORIES, ORDERS, PRODUCTS];
const CHAIN_AND_LOGS = [CATEGORIES, LOGS, ORDERS, PRODUCTS];
const EVERY_TABLE = [CATEGORIES, LOGS, ORDERS, PRODUCTS, TAGS];

const categorySchema = obj({ title: str() });
const productSchema = obj({
  title: str(),
  category: str({ foreignKey: CATEGORIES }),
});
const orderSchema = obj({
  note: str(),
  product: str({ foreignKey: PRODUCTS }),
});
const logSchema = obj({ entry: str(), order: str() });
const labelSchema = obj({ label: str() });

const titleOfC1: FieldRef = {
  tableId: CATEGORIES,
  rowId: 'c1',
  path: '/title',
};
const titleOfP1: FieldRef = { tableId: PRODUCTS, rowId: 'p1', path: '/title' };
const noteOfO1: FieldRef = { tableId: ORDERS, rowId: 'o1', path: '/note' };
const entryOfL1: FieldRef = { tableId: LOGS, rowId: 'l1', path: '/entry' };

describe('ReadScope: the tables whose changed rows an operation reads', () => {
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

  it.each([
    { tableId: CATEGORIES, field: titleOfC1 },
    { tableId: PRODUCTS, field: titleOfP1 },
    { tableId: ORDERS, field: noteOfO1 },
  ])(
    'reads a field of $tableId with every table a chain of foreign keys connects to it, in both directions',
    async ({ field }) => {
      const draft = await givenEditedChainAndUnrelatedTables();

      const read = await draft.readScopedCatalogue({ fields: [field] });

      expect(read).toMatchObject({
        kind: 'catalogue',
        readTableIds: FOREIGN_KEY_CHAIN,
        unreadTables: 2,
      });
    },
  );

  it('does not read a changed table that no foreign key connects to the selection, and counts it as unread', async () => {
    const draft = await givenEditedChainAndUnrelatedTables();

    const read = await draft.readScopedCatalogue({ fields: [entryOfL1] });

    expect(read).toMatchObject({
      kind: 'catalogue',
      readTableIds: [LOGS],
      unreadTables: 4,
    });
  });

  it('connects tables by a foreign key that only the Head schema holds', async () => {
    const draft = await givenEditedChainAndUnrelatedTables();
    await draft.updateTable(ORDERS, [removeField('product')]);

    const read = await draft.readScopedCatalogue({ fields: [titleOfC1] });

    expect(read).toMatchObject({
      readTableIds: FOREIGN_KEY_CHAIN,
      unreadTables: 2,
    });
  });

  it('connects tables by a foreign key that only the Draft schema holds', async () => {
    const draft = await givenEditedChainAndUnrelatedTables();
    await draft.updateTable(LOGS, [
      replaceField('order', str({ foreignKey: ORDERS })),
    ]);

    const read = await draft.readScopedCatalogue({ fields: [titleOfC1] });

    expect(read).toMatchObject({
      readTableIds: CHAIN_AND_LOGS,
      unreadTables: 1,
    });
  });

  it('keeps the table-level units of an unread table, whose system rows are read whole', async () => {
    const draft = await givenEditedChainAndUnrelatedTables();
    await draft.updateTable(LOGS, [addField('level', str())]);

    const read = await draft.readScopedCatalogue({ fields: [titleOfP1] });

    expect(read).toMatchObject({ unreadTables: 2 });
    expect(unitsOfTable(read, LOGS)).toEqual([
      { kind: 'structure', tableId: LOGS },
    ]);
  });

  it('reads an excluded table', async () => {
    const draft = await givenEditedChainAndUnrelatedTables();

    const read = await draft.readScopedCatalogue({
      fields: [titleOfP1],
      exclude: { tableData: [LOGS] },
    });

    expect(read).toMatchObject({
      readTableIds: CHAIN_AND_LOGS,
      unreadTables: 1,
    });
  });

  it('reads a table that took over the public id of a read table', async () => {
    const draft = await givenNotesRenamedIntoTheIdOfRenamedMemos();

    const read = await draft.readScopedCatalogue({
      fields: [{ tableId: LETTERS, rowId: 'm1', path: '/label' }],
    });

    expect(read).toMatchObject({
      readTableIds: [LETTERS, MEMOS],
      unreadTables: 1,
    });
  });

  it('reads a table that a pending migration of a read table referenced, under the id it had then, although no schema references it now', async () => {
    const draft =
      await givenTagsThatReferencedRenamedNotesOnlyInPendingMigrations();

    const read = await draft.readScopedCatalogue({
      rows: [{ tableId: TAGS, rowId: 't1' }],
    });

    expect(read).toMatchObject({
      readTableIds: [MEMOS, TAGS],
      unreadTables: 1,
    });
  });

  it('reads a table that a table created and removed in the Draft referenced', async () => {
    const draft = await givenLettersCreatedAndRemovedWithAReferenceToNotes();

    const read = await draft.readScopedCatalogue({ tables: [LETTERS] });

    expect(read).toMatchObject({ readTableIds: [NOTES], unreadTables: 2 });
  });

  it.each<{ selection: Selection }>([
    { selection: { all: true } },
    { selection: { all: true, exclude: { fields: [titleOfP1] } } },
  ])('reads every table for $selection', async ({ selection }) => {
    const draft = await givenEditedChainAndUnrelatedTables();

    const read = await draft.readScopedCatalogue(selection);

    expect(read).toMatchObject({ readTableIds: EVERY_TABLE, unreadTables: 0 });
  });

  async function givenEditedChainAndUnrelatedTables(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { title: 'one', category: 'c1' } },
      },
      [ORDERS]: {
        schema: orderSchema,
        rows: { o1: { note: 'one', product: 'p1' } },
      },
      [LOGS]: {
        schema: logSchema,
        rows: { l1: { entry: 'one', order: 'o1' } },
      },
      [TAGS]: { schema: labelSchema, rows: { t1: { label: 'one' } } },
    });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'edited' });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'edited', category: 'c1' });
    await draft.updateRow(ORDERS, 'o1', { note: 'edited', product: 'p1' });
    await draft.updateRow(LOGS, 'l1', { entry: 'edited', order: 'o1' });
    await draft.updateRow(TAGS, 't1', { label: 'edited' });

    return draft;
  }

  async function givenTagsThatReferencedRenamedNotesOnlyInPendingMigrations(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [NOTES]: { schema: labelSchema, rows: { n1: { label: 'one' } } },
      [TAGS]: { schema: labelSchema },
      [LOGS]: { schema: logSchema, rows: { l1: { entry: 'one', order: '' } } },
    });
    await draft.updateTable(TAGS, [
      addField('note', str({ foreignKey: NOTES })),
    ]);
    await draft.renameTable(NOTES, MEMOS);
    await draft.updateTable(TAGS, [removeField('note')]);
    await draft.createRows(TAGS, { t1: { label: 'one' } });
    await draft.updateRow(MEMOS, 'n1', { label: 'edited' });
    await draft.updateRow(LOGS, 'l1', { entry: 'edited', order: '' });

    return draft;
  }

  async function givenLettersCreatedAndRemovedWithAReferenceToNotes(): Promise<ChangesScenario> {
    const draft = await givenEditedNotesTagsAndLogs();
    await draft.createTable(
      LETTERS,
      obj({ label: str(), note: str({ foreignKey: NOTES }) }),
    );
    await draft.removeTable(LETTERS);

    return draft;
  }

  async function givenEditedNotesTagsAndLogs(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [NOTES]: { schema: labelSchema, rows: { n1: { label: 'one' } } },
      [TAGS]: { schema: labelSchema, rows: { t1: { label: 'one' } } },
      [LOGS]: { schema: logSchema, rows: { l1: { entry: 'one', order: '' } } },
    });
    await draft.updateRow(NOTES, 'n1', { label: 'edited' });
    await draft.updateRow(TAGS, 't1', { label: 'edited' });
    await draft.updateRow(LOGS, 'l1', { entry: 'edited', order: '' });

    return draft;
  }

  async function givenNotesRenamedIntoTheIdOfRenamedMemos(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [NOTES]: { schema: labelSchema, rows: { n1: { label: 'one' } } },
      [MEMOS]: { schema: labelSchema, rows: { m1: { label: 'one' } } },
      [TAGS]: { schema: labelSchema, rows: { t1: { label: 'one' } } },
    });
    await draft.renameTable(MEMOS, LETTERS);
    await draft.renameTable(NOTES, MEMOS);
    await draft.updateRow(MEMOS, 'n1', { label: 'edited' });
    await draft.updateRow(LETTERS, 'm1', { label: 'edited' });
    await draft.updateRow(TAGS, 't1', { label: 'edited' });

    return draft;
  }
});
