import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import objectHash from 'object-hash';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { JsonValue } from 'src/engine-prisma-types';
import {
  branchContentsOf,
  givenActiveMigration,
} from 'src/features/migration/__tests__/support/ledger-repair-planning';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import type { RevertChangesResult } from 'src/features/partial-changes/commands/impl/revert-draft-changes.command';
import type {
  FieldRef,
  RowRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import { SelectionValidationError } from 'src/features/partial-changes/selection/selection-validator';
import { addField } from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';
import {
  recordEndpointNotifications,
  type RevertOptions,
} from '../../__tests__/support/change-reverting';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import {
  expectCopiedInsteadOfEdited,
  givenReadonlyDraftVersion,
} from '../../__tests__/support/readonly-draft-versions';
import type { RevisionSide } from '../../__tests__/support/snapshot-reading';

const CATEGORIES = 'categories';
const PRODUCTS = 'products';
const TAGS = 'tags';
const GOODS = 'goods';
const ADDRESS = 'address';

const categorySchema = obj({ title: str() });
const productSchema = obj({
  title: str(),
  category: str({ foreignKey: CATEGORIES }),
});
const pricedSchema = obj({ title: str(), price: num() });
const tagSchema = obj({ title: str() });
const addressSchema = obj({ city: str() });
const editedAddressSchema = obj({ city: str(), street: str() });

const titleOf = (tableId: string, rowId: string): FieldRef => ({
  tableId,
  rowId,
  path: '/title',
});
const rowOf = (tableId: string, rowId: string): RowRef => ({ tableId, rowId });

const titleOfP1: Selection = { fields: [titleOf(PRODUCTS, 'p1')] };
const categoryOfP1: Selection = {
  fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/category' }],
};
const creationOfC9: Selection = { rows: [rowOf(CATEGORIES, 'c9')] };
const rowP1: Selection = { rows: [rowOf(PRODUCTS, 'p1')] };

describe('revertChanges', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  describe('statuses', () => {
    it('applies a revert of one field: the field takes its Head value, the other edits stay, and Head and the Draft keep their revisions', async () => {
      const draft = await givenEditedPrices();
      const headRevisionId = await draft.revisionId('head');
      const draftRevisionId = await draft.revisionId('draft');

      const result = await draft.revertChanges({ selection: titleOfP1 });

      expect(result).toEqual<RevertChangesResult>({
        status: 'applied',
        headRevisionId,
        draftRevisionId,
        applied: { selected: 1, required: 0 },
        remaining: { units: 2, unreadTables: 0 },
      });
      await expectDraftRow(draft, PRODUCTS, 'p1', { title: 'one', price: 10 });
      await expectDraftRow(draft, PRODUCTS, 'p2', { title: 'dos', price: 2 });
      expect(await draft.revisionId('draft')).toBe(draftRevisionId);
      expect(await draft.hasChanges()).toBe(true);
    });

    it('requires the remaining edit that references a created row before reverting that row, and writes nothing', async () => {
      const draft = await givenProductOfCreatedCategory();
      const contents = await branchContentsOf(kit, draft);

      const result = await draft.revertChanges({ selection: creationOfC9 });

      expect(result).toEqual<RevertChangesResult>({
        status: 'required',
        required: [
          {
            unit: {
              kind: 'field',
              tableId: PRODUCTS,
              rowId: 'p1',
              path: '/category',
              selector: categoryOfP1,
            },
            reason: expect.objectContaining({
              code: 'referrerStillReferences',
            }),
          },
        ],
      });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });

    it('applies the required additions of its preview with includeRequired and the expected fingerprint', async () => {
      const draft = await givenProductOfCreatedCategory();
      const preview = await draft.previewChanges({
        operation: 'revert',
        selection: creationOfC9,
      });

      const result = await draft.revertChanges({
        selection: creationOfC9,
        includeRequired: true,
        expected: preview.fingerprint,
      });

      expect(result).toMatchObject({
        status: 'applied',
        applied: { selected: 1, required: 1 },
      });
      expect(await draft.rowIds('draft', CATEGORIES)).toEqual(['c1']);
      await expectDraftRow(draft, PRODUCTS, 'p1', {
        title: 'uno',
        category: 'c1',
      });
    });

    it.each<{ input: string; options: RevertOptions }>([
      {
        input: 'includeRequired without expected',
        options: { selection: creationOfC9, includeRequired: true },
      },
      {
        input: 'a malformed selection',
        options: {
          selection: {
            fields: [{ tableId: PRODUCTS, rowId: 'p1', path: 'title' }],
          },
        },
      },
    ])('refuses $input before any transaction', async ({ options }) => {
      const draft = await givenProductOfCreatedCategory();
      const reads = jest.spyOn(kit.snapshotReader, 'readSnapshot');

      await expect(draft.revertChanges(options)).rejects.toThrow(
        SelectionValidationError,
      );
      expect(reads).not.toHaveBeenCalled();
    });

    it('is blocked by a selector that matches no unit next to one that does, and writes nothing', async () => {
      const draft = await givenEditedPrices();
      const contents = await branchContentsOf(kit, draft);
      const missingRow = { rows: [rowOf(PRODUCTS, 'missing')] };

      const result = await draft.revertChanges({
        selection: { ...titleOfP1, ...missingRow },
      });

      expect(result).toEqual<RevertChangesResult>({
        status: 'blocked',
        blockers: [expect.objectContaining({ code: 'unmatchedSelector' })],
        required: [],
        unmatched: missingRow,
      });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });

    it('applies with the fingerprint of its revert preview as expected', async () => {
      const draft = await givenEditedPrices();
      const preview = await draft.previewChanges({
        operation: 'revert',
        selection: titleOfP1,
      });

      const result = await draft.revertChanges({
        selection: titleOfP1,
        expected: preview.fingerprint,
      });

      expect(result).toMatchObject({ status: 'applied' });
      await expectDraftRow(draft, PRODUCTS, 'p1', { title: 'one', price: 10 });
    });

    it('is stale and writes nothing when the selected row changed after the preview', async () => {
      const draft = await givenEditedPrices();
      const preview = await draft.previewChanges({
        operation: 'revert',
        selection: titleOfP1,
      });
      await draft.updateRow(PRODUCTS, 'p1', { title: 'uno!', price: 10 });
      const contents = await branchContentsOf(kit, draft);

      const result = await draft.revertChanges({
        selection: titleOfP1,
        expected: preview.fingerprint,
      });

      expect(result).toEqual<RevertChangesResult>({ status: 'stale' });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });

    it('is stale with the fingerprint of a commit preview of the same selection', async () => {
      const draft = await givenEditedPrices();
      const commitPreview = await draft.previewChanges({
        operation: 'commit',
        selection: titleOfP1,
      });

      const result = await draft.revertChanges({
        selection: titleOfP1,
        expected: commitPreview.fingerprint,
      });

      expect(result).toEqual<RevertChangesResult>({ status: 'stale' });
    });

    it('is empty with the current revisions when it is repeated, and never reverts twice', async () => {
      const draft = await givenEditedPrices();
      const preview = await draft.previewChanges({
        operation: 'revert',
        selection: titleOfP1,
      });
      await draft.revertChanges({
        selection: titleOfP1,
        expected: preview.fingerprint,
      });
      const contents = await branchContentsOf(kit, draft);

      const repeat = await draft.revertChanges({
        selection: titleOfP1,
        expected: preview.fingerprint,
      });

      expect(repeat).toEqual<RevertChangesResult>({
        status: 'empty',
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        unmatched: titleOfP1,
      });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });

    it('is stale when repeated with expected after the reverted row freed an id that now resolves to a renamed row', async () => {
      const draft = await givenRowIdReusedAfterItsRename();
      const preview = await draft.previewChanges({
        operation: 'revert',
        selection: rowP1,
      });
      await expectApplied(
        draft.revertChanges({
          selection: rowP1,
          expected: preview.fingerprint,
        }),
      );
      const contents = await branchContentsOf(kit, draft);

      const repeat = await draft.revertChanges({
        selection: rowP1,
        expected: preview.fingerprint,
      });

      expect(repeat).toEqual<RevertChangesResult>({ status: 'stale' });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });

    it('re-resolves an identical request without expected against the current Draft: the repeat reverts the rename whose Head id the selector now names', async () => {
      const draft = await givenRowIdReusedAfterItsRename();

      await expectApplied(draft.revertChanges({ selection: rowP1 }));
      expect(await draft.rowIds('draft', PRODUCTS)).toEqual(['p2', 'p9']);

      await expectApplied(draft.revertChanges({ selection: rowP1 }));
      expect(await draft.rowIds('draft', PRODUCTS)).toEqual(['p1', 'p2']);
      await expectDraftLinksHeadRow(draft, PRODUCTS, 'p1');
    });
  });

  describe('units', () => {
    it('links the Head version of a table whose last unit it reverts, leaving the Draft without changes', async () => {
      const draft = await givenCommittedPrices();
      await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 1 });

      await expectApplied(draft.revertChanges({ selection: titleOfP1 }));

      await expectDraftLinksHeadVersion(draft, PRODUCTS);
      expect(await draft.hasChanges()).toBe(false);
    });

    it('links the Head version of a table it reads whose Draft holds only a content-equal row version, leaving the Draft without changes', async () => {
      const draft = await givenCategoryEditNextToContentEqualProduct();

      await expectApplied(
        draft.revertChanges({
          selection: { fields: [titleOf(CATEGORIES, 'c1')] },
        }),
      );

      await expectDraftLinksHeadVersion(draft, PRODUCTS);
      expect(await draft.hasChanges()).toBe(false);
    });

    it('reverts a created row', async () => {
      const draft = await givenEditedPrices();
      await draft.createRows(PRODUCTS, { p3: { title: 'three', price: 3 } });

      await expectApplied(
        draft.revertChanges({ selection: { rows: [rowOf(PRODUCTS, 'p3')] } }),
      );

      expect(await draft.rowIds('draft', PRODUCTS)).toEqual(['p1', 'p2']);
      await expectDraftRow(draft, PRODUCTS, 'p2', { title: 'dos', price: 2 });
    });

    it('restores a deleted row with its Head version', async () => {
      const draft = await givenEditedPrices();
      await draft.removeRow(PRODUCTS, 'p1');

      await expectApplied(
        draft.revertChanges({ selection: { rows: [rowOf(PRODUCTS, 'p1')] } }),
      );

      await expectDraftLinksHeadRow(draft, PRODUCTS, 'p1');
      await expectDraftRow(draft, PRODUCTS, 'p2', { title: 'dos', price: 2 });
    });

    it('restores a replaced row with its Head version', async () => {
      const draft = await givenEditedPrices();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.createRows(PRODUCTS, { p1: { title: 'new one', price: 9 } });

      await expectApplied(
        draft.revertChanges({ selection: { rows: [rowOf(PRODUCTS, 'p1')] } }),
      );

      await expectDraftLinksHeadRow(draft, PRODUCTS, 'p1');
    });

    it('reverts a row rename and keeps the data edit of the row', async () => {
      const draft = await givenCommittedPrices();
      await draft.renameRow(PRODUCTS, 'p1', 'p9');
      await draft.updateRow(PRODUCTS, 'p9', { title: 'uno', price: 1 });

      await expectApplied(
        draft.revertChanges({
          selection: { renames: [rowOf(PRODUCTS, 'p9')] },
        }),
      );

      expect(await draft.rowIds('draft', PRODUCTS)).toEqual(['p1', 'p2']);
      await expectDraftRow(draft, PRODUCTS, 'p1', { title: 'uno', price: 1 });
    });

    it('reverts the meta of a row', async () => {
      const draft = await givenEditedPrices();
      await draft.writeRowColumns(PRODUCTS, 'p2', { meta: { note: 'draft' } });

      await expectApplied(
        draft.revertChanges({
          selection: { rowColumns: [rowOf(PRODUCTS, 'p2')] },
        }),
      );

      const head = await draft.row('head', PRODUCTS, 'p2');
      const reverted = await draft.row('draft', PRODUCTS, 'p2');
      expect(reverted.meta).toEqual(head.meta);
      expect(reverted.data).toEqual({ title: 'dos', price: 2 });
    });

    it('reverts the schemaHash of a row alone and keeps its data edit', async () => {
      const draft = await givenEditedPrices();
      await draft.writeRowColumns(PRODUCTS, 'p2', {
        schemaHash: 'stale-schema-hash',
      });

      await expectApplied(
        draft.revertChanges({
          selection: { rowColumns: [rowOf(PRODUCTS, 'p2')] },
        }),
      );

      const head = await draft.row('head', PRODUCTS, 'p2');
      const reverted = await draft.row('draft', PRODUCTS, 'p2');
      expect(reverted.schemaHash).toBe(head.schemaHash);
      expect(reverted.data).toEqual({ title: 'dos', price: 2 });
    });

    it('reverts a created table with its rows and its init migration', async () => {
      const draft = await givenEditedPrices();
      await draft.createTable(TAGS, tagSchema);
      await draft.createRows(TAGS, { t1: { title: 'one' } });

      await expectApplied(
        draft.revertChanges({ selection: { tables: [TAGS] } }),
      );

      expect(await draft.hasTable('draft', TAGS)).toBe(false);
      await expectDraftSystemTableEqualsHead(draft, SystemTables.Schema);
      expect(await draft.ledgerIds('draft')).toEqual(
        await draft.ledgerIds('head'),
      );
      await expectDraftRow(draft, PRODUCTS, 'p2', { title: 'dos', price: 2 });
    });

    it('copies a readonly Draft system table version instead of editing it in place', async () => {
      const draft = await givenEditedPrices();
      await draft.createTable(TAGS, tagSchema);
      await draft.createTable(CATEGORIES, categorySchema);
      const schemaTable = await givenReadonlyDraftVersion(
        kit,
        draft,
        SystemTables.Schema,
      );

      await expectApplied(
        draft.revertChanges({ selection: { tables: [TAGS] } }),
      );

      await expectCopiedInsteadOfEdited(kit, draft, schemaTable);
      expect(await draft.rowIds('draft', SystemTables.Schema)).toEqual([
        CATEGORIES,
        PRODUCTS,
      ]);
    });

    it('restores a removed table and drops its remove migration', async () => {
      const draft = await givenEditedPricesNextToTags();
      await draft.removeTable(TAGS);

      await expectApplied(
        draft.revertChanges({ selection: { tables: [TAGS] } }),
      );

      await expectDraftLinksHeadVersion(draft, TAGS);
      await expectDraftSystemTableEqualsHead(draft, SystemTables.Schema);
      expect(await draft.ledgerIds('draft')).toEqual(
        await draft.ledgerIds('head'),
      );
    });

    it('reverts a table rename', async () => {
      const draft = await givenEditedPricesNextToTags();
      await draft.renameTable(TAGS, GOODS);

      await expectApplied(
        draft.revertChanges({ selection: { tables: [GOODS] } }),
      );

      expect(await draft.hasTable('draft', GOODS)).toBe(false);
      await expectDraftLinksHeadVersion(draft, TAGS);
      expect(await draft.ledgerIds('draft')).toEqual(
        await draft.ledgerIds('head'),
      );
    });

    it('reverts a new field: rows return to the Head structure and edits of unchanged fields stay', async () => {
      const draft = await givenCommittedPrices();
      await draft.updateTable(PRODUCTS, [addField('color', str())]);
      await draft.updateRow(PRODUCTS, 'p1', {
        title: 'uno',
        price: 1,
        color: 'red',
      });
      await draft.createRows(PRODUCTS, {
        p3: { title: 'three', price: 3, color: 'blue' },
      });

      await expectApplied(
        draft.revertChanges({ selection: { tables: [PRODUCTS] } }),
      );

      await expectDraftSystemTableEqualsHead(draft, SystemTables.Schema);
      expect(await draft.ledgerIds('draft')).toEqual(
        await draft.ledgerIds('head'),
      );
      await expectDraftRow(draft, PRODUCTS, 'p1', { title: 'uno', price: 1 });
      await expectDraftRow(draft, PRODUCTS, 'p3', { title: 'three', price: 3 });
      await expectDraftLinksHeadRow(draft, PRODUCTS, 'p2');
    });

    it('reverts a views edit and keeps the data edits of the table', async () => {
      const draft = await givenCommittedPrices();
      await draft.updateViews(PRODUCTS, productViews('All'));
      await draft.commit();
      await draft.updateViews(PRODUCTS, productViews('Renamed'));
      await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 1 });

      await expectApplied(
        draft.revertChanges({ selection: { views: [PRODUCTS] } }),
      );

      await expectDraftSystemTableEqualsHead(draft, SystemTables.Views);
      await expectDraftRow(draft, PRODUCTS, 'p1', { title: 'uno', price: 1 });
    });

    it('reverts a shared schema change', async () => {
      const draft = await givenCommittedPrices();
      await draft.createSharedSchema(ADDRESS, addressSchema);
      await draft.commit();
      await draft.updateSharedSchema(ADDRESS, editedAddressSchema);
      await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 1 });

      await expectApplied(
        draft.revertChanges({ selection: { sharedSchemas: [ADDRESS] } }),
      );

      await expectDraftSystemTableEqualsHead(draft, SystemTables.SharedSchemas);
      await expectDraftRow(draft, PRODUCTS, 'p1', { title: 'uno', price: 1 });
    });
  });

  describe('the whole Draft', () => {
    it.each<{ holding: string; given: () => Promise<ChangesScenario> }>([
      {
        holding: 'data and structure changes',
        given: givenDataAndStructureChanges,
      },
      {
        holding: 'an empty shared-schema table that Head lacks',
        given: givenEmptySharedSchemaTableNextToAnEdit,
      },
    ])(
      'reverts exactly { all: true } of a Draft holding $holding as native revertChanges does: the Draft links exactly the Head table versions',
      async ({ given }) => {
        const draft = await given();

        await expectApplied(draft.revertChanges({ selection: { all: true } }));

        expect(await draft.linkedTableVersionIds('draft')).toEqual(
          await draft.linkedTableVersionIds('head'),
        );
        expect(await draft.hasChanges()).toBe(false);
      },
    );
  });

  describe('endpoint notification', () => {
    it('notifies the endpoints of the Draft once, after its transaction committed', async () => {
      const draft = await givenEditedPrices();
      const notifications = recordEndpointNotifications(kit, () =>
        draftDataOf(draft, PRODUCTS, 'p1'),
      );

      await draft.revertChanges({ selection: titleOfP1 });

      expect(notifications).toEqual([
        {
          revisionId: await draft.revisionId('draft'),
          seenOutsideTheTransaction: { title: 'one', price: 10 },
        },
      ]);
    });

    it('notifies nothing for a revert that writes nothing', async () => {
      const draft = await givenEditedPrices();
      const notifications = recordEndpointNotifications(kit, () =>
        draftDataOf(draft, PRODUCTS, 'p1'),
      );

      await draft.revertChanges({ selection: titleOfP1, expected: 'other' });

      expect(notifications).toEqual([]);
    });
  });

  describe('during an async migration', () => {
    it('refuses with MigrationLocked, cancels nothing and writes nothing', async () => {
      const draft = await givenEditedPrices();
      await givenActiveMigration(kit, draft, PRODUCTS);
      const contents = await branchContentsOf(kit, draft);

      await expect(
        draft.revertChanges({ selection: titleOfP1 }),
      ).rejects.toThrow(MigrationLockedException);

      expect(await migrationStatusesOf(draft)).toEqual([
        MigrationStatus.PENDING,
      ]);
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });
  });

  async function expectApplied(
    reverting: Promise<RevertChangesResult>,
  ): Promise<void> {
    await expect(reverting).resolves.toMatchObject({ status: 'applied' });
  }

  async function expectDraftRow(
    draft: ChangesScenario,
    tableId: string,
    rowId: string,
    data: JsonValue,
  ): Promise<void> {
    const row = await draft.row('draft', tableId, rowId);

    expect(row.data).toEqual(data);
    expect(row.hash).toBe(objectHash(data));
  }

  async function expectDraftLinksHeadRow(
    draft: ChangesScenario,
    tableId: string,
    rowId: string,
  ): Promise<void> {
    const head = await draft.row('head', tableId, rowId);
    const reverted = await draft.row('draft', tableId, rowId);

    expect(reverted.versionId).toBe(head.versionId);
  }

  async function expectDraftLinksHeadVersion(
    draft: ChangesScenario,
    tableId: string,
  ): Promise<void> {
    expect(await draft.tableVersionId('draft', tableId)).toBe(
      await draft.tableVersionId('head', tableId),
    );
  }

  async function expectDraftSystemTableEqualsHead(
    draft: ChangesScenario,
    tableId: SystemTables,
  ): Promise<void> {
    expect(await systemRowsOf(draft, 'draft', tableId)).toEqual(
      await systemRowsOf(draft, 'head', tableId),
    );
  }

  async function systemRowsOf(
    draft: ChangesScenario,
    side: RevisionSide,
    tableId: SystemTables,
  ) {
    const rows = await kit.prisma.row.findMany({
      where: {
        tables: {
          some: { versionId: await draft.tableVersionId(side, tableId) },
        },
      },
      select: { id: true, data: true, meta: true },
      orderBy: { id: 'asc' },
    });

    return rows;
  }

  async function draftDataOf(
    draft: ChangesScenario,
    tableId: string,
    rowId: string,
  ): Promise<JsonValue> {
    const row = await draft.row('draft', tableId, rowId);

    return row.data;
  }

  async function migrationStatusesOf(draft: ChangesScenario) {
    const migrations = await kit.prisma.tableMigration.findMany({
      where: { revisionId: await draft.revisionId('draft') },
      select: { status: true },
    });

    return migrations.map(({ status }) => status);
  }

  async function givenCommittedPrices(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: pricedSchema,
        rows: {
          p1: { title: 'one', price: 1 },
          p2: { title: 'two', price: 2 },
        },
      },
    });
  }

  async function givenRowIdReusedAfterItsRename(): Promise<ChangesScenario> {
    const draft = await givenCommittedPrices();
    await draft.renameRow(PRODUCTS, 'p1', 'p9');
    await draft.createRows(PRODUCTS, { p1: { title: 'new one', price: 5 } });

    return draft;
  }

  async function givenEditedPrices(): Promise<ChangesScenario> {
    const draft = await givenCommittedPrices();
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 10 });
    await draft.updateRow(PRODUCTS, 'p2', { title: 'dos', price: 2 });

    return draft;
  }

  async function givenEditedPricesNextToTags(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: pricedSchema,
        rows: {
          p1: { title: 'one', price: 1 },
          p2: { title: 'two', price: 2 },
        },
      },
      [TAGS]: { schema: tagSchema, rows: { t1: { title: 'one' } } },
    });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 10 });

    return draft;
  }

  async function givenDataAndStructureChanges(): Promise<ChangesScenario> {
    const draft = await givenEditedPricesNextToTags();
    await draft.removeRow(PRODUCTS, 'p2');
    await draft.createRows(PRODUCTS, { p3: { title: 'three', price: 3 } });
    await draft.updateTable(PRODUCTS, [addField('color', str())]);
    await draft.renameTable(TAGS, GOODS);
    await draft.createTable(CATEGORIES, categorySchema);

    return draft;
  }

  async function givenEmptySharedSchemaTableNextToAnEdit(): Promise<ChangesScenario> {
    const draft = await givenCommittedPrices();
    await draft.createSharedSchema(ADDRESS, addressSchema);
    await draft.removeSharedSchema(ADDRESS);
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 1 });

    return draft;
  }

  async function givenCategoryEditNextToContentEqualProduct(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { title: 'one', category: 'c1' } },
      },
    });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'uno' });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', category: 'c1' });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'one', category: 'c1' });

    return draft;
  }

  async function givenProductOfCreatedCategory(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { title: 'one', category: 'c1' } },
      },
    });
    await draft.createRows(CATEGORIES, { c9: { title: 'nine' } });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', category: 'c9' });

    return draft;
  }
});

function productViews(name: string): TableViewsData {
  return {
    version: 1,
    defaultViewId: 'default',
    views: [
      {
        id: 'default',
        name,
        columns: [{ field: 'data.title' }, { field: 'data.price' }],
      },
    ],
  };
}
