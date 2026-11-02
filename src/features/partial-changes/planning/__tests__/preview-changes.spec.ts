import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { branchContentsOf } from 'src/features/migration/__tests__/support/ledger-repair-planning';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { Blocker } from 'src/features/partial-changes/planning/plan-refs';
import type { PreviewChangesResult } from 'src/features/partial-changes/queries/impl/preview-draft-changes.query';
import type {
  FieldRef,
  RowRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import { SelectionValidationError } from 'src/features/partial-changes/selection/selection-validator';
import type { UnitRef } from 'src/features/partial-changes/selection/unit-refs';
import { addField } from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import {
  failingFirstSnapshotRead,
  transactionModeOfSnapshotRead,
} from '../../__tests__/support/change-preview';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { completeAsyncMigrationInPlace } from '../../__tests__/support/head-schema-damage';

const CATEGORIES = 'categories';
const PRODUCTS = 'products';
const TAGS = 'tags';
const LOGS = 'logs';
const ALPHA = 'alpha';
const BETA = 'beta';

const OPERATIONS: ChangeOperation[] = ['commit', 'revert'];
const SAMPLE_SIZE = 20;
const SHA_256_HEX = /^[0-9a-f]{64}$/;

const categorySchema = obj({ title: str() });
const productSchema = obj({
  title: str(),
  category: str({ foreignKey: CATEGORIES }),
});
const titleSchema = obj({ title: str() });
const pricedSchema = obj({ title: str(), price: num() });
const logSchema = obj({ entry: str() });

const titleOf = (tableId: string, rowId: string): FieldRef => ({
  tableId,
  rowId,
  path: '/title',
});
const rowOf = (tableId: string, rowId: string): RowRef => ({ tableId, rowId });

const titleOfC1: Selection = { fields: [titleOf(CATEGORIES, 'c1')] };
const titleOfP1: Selection = { fields: [titleOf(PRODUCTS, 'p1')] };
const priceOfP1: Selection = {
  fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/price' }],
};
const titleOfC9: Selection = { fields: [titleOf(CATEGORIES, 'c9')] };
const categoryOfP1: Selection = {
  fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/category' }],
};

const creationOfC9: UnitRef = {
  kind: 'rowCreate',
  tableId: CATEGORIES,
  rowId: 'c9',
  selector: { rows: [rowOf(CATEGORIES, 'c9')] },
};
const titleOfC1Unit: UnitRef = {
  kind: 'field',
  tableId: CATEGORIES,
  rowId: 'c1',
  path: '/title',
  selector: titleOfC1,
};

const headSchemaInconsistentCategories: Blocker = {
  code: 'headSchemaInconsistent',
  tableId: CATEGORIES,
  message:
    'categories is refused: its Head schema does not match its Head ledger',
};

const SERIALIZATION_FAILURE = Object.assign(
  new Error('Transaction failed due to a write conflict or a deadlock'),
  { code: 'P2034' },
);

describe('previewChanges', () => {
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
    it.each(OPERATIONS)(
      'is ready for a %s of a field that applies as is',
      async (operation) => {
        const draft = await givenEditedAndCreatedCategories();

        const preview = await draft.previewChanges({
          operation,
          selection: titleOfC1,
        });

        expect(preview).toMatchObject({
          status: 'ready',
          counts: { selected: 1, required: 0, remaining: 1 },
          required: [],
          blockers: [],
          sample: [titleOfC1Unit],
        });
      },
    );

    it.each(OPERATIONS)(
      'requires the creation of a row whose field a %s selects',
      async (operation) => {
        const draft = await givenEditedAndCreatedCategories();

        const preview = await draft.previewChanges({
          operation,
          selection: titleOfC9,
        });

        expect(preview).toMatchObject({
          status: 'required',
          counts: { selected: 0, required: 1, remaining: 1 },
          required: [{ unit: creationOfC9, reason: wholeRowOfC9() }],
          blockers: [],
          sample: [creationOfC9],
        });
      },
    );

    it.each(OPERATIONS)(
      'is ready for a %s with its required additions accepted, still listing them',
      async (operation) => {
        const draft = await givenEditedAndCreatedCategories();

        const preview = await draft.previewChanges({
          operation,
          selection: titleOfC9,
          includeRequired: true,
        });

        expect(preview).toMatchObject({
          status: 'ready',
          required: [{ unit: creationOfC9, reason: wholeRowOfC9() }],
        });
      },
    );

    it.each(OPERATIONS)(
      'is blocked for a %s by a blocker: the required creation is excluded',
      async (operation) => {
        const draft = await givenEditedAndCreatedCategories();

        const preview = await draft.previewChanges({
          operation,
          selection: {
            ...titleOfC9,
            exclude: { rows: [rowOf(CATEGORIES, 'c9')] },
          },
        });

        expect(preview).toMatchObject({
          status: 'blocked',
          counts: { selected: 0, required: 0, remaining: 2 },
          required: [],
          blockers: [
            {
              code: 'requiredExcluded',
              tableId: CATEGORIES,
              rowId: 'c9',
              message: 'categories/c9 is required but excluded',
              unit: creationOfC9,
              reason: wholeRowOfC9(),
            },
          ],
          sample: [],
        });
      },
    );

    it.each(OPERATIONS)(
      'is blocked for a %s by a selector that matches no unit next to one that does',
      async (operation) => {
        const draft = await givenEditedAndCreatedCategories();

        const preview = await draft.previewChanges({
          operation,
          selection: { ...titleOfC1, rows: [rowOf(CATEGORIES, 'missing')] },
        });

        expect(preview).toMatchObject({
          status: 'blocked',
          blockers: [{ code: 'unmatchedSelector' }],
          unmatched: { rows: [rowOf(CATEGORIES, 'missing')] },
          sample: [titleOfC1Unit],
        });
      },
    );

    it.each(OPERATIONS)(
      'is empty for a %s of an empty selection',
      async (operation) => {
        const draft = await givenEditedAndCreatedCategories();

        const preview = await draft.previewChanges({
          operation,
          selection: {},
        });

        expect(preview).toMatchObject({
          status: 'empty',
          counts: { selected: 0, required: 0, remaining: 0 },
          unreadTables: 1,
          blockers: [],
          unmatched: {},
        });
      },
    );

    it.each<{
      operation: ChangeOperation;
      applyNatively: (draft: ChangesScenario) => Promise<void>;
    }>([
      { operation: 'commit', applyNatively: (draft) => draft.commit() },
      { operation: 'revert', applyNatively: (draft) => draft.revertNatively() },
    ])(
      'is empty with the current revisions when a $operation is repeated after the Draft equals Head',
      async ({ operation, applyNatively }) => {
        const draft = await givenEditedAndCreatedCategories();
        await draft.previewChanges({ operation, selection: titleOfC1 });
        await applyNatively(draft);

        const preview = await draft.previewChanges({
          operation,
          selection: titleOfC1,
        });

        expect(preview).toMatchObject({
          status: 'empty',
          headRevisionId: await draft.revisionId('head'),
          draftRevisionId: await draft.revisionId('draft'),
          counts: { selected: 0, required: 0, remaining: 0 },
          blockers: [],
          unmatched: titleOfC1,
        });
      },
    );

    it.each(OPERATIONS)(
      'is empty, reporting the unmatched selector, when a %s is repeated and only its exclusion still matches',
      async (operation) => {
        const draft = await givenTitleAndPriceEdits();
        const selection = { ...titleOfP1, exclude: priceOfP1 };
        await expect(
          draft.previewChanges({ operation, selection }),
        ).resolves.toMatchObject({ status: 'ready' });
        await draft.updateRow(PRODUCTS, 'p1', { title: 'one', price: 2 });

        const preview = await draft.previewChanges({ operation, selection });

        expect(preview).toMatchObject({
          status: 'empty',
          counts: { selected: 0, required: 0, remaining: 1 },
          blockers: [],
          sample: [],
          unmatched: titleOfP1,
        });
      },
    );
  });

  describe('Head-side selectors', () => {
    it("addresses with side: 'head' the Head table whose id a rename took over, requiring its restoration and the reversal of the rename", async () => {
      const draft = await givenTableIdTakenOverByARename();

      const preview = await draft.previewChanges({
        operation: 'revert',
        selection: { rows: [{ ...rowOf(ALPHA, 'a1'), side: 'head' }] },
      });

      expect(preview).toMatchObject({
        status: 'required',
        counts: { selected: 0, required: 2 },
        required: [
          {
            unit: {
              kind: 'structure',
              tableId: ALPHA,
              side: 'head',
              selector: { tables: [{ tableId: ALPHA, side: 'head' }] },
            },
            reason: { code: 'structureBoundData', tableId: ALPHA, rowId: 'a1' },
          },
          {
            unit: {
              kind: 'structure',
              tableId: ALPHA,
              previousTableId: BETA,
              selector: { tables: [ALPHA] },
            },
            reason: { code: 'idOccupied', tableId: ALPHA },
          },
        ],
        blockers: [],
        unmatched: {},
      });
    });

    it('keeps resolving a listed Head-side row selector by the Draft id of a renamed table', async () => {
      const draft = await givenRowIdTakenOverInARenamedTable();
      const { units } = await draft.listChanges();
      const deletion = units.find(({ kind }) => kind === 'rowDelete');

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: deletion?.selector ?? {},
      });

      expect(deletion).toMatchObject({
        tableId: BETA,
        rowId: 'b1',
        side: 'head',
      });
      expect(preview).toMatchObject({
        status: 'ready',
        sample: [
          { kind: 'rowDelete', tableId: BETA, rowId: 'b1', side: 'head' },
        ],
      });
    });
  });

  describe('validation', () => {
    it('blocks a commit whose merged row fails its target schema with invalidRow', async () => {
      const draft = await givenProductWithInvalidPrice();
      const priceField = { tableId: PRODUCTS, rowId: 'p1', path: '/price' };

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: priceOfP1,
      });

      expect(preview).toMatchObject({
        status: 'blocked',
        blockers: [
          {
            code: 'invalidRow',
            tableId: PRODUCTS,
            rowId: 'p1',
            unit: { kind: 'field', ...priceField, selector: priceOfP1 },
          },
        ],
      });
    });
  });

  describe('output', () => {
    it('returns every field of SPEC §5.3 for a commit that requires a created row', async () => {
      const draft = await givenProductOfCreatedCategory();

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: categoryOfP1,
      });

      expect(preview).toEqual<PreviewChangesResult>({
        status: 'required',
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        fingerprint: await draft.fingerprintPlan('commit', categoryOfP1),
        counts: { selected: 1, required: 1, remaining: 2 },
        unreadTables: 0,
        refusedTables: [],
        required: [
          {
            unit: creationOfC9,
            reason: {
              code: 'referencedRowMissing',
              tableId: PRODUCTS,
              rowId: 'p1',
              path: '/category',
              because:
                'products/p1/category references categories/c9, which exists only in the Draft',
            },
          },
        ],
        blockers: [],
        deferred: [],
        sample: [
          creationOfC9,
          {
            kind: 'field',
            tableId: PRODUCTS,
            rowId: 'p1',
            path: '/category',
            selector: categoryOfP1,
          },
        ],
        unmatched: {},
        estimate: {
          changedRows: 3,
          mergedRows: 1,
          perRowWorkRows: 0,
          mixedTables: [
            { tableId: CATEGORIES, linksCopied: 1, linksAdded: 1 },
            { tableId: PRODUCTS, linksCopied: 1, linksAdded: 1 },
          ],
        },
      });
    });

    it('requires for a revert of a created row the remaining edit that references it', async () => {
      const draft = await givenProductOfCreatedCategory();

      const preview = await draft.previewChanges({
        operation: 'revert',
        selection: { rows: [rowOf(CATEGORIES, 'c9')] },
      });

      expect(preview).toMatchObject({
        status: 'required',
        counts: { selected: 1, required: 1, remaining: 2 },
        required: [
          {
            unit: {
              kind: 'field',
              tableId: PRODUCTS,
              rowId: 'p1',
              path: '/category',
              selector: categoryOfP1,
            },
            reason: { code: 'referrerStillReferences' },
          },
        ],
        deferred: [],
      });
    });

    it('samples the first 20 applied units in listing order, with their selectors', async () => {
      const draft = await givenProductsWithEditedTitles(25);

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: { all: true },
      });
      const listing = await draft.listChanges();

      expect(preview.counts.selected).toBe(25);
      expect(preview.sample).toHaveLength(SAMPLE_SIZE);
      expect(preview.sample).toEqual(listing.units.slice(0, SAMPLE_SIZE));
    });

    it('defers the changed fields of a row a commit takes without its structure, and a revert defers nothing', async () => {
      const draft = await givenCreatedRowWithNewField();
      const selection = { rows: [rowOf(PRODUCTS, 'p2')] };

      const commit = await draft.previewChanges({
        operation: 'commit',
        selection,
      });
      const revert = await draft.previewChanges({
        operation: 'revert',
        selection,
      });

      expect(commit).toMatchObject({
        status: 'ready',
        deferred: [
          {
            unit: {
              kind: 'rowCreate',
              tableId: PRODUCTS,
              rowId: 'p2',
              selector: selection,
            },
            paths: ['/color'],
            structure: {
              kind: 'structure',
              tableId: PRODUCTS,
              selector: { tables: [PRODUCTS] },
            },
          },
        ],
      });
      expect(revert).toMatchObject({ status: 'ready', deferred: [] });
    });
  });

  describe('structure units', () => {
    it('plans a commit of a structure unit as ready, as it plans its revert', async () => {
      const draft = await givenProductsWithNewField();
      const selection = { tables: [PRODUCTS] };

      const commit = await draft.previewChanges({
        operation: 'commit',
        selection,
      });
      const revert = await draft.previewChanges({
        operation: 'revert',
        selection,
      });

      expect(commit).toMatchObject({ status: 'ready', blockers: [] });
      expect(revert).toMatchObject({ status: 'ready', blockers: [] });
    });

    it('requires the structure unit of a created table for its row in a commit, as in a revert', async () => {
      const draft = await givenCreatedTable();
      const selection = { rows: [rowOf(TAGS, 't1')] };

      const commit = await draft.previewChanges({
        operation: 'commit',
        selection,
      });
      const revert = await draft.previewChanges({
        operation: 'revert',
        selection,
      });

      expect(commit).toMatchObject({
        status: 'required',
        required: [{ unit: structureOf(TAGS) }],
        blockers: [],
      });
      expect(revert).toMatchObject({
        status: 'required',
        required: [{ unit: structureOf(TAGS) }],
        blockers: [],
      });
    });

    it('plans a commit of exactly { all: true } holding a structure unit as ready', async () => {
      const draft = await givenProductsWithNewField();

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: { all: true },
      });

      expect(preview).toMatchObject({ status: 'ready', blockers: [] });
    });
  });

  describe('read scope', () => {
    it('returns every refused table of the branch and none for exactly { all: true }', async () => {
      const draft = await givenUnledgeredProductsNextToEditedCategories();

      const partial = await draft.previewChanges({
        operation: 'commit',
        selection: titleOfC1,
      });
      const whole = await draft.previewChanges({
        operation: 'commit',
        selection: { all: true },
      });

      expect(partial).toMatchObject({
        status: 'ready',
        refusedTables: [{ tableId: PRODUCTS, code: 'unledgeredTable' }],
      });
      expect(whole).toMatchObject({ status: 'ready', refusedTables: [] });
    });

    it.each(OPERATIONS)(
      'blocks a %s whose selector names a refused table with its code, not as unmatched',
      async (operation) => {
        const draft = await givenUnledgeredProductsNextToEditedCategories();

        const preview = await draft.previewChanges({
          operation,
          selection: { fields: [titleOf(PRODUCTS, 'p1')] },
        });

        expect(preview).toMatchObject({
          status: 'blocked',
          blockers: [{ code: 'unledgeredTable', tableId: PRODUCTS }],
          unmatched: {},
        });
      },
    );

    it('counts unread tables apart from the remaining units', async () => {
      const draft = await givenCategoryEditNextToEditedLogs();

      const partial = await draft.previewChanges({
        operation: 'commit',
        selection: titleOfC1,
      });
      const whole = await draft.previewChanges({
        operation: 'commit',
        selection: { all: true },
      });

      expect(partial).toMatchObject({
        unreadTables: 1,
        counts: { selected: 1, required: 0, remaining: 0 },
      });
      expect(whole).toMatchObject({
        unreadTables: 0,
        counts: { selected: 3, required: 0, remaining: 0 },
      });
    });

    it.each(OPERATIONS)(
      'blocks a %s of a Draft whose ledger is inconsistent with ledgerInconsistent',
      async (operation) => {
        const draft =
          await givenCategoryEditNextToProductsWithRewrittenHistory();

        const preview = await draft.previewChanges({
          operation,
          selection: titleOfC1,
        });

        expect(preview).toMatchObject({
          status: 'blocked',
          blockers: [
            {
              code: 'ledgerInconsistent',
              tableId: PRODUCTS,
              message:
                'The Draft schema history of products does not extend its Head history',
            },
          ],
        });
      },
    );
  });

  describe('refused tables', () => {
    it.each<{
      damage: string;
      given: () => Promise<ChangesScenario>;
      refusal: Blocker;
    }>([
      {
        damage: 'an async migration completed in place and not yet published',
        given: () => givenReferenceToRowCreatedInMigratedCategories(),
        refusal: headSchemaInconsistentCategories,
      },
      {
        damage: 'an async migration completed in place and published natively',
        given: () => givenReferenceToRowCreatedInMigratedCategories(true),
        refusal: headSchemaInconsistentCategories,
      },
    ])(
      'blocks a commit whose required row would come from the table left by $damage with its refusal code',
      async ({ given, refusal }) => {
        const draft = await given();

        const preview = await draft.previewChanges({
          operation: 'commit',
          selection: categoryOfP1,
        });

        expect(preview).toMatchObject({
          status: 'blocked',
          required: [],
          blockers: [refusal],
          refusedTables: [{ tableId: CATEGORIES, code: refusal.code }],
        });
      },
    );

    it('blocks a revert that restores a table whose rows reference a row only the refused table could restore', async () => {
      const draft =
        await givenRemovedReferrerOfARowDeletedInMigratedCategories();

      const preview = await draft.previewChanges({
        operation: 'revert',
        selection: { tables: [PRODUCTS] },
      });

      expect(preview).toMatchObject({
        status: 'blocked',
        blockers: [headSchemaInconsistentCategories],
      });
    });
  });

  describe('fingerprint', () => {
    it.each(OPERATIONS)(
      'is the fingerprint PlanFingerprint computes for the same %s plan',
      async (operation) => {
        const draft = await givenEditedAndCreatedCategories();

        const preview = await draft.previewChanges({
          operation,
          selection: titleOfC1,
        });

        expect(preview.fingerprint).toMatch(SHA_256_HEX);
        expect(preview.fingerprint).toBe(
          await draft.fingerprintPlan(operation, titleOfC1),
        );
      },
    );

    it('changes when content the plan covers changes, and not when another table changes', async () => {
      const draft = await givenCategoryEditNextToEditedLogs();
      const preview = () =>
        draft.previewChanges({ operation: 'commit', selection: titleOfC1 });
      const before = await preview();

      await draft.updateRow(LOGS, 'l1', { entry: 'edited again' });
      const afterUnreadEdit = await preview();
      await draft.updateRow(CATEGORIES, 'c1', { title: 'edited again' });
      const afterCoveredEdit = await preview();

      expect(afterUnreadEdit.fingerprint).toBe(before.fingerprint);
      expect(afterCoveredEdit.fingerprint).not.toBe(before.fingerprint);
    });
  });

  describe('transaction', () => {
    it('changes nothing in the branch', async () => {
      const draft = await givenProductOfCreatedCategory();
      const before = await branchContentsOf(kit, draft);

      for (const operation of OPERATIONS) {
        await draft.previewChanges({
          operation,
          selection: { ...categoryOfP1, rows: [rowOf(CATEGORIES, 'c9')] },
          includeRequired: true,
        });
      }

      expect(await branchContentsOf(kit, draft)).toEqual(before);
    });

    it('plans in one read-only RepeatableRead transaction', async () => {
      const draft = await givenEditedAndCreatedCategories();

      const mode = await transactionModeOfSnapshotRead(kit, () =>
        draft.previewChanges({ operation: 'revert', selection: titleOfC1 }),
      );

      expect(mode).toEqual({ readOnly: 'on', isolation: 'repeatable read' });
    });

    it('fails without a retry when planning fails, even on a serialization failure', async () => {
      const draft = await givenEditedAndCreatedCategories();
      const reads = failingFirstSnapshotRead(kit, SERIALIZATION_FAILURE);

      await expect(
        draft.previewChanges({ operation: 'commit', selection: titleOfC1 }),
      ).rejects.toMatchObject({ code: 'P2034' });
      expect(reads).toHaveBeenCalledTimes(1);
    });
  });

  describe('input', () => {
    it.each<{ input: string; selection: unknown; operation: unknown }>([
      {
        input: 'a malformed selection',
        selection: {
          fields: [{ tableId: CATEGORIES, rowId: 'c1', path: 'title' }],
        },
        operation: 'commit',
      },
      {
        input: 'an unknown operation',
        selection: titleOfC1,
        operation: 'publish',
      },
    ])(
      'refuses $input before any transaction',
      async ({ selection, operation }) => {
        const draft = await givenEditedAndCreatedCategories();
        const reads = jest.spyOn(kit.snapshotReader, 'readSnapshot');

        await expect(
          draft.previewChanges({
            operation: operation as ChangeOperation,
            selection: selection as Selection,
          }),
        ).rejects.toThrow(SelectionValidationError);
        expect(reads).not.toHaveBeenCalled();
      },
    );
  });

  async function givenEditedAndCreatedCategories(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
    });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'uno' });
    await draft.createRows(CATEGORIES, { c9: { title: 'nine' } });

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
    await draft.updateRow(CATEGORIES, 'c1', { title: 'uno' });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', category: 'c9' });

    return draft;
  }

  async function givenTitleAndPriceEdits(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: pricedSchema,
        rows: { p1: { title: 'one', price: 1 } },
      },
    });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 2 });

    return draft;
  }

  async function givenTableIdTakenOverByARename(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [ALPHA]: { schema: titleSchema, rows: { a1: { title: 'one' } } },
      [BETA]: { schema: titleSchema, rows: { b1: { title: 'one' } } },
    });
    await draft.removeTable(ALPHA);
    await draft.renameTable(BETA, ALPHA);

    return draft;
  }

  async function givenRowIdTakenOverInARenamedTable(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [ALPHA]: {
        schema: titleSchema,
        rows: { b1: { title: 'one' }, b2: { title: 'two' } },
      },
    });
    await draft.renameTable(ALPHA, BETA);
    await draft.removeRow(BETA, 'b1');
    await draft.renameRow(BETA, 'b2', 'b1');

    return draft;
  }

  async function givenReferenceToRowCreatedInMigratedCategories(
    published = false,
  ): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { title: 'one', category: 'c1' } },
      },
    });
    await completeAsyncMigrationInPlace(kit, draft, CATEGORIES, [
      addField('color', str()),
    ]);

    if (published) {
      await draft.commit();
    }

    await draft.createRows(CATEGORIES, { c9: { title: 'nine', color: '' } });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'one', category: 'c9' });

    return draft;
  }

  async function givenRemovedReferrerOfARowDeletedInMigratedCategories(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { title: 'one', category: 'c1' } },
      },
    });
    await completeAsyncMigrationInPlace(kit, draft, CATEGORIES, [
      addField('color', str()),
    ]);
    await draft.removeTable(PRODUCTS);
    await draft.removeRow(CATEGORIES, 'c1');

    return draft;
  }

  async function givenProductWithInvalidPrice(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: pricedSchema,
        rows: { p1: { title: 'one', price: 1 } },
      },
    });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 2 });
    await draft.writeInvalidRow(PRODUCTS, 'p1', { title: 'uno', price: 'ten' });

    return draft;
  }

  async function givenProductsWithEditedTitles(
    count: number,
  ): Promise<ChangesScenario> {
    const rowIds = Array.from({ length: count }, (_, index) => `p${index + 1}`);
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: titleSchema,
        rows: Object.fromEntries(rowIds.map((rowId) => [rowId, { title: '' }])),
      },
    });

    for (const rowId of rowIds) {
      await draft.updateRow(PRODUCTS, rowId, { title: rowId });
    }

    return draft;
  }

  async function givenProductsWithNewField(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: { schema: titleSchema, rows: { p1: { title: 'one' } } },
    });
    await draft.updateTable(PRODUCTS, [addField('color', str())]);

    return draft;
  }

  async function givenCreatedRowWithNewField(): Promise<ChangesScenario> {
    const draft = await givenProductsWithNewField();
    await draft.createRows(PRODUCTS, { p2: { title: 'two', color: 'red' } });

    return draft;
  }

  async function givenCreatedTable(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
    });
    await draft.createTable(TAGS, titleSchema);
    await draft.createRows(TAGS, { t1: { title: 'one' } });

    return draft;
  }

  async function givenUnledgeredProductsNextToEditedCategories(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
    });
    await draft.createTable(PRODUCTS, titleSchema);
    await draft.createRows(PRODUCTS, { p1: { title: 'one' } });
    await draft.dropFromDraftLedger('init', PRODUCTS);
    await draft.commit();
    await draft.updateRow(PRODUCTS, 'p1', { title: 'edited' });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'edited' });

    return draft;
  }

  async function givenCategoryEditNextToEditedLogs(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [LOGS]: {
        schema: logSchema,
        rows: { l1: { entry: 'one' }, l2: { entry: 'two' } },
      },
    });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'edited' });
    await draft.updateRow(LOGS, 'l1', { entry: 'edited' });
    await draft.updateRow(LOGS, 'l2', { entry: 'edited' });

    return draft;
  }

  async function givenCategoryEditNextToProductsWithRewrittenHistory(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [PRODUCTS]: { schema: titleSchema, rows: { p1: { title: 'one' } } },
    });
    await draft.updateRow(CATEGORIES, 'c1', { title: 'edited' });
    await draft.rewriteSchemaHistory(PRODUCTS, []);

    return draft;
  }
});

function wholeRowOfC9() {
  return {
    code: 'wholeRowUnit',
    tableId: CATEGORIES,
    rowId: 'c9',
    path: '/title',
    because: 'categories/c9 is created, deleted or replaced as a whole row',
  };
}

function structureOf(tableId: string): UnitRef {
  return { kind: 'structure', tableId, selector: { tables: [tableId] } };
}
