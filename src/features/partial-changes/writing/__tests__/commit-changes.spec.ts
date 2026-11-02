import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { num, numFormula, obj, ref, str } from '@revisium/schema-toolkit/mocks';
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
import { DraftRevisionTargetApiService } from 'src/features/draft-revision/draft-revision-target-api.service';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import type { CommitChangesResult } from 'src/features/partial-changes/commands/impl/commit-draft-changes.command';
import type { ListChangesResult } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import type {
  FieldRef,
  RowRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import { ReadScope } from 'src/features/partial-changes/scope/read-scope';
import { SelectionValidationError } from 'src/features/partial-changes/selection/selection-validator';
import {
  addField,
  removeField,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';
import { branchContentOf } from '../../__tests__/support/branch-content';
import type { CommitOptions } from '../../__tests__/support/change-committing';
import { recordEndpointNotifications } from '../../__tests__/support/change-reverting';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import type { RevisionSide } from '../../__tests__/support/snapshot-reading';

const CATEGORIES = 'categories';
const PRODUCTS = 'products';
const ORDERS = 'orders';
const DOCUMENTS = 'documents';
const LOGS = 'logs';
const ADDRESS = 'address';
const GROUPS = 'groups';
const TAGS = 'tags';

const categorySchema = obj({ title: str() });
const productSchema = obj({
  title: str(),
  category: str({ foreignKey: CATEGORIES }),
});
const pricedSchema = obj({ title: str(), price: num() });
const orderSchema = obj({
  price: num(),
  quantity: num(),
  total: numFormula('price * quantity'),
});
const documentSchema = obj({ title: str(), image: ref(SystemSchemaIds.File) });
const logSchema = obj({ entry: str() });
const tagSchema = obj({ label: str() });
const addressSchema = obj({ city: str() });
const editedAddressSchema = obj({ city: str(), street: str() });

const emptyFile = {
  status: '',
  fileId: '',
  url: '',
  fileName: '',
  hash: '',
  extension: '',
  mimeType: '',
  size: 0,
  width: 0,
  height: 0,
};

const titleOf = (tableId: string, rowId: string): FieldRef => ({
  tableId,
  rowId,
  path: '/title',
});
const rowOf = (tableId: string, rowId: string): RowRef => ({ tableId, rowId });

const INJECTED_FAILURE = 'Injected failure after the writes';
const STALE_SCHEMA_HASH = 'stale-schema-hash';

const titleOfP1: Selection = { fields: [titleOf(PRODUCTS, 'p1')] };
const categoryOfP1: Selection = {
  fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/category' }],
};
const creationOfC9: Selection = { rows: [rowOf(CATEGORIES, 'c9')] };

describe('commitChanges', () => {
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
    it('applies a commit of one field: the former Draft becomes Head with that field merged in, and a new Draft keeps the other edits', async () => {
      const draft = await givenEditedPrices();
      const previousHeadRevisionId = await draft.revisionId('head');
      const formerDraftRevisionId = await draft.revisionId('draft');

      const result = await draft.commitChanges({ selection: titleOfP1 });

      expect(result).toEqual<CommitChangesResult>({
        status: 'applied',
        previousHeadRevisionId,
        headRevisionId: formerDraftRevisionId,
        draftRevisionId: await draft.revisionId('draft'),
        applied: { selected: 1, required: 0 },
        remaining: { units: 2, unreadTables: 0 },
        renumbered: [],
      });
      expect(await draft.revisionId('head')).toBe(formerDraftRevisionId);
      await expectProducts(draft, 'head', {
        p1: { title: 'uno', price: 1 },
        p2: { title: 'two', price: 2 },
      });
      await expectProducts(draft, 'draft', {
        p1: { title: 'uno', price: 10 },
        p2: { title: 'dos', price: 2 },
      });
      expect(unitsOf(await draft.listChanges())).toEqual([
        { kind: 'field', rowId: 'p1', path: '/price' },
        { kind: 'field', rowId: 'p2', path: '/title' },
      ]);
      expect(await draft.hasChanges()).toBe(true);
    });

    it('stores the comment on the new Head', async () => {
      const draft = await givenEditedPrices();

      await expectApplied(
        draft.commitChanges({ selection: titleOfP1, comment: 'titles' }),
      );

      expect(await commentOf(await draft.revisionId('head'))).toBe('titles');
    });

    it('requires the created row that a committed field references, and writes nothing', async () => {
      const draft = await givenProductOfCreatedCategory();
      const contents = await branchContentsOf(kit, draft);

      const result = await draft.commitChanges({ selection: categoryOfP1 });

      expect(result).toEqual<CommitChangesResult>({
        status: 'required',
        required: [
          {
            unit: {
              kind: 'rowCreate',
              tableId: CATEGORIES,
              rowId: 'c9',
              selector: creationOfC9,
            },
            reason: expect.objectContaining({ code: 'referencedRowMissing' }),
          },
        ],
      });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });

    it('applies the required additions of its preview with includeRequired and the expected fingerprint', async () => {
      const draft = await givenProductOfCreatedCategory();
      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: categoryOfP1,
      });

      const result = await draft.commitChanges({
        selection: categoryOfP1,
        includeRequired: true,
        expected: preview.fingerprint,
      });

      expect(result).toMatchObject({
        status: 'applied',
        applied: { selected: 1, required: 1 },
      });
      expect(await draft.rowIds('head', CATEGORIES)).toEqual(['c1', 'c9']);
      await expectRow(draft, 'head', PRODUCTS, 'p1', {
        title: 'one',
        category: 'c9',
      });
    });

    it.each<{ input: string; options: CommitOptions }>([
      {
        input: 'includeRequired without expected',
        options: { selection: categoryOfP1, includeRequired: true },
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

      await expect(draft.commitChanges(options)).rejects.toThrow(
        SelectionValidationError,
      );
      expect(reads).not.toHaveBeenCalled();
    });

    it('is blocked by a selector that matches no unit next to one that does, and writes nothing', async () => {
      const draft = await givenEditedPrices();
      const contents = await branchContentsOf(kit, draft);
      const missingRow = { rows: [rowOf(PRODUCTS, 'missing')] };

      const result = await draft.commitChanges({
        selection: { ...titleOfP1, ...missingRow },
      });

      expect(result).toEqual<CommitChangesResult>({
        status: 'blocked',
        blockers: [expect.objectContaining({ code: 'unmatchedSelector' })],
        required: [],
        unmatched: missingRow,
      });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });

    it('applies with the fingerprint of its commit preview as expected', async () => {
      const draft = await givenEditedPrices();
      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: titleOfP1,
      });

      const result = await draft.commitChanges({
        selection: titleOfP1,
        expected: preview.fingerprint,
      });

      expect(result).toMatchObject({ status: 'applied' });
      await expectRow(draft, 'head', PRODUCTS, 'p1', {
        title: 'uno',
        price: 1,
      });
    });

    it('is stale and writes nothing when the selected row changed after the preview', async () => {
      const draft = await givenEditedPrices();
      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: titleOfP1,
      });
      await draft.updateRow(PRODUCTS, 'p1', { title: 'uno!', price: 10 });
      const contents = await branchContentsOf(kit, draft);

      const result = await draft.commitChanges({
        selection: titleOfP1,
        expected: preview.fingerprint,
      });

      expect(result).toEqual<CommitChangesResult>({ status: 'stale' });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });

    it.each<{
      previewed: 'commit' | 'revert';
      apply: (
        draft: ChangesScenario,
        options: CommitOptions,
      ) => Promise<unknown>;
    }>([
      {
        previewed: 'revert',
        apply: (draft, options) => draft.commitChanges(options),
      },
      {
        previewed: 'commit',
        apply: (draft, options) => draft.revertChanges(options),
      },
    ])(
      'is stale with the fingerprint of a $previewed preview of the same selection, which the other operation never passes',
      async ({ previewed, apply }) => {
        const draft = await givenEditedPrices();
        const preview = await draft.previewChanges({
          operation: previewed,
          selection: titleOfP1,
        });
        const contents = await branchContentsOf(kit, draft);

        const result = await apply(draft, {
          selection: titleOfP1,
          expected: preview.fingerprint,
        });

        expect(result).toEqual({ status: 'stale' });
        expect(await branchContentsOf(kit, draft)).toEqual(contents);
      },
    );

    it('is empty with the current revisions when it is repeated, and never commits twice', async () => {
      const draft = await givenEditedPrices();
      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: titleOfP1,
      });
      await expectApplied(
        draft.commitChanges({
          selection: titleOfP1,
          expected: preview.fingerprint,
        }),
      );
      const contents = await branchContentsOf(kit, draft);

      const repeat = await draft.commitChanges({
        selection: titleOfP1,
        expected: preview.fingerprint,
      });

      expect(repeat).toEqual<CommitChangesResult>({
        status: 'empty',
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        unmatched: titleOfP1,
      });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });
  });

  describe('units', () => {
    it('commits a created row by linking its Draft version into Head', async () => {
      const draft = await givenEditedPrices();
      await draft.createRows(PRODUCTS, { p3: { title: 'three', price: 3 } });

      await expectApplied(
        draft.commitChanges({ selection: { rows: [rowOf(PRODUCTS, 'p3')] } }),
      );

      await expectProducts(draft, 'head', {
        p1: { title: 'one', price: 1 },
        p2: { title: 'two', price: 2 },
        p3: { title: 'three', price: 3 },
      });
      await expectHeadLinksDraftRow(draft, PRODUCTS, 'p3');
    });

    it('commits a deleted row and keeps the other edits in the Draft', async () => {
      const draft = await givenEditedPrices();
      await draft.removeRow(PRODUCTS, 'p1');

      await expectApplied(
        draft.commitChanges({ selection: { rows: [rowOf(PRODUCTS, 'p1')] } }),
      );

      await expectProducts(draft, 'head', { p2: { title: 'two', price: 2 } });
      await expectProducts(draft, 'draft', { p2: { title: 'dos', price: 2 } });
    });

    it('commits a replaced row by linking its Draft version into Head', async () => {
      const draft = await givenEditedPrices();
      await draft.removeRow(PRODUCTS, 'p1');
      await draft.createRows(PRODUCTS, { p1: { title: 'new one', price: 9 } });

      await expectApplied(
        draft.commitChanges({ selection: { rows: [rowOf(PRODUCTS, 'p1')] } }),
      );

      await expectProducts(draft, 'head', {
        p1: { title: 'new one', price: 9 },
        p2: { title: 'two', price: 2 },
      });
      await expectHeadLinksDraftRow(draft, PRODUCTS, 'p1');
    });

    it('commits a row rename and keeps the data edit of the row in the Draft', async () => {
      const draft = await givenCommittedPrices();
      await draft.renameRow(PRODUCTS, 'p1', 'p9');
      await draft.updateRow(PRODUCTS, 'p9', { title: 'uno', price: 1 });

      await expectApplied(
        draft.commitChanges({
          selection: { renames: [rowOf(PRODUCTS, 'p9')] },
        }),
      );

      await expectProducts(draft, 'head', {
        p2: { title: 'two', price: 2 },
        p9: { title: 'one', price: 1 },
      });
      await expectProducts(draft, 'draft', {
        p2: { title: 'two', price: 2 },
        p9: { title: 'uno', price: 1 },
      });
    });

    it('commits the meta of a row and keeps its data edit in the Draft', async () => {
      const draft = await givenEditedPrices();
      await draft.writeRowColumns(PRODUCTS, 'p2', { meta: { note: 'draft' } });

      await expectApplied(
        draft.commitChanges({
          selection: { rowColumns: [rowOf(PRODUCTS, 'p2')] },
        }),
      );

      const committed = await draft.row('head', PRODUCTS, 'p2');
      expect(committed.meta).toEqual({ note: 'draft' });
      await expectProducts(draft, 'head', {
        p1: { title: 'one', price: 1 },
        p2: { title: 'two', price: 2 },
      });
      await expectProducts(draft, 'draft', {
        p1: { title: 'uno', price: 10 },
        p2: { title: 'dos', price: 2 },
      });
    });

    it('commits the schemaHash of a row alone, so that only its data edit stays listed', async () => {
      const draft = await givenEditedPrices();
      await draft.writeRowColumns(PRODUCTS, 'p2', {
        schemaHash: STALE_SCHEMA_HASH,
      });

      await expectApplied(
        draft.commitChanges({
          selection: { rowColumns: [rowOf(PRODUCTS, 'p2')] },
        }),
      );

      const committed = await draft.row('head', PRODUCTS, 'p2');
      expect(committed.schemaHash).toBe(STALE_SCHEMA_HASH);
      expect(committed.data).toEqual({ title: 'two', price: 2 });
      expect(unitsOf(await draft.listChanges())).toEqual([
        { kind: 'field', rowId: 'p1', path: '/price' },
        { kind: 'field', rowId: 'p1', path: '/title' },
        { kind: 'field', rowId: 'p2', path: '/title' },
      ]);
    });

    it('commits a views edit and keeps the data edits in the Draft', async () => {
      const draft = await givenCommittedPrices();
      await draft.updateViews(PRODUCTS, productViews('All'));
      await draft.commit();
      await draft.updateViews(PRODUCTS, productViews('Renamed'));
      await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 1 });

      await expectApplied(
        draft.commitChanges({ selection: { views: [PRODUCTS] } }),
      );

      expect(await viewsOf(draft, 'head')).toEqual(productViews('Renamed'));
      expect(await viewsOf(draft, 'draft')).toEqual(productViews('Renamed'));
      await expectProducts(draft, 'head', {
        p1: { title: 'one', price: 1 },
        p2: { title: 'two', price: 2 },
      });
      await expectProducts(draft, 'draft', {
        p1: { title: 'uno', price: 1 },
        p2: { title: 'two', price: 2 },
      });
    });

    it('commits a shared schema change and keeps the data edits in the Draft', async () => {
      const draft = await givenCommittedPrices();
      await draft.createSharedSchema(ADDRESS, addressSchema);
      await draft.commit();
      await draft.updateSharedSchema(ADDRESS, editedAddressSchema);
      await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 1 });

      await expectApplied(
        draft.commitChanges({ selection: { sharedSchemas: [ADDRESS] } }),
      );

      const committed = await draft.row(
        'head',
        SystemTables.SharedSchemas,
        ADDRESS,
      );
      expect(committed.data).toEqual(editedAddressSchema);
      await expectProducts(draft, 'head', {
        p1: { title: 'one', price: 1 },
        p2: { title: 'two', price: 2 },
      });
      await expectProducts(draft, 'draft', {
        p1: { title: 'uno', price: 1 },
        p2: { title: 'two', price: 2 },
      });
    });

    it('commits a created row without its structure: Head gets the Head defaults at the deferred paths, and the Draft keeps its values', async () => {
      const draft = await givenCommittedPrices();
      await draft.updateTable(PRODUCTS, [removeField('price')]);
      await draft.createRows(PRODUCTS, { p3: { title: 'three' } });
      const selection = { rows: [rowOf(PRODUCTS, 'p3')] };
      const preview = await draft.previewChanges({
        operation: 'commit',
        selection,
      });

      const result = await draft.commitChanges({
        selection,
        expected: preview.fingerprint,
      });

      expect(preview.deferred).toEqual([
        expect.objectContaining({ paths: ['/price'] }),
      ]);
      expect(result).toMatchObject({ status: 'applied' });
      await expectRow(draft, 'head', PRODUCTS, 'p3', {
        title: 'three',
        price: 0,
      });
      await expectRow(draft, 'draft', PRODUCTS, 'p3', { title: 'three' });
    });

    it('recomputes the formulas of a merged Head row', async () => {
      const draft = await ChangesScenario.committed(kit, {
        [ORDERS]: {
          schema: orderSchema,
          rows: { o1: { price: 2, quantity: 3, total: 0 } },
        },
      });
      await draft.updateRow(ORDERS, 'o1', { price: 5, quantity: 4, total: 0 });

      await expectApplied(
        draft.commitChanges({
          selection: {
            fields: [{ tableId: ORDERS, rowId: 'o1', path: '/price' }],
          },
        }),
      );

      await expectRow(draft, 'head', ORDERS, 'o1', {
        price: 5,
        quantity: 3,
        total: 15,
      });
      await expectRow(draft, 'draft', ORDERS, 'o1', {
        price: 5,
        quantity: 4,
        total: 20,
      });
    });

    it('registers the file of a merged Head row against the Head structure it keeps, not the Draft one that dropped the File field', async () => {
      const draft = await givenHeadImageWithDraftDroppingTheImageField();
      const headRow = await draft.row('head', DOCUMENTS, 'd1');
      await draft.updateRow(DOCUMENTS, 'd1', { title: 'uno' });

      await expectApplied(
        draft.commitChanges({
          selection: { fields: [titleOf(DOCUMENTS, 'd1')] },
        }),
      );

      const merged = await draft.row('head', DOCUMENTS, 'd1');
      expect(merged.versionId).not.toBe(headRow.versionId);
      expect(merged.data).toEqual({
        ...(headRow.data as Record<string, JsonValue>),
        title: 'uno',
      });
      expect(await blobIdsOf(merged.versionId)).toEqual(
        await blobIdsOf(headRow.versionId),
      );
      expect(await blobIdsOf(merged.versionId)).toHaveLength(1);
    });
  });

  describe('tables without remaining units', () => {
    it('links the Head versions into the new Draft for the tables it read, so the Draft has no changes left', async () => {
      const draft = await givenProductNextToContentEqualCategory();

      const result = await draft.commitChanges({ selection: titleOfP1 });

      expect(result).toMatchObject({
        status: 'applied',
        remaining: { units: 0, unreadTables: 0 },
      });
      await expectDraftLinksHeadVersion(draft, PRODUCTS);
      await expectDraftLinksHeadVersion(draft, CATEGORIES);
      expect(await draft.hasChanges()).toBe(false);
    });

    it('keeps the Draft version of an unread table that holds only content-equal versions', async () => {
      const draft = await givenEditedPricesNextToContentEqualLogs();
      const logsVersionId = await draft.tableVersionId('draft', LOGS);

      const result = await draft.commitChanges({ selection: titleOfP1 });

      expect(result).toMatchObject({
        status: 'applied',
        remaining: { units: 2, unreadTables: 1 },
      });
      expect(await draft.tableVersionId('draft', LOGS)).toBe(logsVersionId);
      expect(await draft.tableVersionId('head', LOGS)).not.toBe(logsVersionId);
    });
  });

  describe('the whole Draft', () => {
    const drafts: WholeDraft[] = [
      {
        holding:
          'every change but structure and a table of content-equal versions',
        given: givenEveryChangeButStructure,
      },
      {
        holding: 'an empty shared-schema table that Head lacks',
        given: givenEmptySharedSchemaTableNextToAnEdit,
      },
      {
        holding:
          'data and structure changes: a table rename, a new field, a created and a removed table and views (AS-50)',
        given: givenDataAndStructureChanges,
      },
    ];

    it.each(drafts)(
      'commits exactly { all: true } of a Draft holding $holding with the content native createRevision gives',
      async ({ given }) => {
        const native = await given();
        const partial = await given();

        await native.commit();
        await expectApplied(
          partial.commitChanges({ selection: { all: true } }),
        );

        expect(await branchContentOf(kit, partial)).toEqual(
          await branchContentOf(kit, native),
        );
      },
    );

    it.each(drafts)(
      'links into Head exactly the table versions of a Draft holding $holding, and the same versions into the new Draft without changes, as native createRevision does',
      async ({ given }) => {
        const draft = await given();
        const draftVersionIds = await draft.linkedTableVersionIds('draft');

        await expectApplied(draft.commitChanges({ selection: { all: true } }));

        expect(await draft.linkedTableVersionIds('head')).toEqual(
          draftVersionIds,
        );
        expect(await draft.linkedTableVersionIds('draft')).toEqual(
          draftVersionIds,
        );
        expect(await draft.hasChanges()).toBe(false);
      },
    );
  });

  describe('endpoint notification', () => {
    it('notifies the endpoints of the former Draft, now Head, and of the new Draft once each, after the transaction committed', async () => {
      const draft = await givenEditedPrices();
      const formerDraftRevisionId = await draft.revisionId('draft');
      const notifications = recordEndpointNotifications(kit, () =>
        branchRevisionsOf(draft),
      );

      await expectApplied(draft.commitChanges({ selection: titleOfP1 }));

      const committed = await branchRevisionsOf(draft);
      expect(committed.head).toBe(formerDraftRevisionId);
      expect(notifications).toEqual([
        { revisionId: committed.head, seenOutsideTheTransaction: committed },
        { revisionId: committed.draft, seenOutsideTheTransaction: committed },
      ]);
    });

    it('notifies nothing for a commit that writes nothing', async () => {
      const draft = await givenEditedPrices();
      const notifications = recordEndpointNotifications(kit, () =>
        branchRevisionsOf(draft),
      );

      await draft.commitChanges({ selection: titleOfP1, expected: 'other' });

      expect(notifications).toEqual([]);
    });
  });

  describe('a failure after the writes', () => {
    it('persists nothing, file references included, and notifies nothing', async () => {
      const draft = await givenHeadImageWithDraftDroppingTheImageField();
      await draft.updateRow(DOCUMENTS, 'd1', { title: 'uno' });
      const contents = await branchContentsOf(kit, draft);
      const fileReferences = await fileReferencesOf(draft);
      const notifications = recordEndpointNotifications(kit, () =>
        Promise.resolve(undefined),
      );
      failingAfterTheWrites();

      await expect(
        draft.commitChanges({
          selection: { fields: [titleOf(DOCUMENTS, 'd1')] },
        }),
      ).rejects.toThrow(INJECTED_FAILURE);

      expect(await branchContentsOf(kit, draft)).toEqual(contents);
      expect(await fileReferencesOf(draft)).toEqual(fileReferences);
      expect(notifications).toEqual([]);
    });
  });

  describe('a required unit of a table the plan did not read', () => {
    it('refuses to plan with an internal error, and writes nothing', async () => {
      const draft = await givenRenamedCategoriesOfEditedProducts();
      const selection: Selection = { tables: [GROUPS] };
      const preview = await draft.previewChanges({
        operation: 'commit',
        selection,
      });
      notReading(await identityOf(draft, PRODUCTS));
      const contents = await branchContentsOf(kit, draft);

      await expect(
        draft.commitChanges({
          selection,
          includeRequired: true,
          expected: preview.fingerprint,
        }),
      ).rejects.toThrow(
        'The plan applies units of products, whose changed rows it did not read',
      );

      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });
  });

  describe('during an async migration', () => {
    it('refuses with MigrationLocked and writes nothing', async () => {
      const draft = await givenEditedPrices();
      await givenActiveMigration(kit, draft, PRODUCTS);
      const contents = await branchContentsOf(kit, draft);

      await expect(
        draft.commitChanges({ selection: titleOfP1 }),
      ).rejects.toThrow(MigrationLockedException);

      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });
  });

  describe('the former Draft revision', () => {
    it('refuses native writes still addressed to it once it is Head', async () => {
      const draft = await givenEditedPrices();
      const formerDraftRevisionId = await draft.revisionId('draft');

      await expectApplied(draft.commitChanges({ selection: titleOfP1 }));

      await expect(
        kit.draftApi.apiUpdateRow({
          revisionId: formerDraftRevisionId,
          tableId: PRODUCTS,
          rowId: 'p2',
          data: { title: 'deux', price: 2 },
        }),
      ).rejects.toThrow('The revision is not a draft');
    });
  });

  async function expectApplied(
    committing: Promise<CommitChangesResult>,
  ): Promise<void> {
    await expect(committing).resolves.toMatchObject({ status: 'applied' });
  }

  async function expectRow(
    draft: ChangesScenario,
    side: RevisionSide,
    tableId: string,
    rowId: string,
    data: JsonValue,
  ): Promise<void> {
    const row = await draft.row(side, tableId, rowId);

    expect(row.data).toEqual(data);
    expect(row.hash).toBe(objectHash(data));
  }

  async function expectProducts(
    draft: ChangesScenario,
    side: RevisionSide,
    rows: Readonly<Record<string, JsonValue>>,
  ): Promise<void> {
    expect(await draft.rowIds(side, PRODUCTS)).toEqual(Object.keys(rows));

    for (const [rowId, data] of Object.entries(rows)) {
      await expectRow(draft, side, PRODUCTS, rowId, data);
    }
  }

  async function expectHeadLinksDraftRow(
    draft: ChangesScenario,
    tableId: string,
    rowId: string,
  ): Promise<void> {
    const head = await draft.row('head', tableId, rowId);
    const kept = await draft.row('draft', tableId, rowId);

    expect(head.versionId).toBe(kept.versionId);
  }

  async function expectDraftLinksHeadVersion(
    draft: ChangesScenario,
    tableId: string,
  ): Promise<void> {
    expect(await draft.tableVersionId('draft', tableId)).toBe(
      await draft.tableVersionId('head', tableId),
    );
  }

  function unitsOf({ units }: ListChangesResult) {
    return units.map(({ kind, rowId, path }) => ({ kind, rowId, path }));
  }

  async function viewsOf(
    draft: ChangesScenario,
    side: RevisionSide,
  ): Promise<JsonValue> {
    const row = await draft.row(side, SystemTables.Views, PRODUCTS);

    return row.data;
  }

  async function commentOf(revisionId: string): Promise<string> {
    const revision = await kit.prisma.revision.findUniqueOrThrow({
      where: { id: revisionId },
      select: { comment: true },
    });

    return revision.comment;
  }

  async function blobIdsOf(rowVersionId: string): Promise<string[]> {
    const row = await kit.prisma.row.findUniqueOrThrow({
      where: { versionId: rowVersionId },
      select: { fileBlobs: { select: { id: true } } },
    });

    return row.fileBlobs.map((blob) => blob.id).sort();
  }

  async function fileReferencesOf(draft: ChangesScenario): Promise<string[]> {
    const blobs = await kit.prisma.fileBlob.findMany({
      where: { projectId: draft.branch.projectId },
      select: { id: true, rows: { select: { versionId: true } } },
    });

    return blobs
      .flatMap(({ id, rows }) =>
        rows.map(({ versionId }) => `${id}/${versionId}`),
      )
      .sort();
  }

  function notReading(identity: string): void {
    const readScope = kit.module.get(ReadScope);
    const scopeOf = readScope.scopeOf.bind(readScope);

    jest
      .spyOn(readScope, 'scopeOf')
      .mockImplementation((selection, compared) => {
        const scope = scopeOf(selection, compared);

        return {
          ...scope,
          affectedTables: scope.affectedTables.filter(
            (table) => table.identity !== identity,
          ),
        };
      });
  }

  async function identityOf(
    draft: ChangesScenario,
    tableId: string,
  ): Promise<string> {
    const tables = await draft.userTables('draft');
    const table = tables.find(({ id }) => id === tableId);

    if (!table) {
      throw new Error(`The Draft has no table ${tableId}`);
    }

    return table.createdId;
  }

  function failingAfterTheWrites(): void {
    const api = kit.module.get(DraftRevisionTargetApiService);
    const commitToTarget = api.commitToTarget.bind(api);

    jest.spyOn(api, 'commitToTarget').mockImplementation(async (plan) => {
      await commitToTarget(plan);

      throw new Error(INJECTED_FAILURE);
    });
  }

  async function branchRevisionsOf(
    draft: ChangesScenario,
  ): Promise<{ head: string; draft: string }> {
    return {
      head: await draft.revisionId('head'),
      draft: await draft.revisionId('draft'),
    };
  }

  function givenCommittedPrices(): Promise<ChangesScenario> {
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

  async function givenEditedPrices(): Promise<ChangesScenario> {
    const draft = await givenCommittedPrices();
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 10 });
    await draft.updateRow(PRODUCTS, 'p2', { title: 'dos', price: 2 });

    return draft;
  }

  async function givenProductOfCreatedCategory(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.createRows(CATEGORIES, { c9: { title: 'nine' } });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', category: 'c9' });

    return draft;
  }

  async function givenProductNextToContentEqualCategory(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', category: 'c1' });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'other' });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'one' });

    return draft;
  }

  async function givenRenamedCategoriesOfEditedProducts(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', category: 'c1' });
    await draft.renameTable(CATEGORIES, GROUPS);

    return draft;
  }

  function givenCommittedCatalog(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { title: 'one', category: 'c1' } },
      },
    });
  }

  async function givenEditedPricesNextToContentEqualLogs(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: pricedSchema,
        rows: {
          p1: { title: 'one', price: 1 },
          p2: { title: 'two', price: 2 },
        },
      },
      [LOGS]: { schema: logSchema, rows: { l1: { entry: 'started' } } },
    });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 10 });
    await draft.updateRow(PRODUCTS, 'p2', { title: 'dos', price: 2 });
    await draft.updateRow(LOGS, 'l1', { entry: 'restarted' });
    await draft.updateRow(LOGS, 'l1', { entry: 'started' });

    return draft;
  }

  async function givenEveryChangeButStructure(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [PRODUCTS]: {
        schema: pricedSchema,
        rows: {
          p1: { title: 'one', price: 1 },
          p2: { title: 'two', price: 2 },
          p3: { title: 'three', price: 3 },
        },
      },
      [LOGS]: { schema: logSchema, rows: { l1: { entry: 'started' } } },
    });
    await draft.updateViews(PRODUCTS, productViews('All'));
    await draft.commit();
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 10 });
    await draft.removeRow(PRODUCTS, 'p2');
    await draft.renameRow(PRODUCTS, 'p3', 'p9');
    await draft.createRows(PRODUCTS, { p4: { title: 'four', price: 4 } });
    await draft.writeRowColumns(CATEGORIES, 'c1', { meta: { note: 'draft' } });
    await draft.updateViews(PRODUCTS, productViews('Renamed'));
    await draft.updateRow(LOGS, 'l1', { entry: 'restarted' });
    await draft.updateRow(LOGS, 'l1', { entry: 'started' });

    return draft;
  }

  async function givenDataAndStructureChanges(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [PRODUCTS]: {
        schema: pricedSchema,
        rows: {
          p1: { title: 'one', price: 1 },
          p2: { title: 'two', price: 2 },
        },
      },
      [LOGS]: { schema: logSchema, rows: { l1: { entry: 'started' } } },
    });
    await draft.updateViews(PRODUCTS, productViews('All'));
    await draft.commit();
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 10 });
    await draft.updateTable(PRODUCTS, [addField('color', str())]);
    await draft.renameTable(CATEGORIES, GROUPS);
    await draft.removeTable(LOGS);
    await draft.createTable(TAGS, tagSchema);
    await draft.createRows(TAGS, { t1: { label: 'one' } });
    await draft.updateViews(PRODUCTS, productViews('Renamed'));

    return draft;
  }

  async function givenEmptySharedSchemaTableNextToAnEdit(): Promise<ChangesScenario> {
    const draft = await givenCommittedPrices();
    await draft.createSharedSchema(ADDRESS, addressSchema);
    await draft.removeSharedSchema(ADDRESS);
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 1 });

    return draft;
  }

  async function givenHeadImageWithDraftDroppingTheImageField(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [DOCUMENTS]: {
        schema: documentSchema,
        rows: { d1: { title: 'one', image: emptyFile } },
      },
    });
    await draft.uploadFile(DOCUMENTS, 'd1', 'image');
    await draft.commit();
    await draft.updateTable(DOCUMENTS, [removeField('image')]);

    return draft;
  }
});

interface WholeDraft {
  readonly holding: string;
  readonly given: () => Promise<ChangesScenario>;
}

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
