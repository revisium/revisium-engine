import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { branchContentsOf } from 'src/__tests__/fixtures/branch-content';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { PlanBlocker } from 'src/features/partial-changes/planning/plan-refs';
import type { PreviewChangesResult } from 'src/features/partial-changes/queries/impl/preview-draft-changes.query';
import type {
  FieldRef,
  RowRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import type { UnitRef } from 'src/features/partial-changes/selection/unit-refs';
import { addField } from 'src/__tests__/fixtures/ledger-steps';
import { completeAsyncMigrationInPlace } from 'src/__tests__/fixtures/head-schema-damage';
import {
  failingFirstSnapshotRead,
  transactionModeOfSnapshotRead,
} from '../../__tests__/support/change-preview';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { FORBIDDEN_NULL_FIELDS } from '../../__tests__/support/forbidden-null-fields';
import { expectRefusedBeforeAnyTransaction } from '../../__tests__/support/input-refusal';
import {
  sourceLedgersOf,
  sourceReplaysDuring,
} from '../../__tests__/support/ledger-replaying';

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
const categoryOfP1Unit: UnitRef = {
  kind: 'field',
  tableId: PRODUCTS,
  rowId: 'p1',
  path: '/category',
  selector: categoryOfP1,
};
const titleOfC1Unit: UnitRef = {
  kind: 'field',
  tableId: CATEGORIES,
  rowId: 'c1',
  path: '/title',
  selector: titleOfC1,
};

const headSchemaInconsistentCategories: PlanBlocker = {
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
              selector: { structures: [{ tableId: ALPHA, side: 'head' }] },
            },
            reason: {
              code: 'structureBoundData',
              site: { kind: 'selector', tableId: ALPHA, rowId: 'a1' },
            },
          },
          {
            unit: {
              kind: 'structure',
              tableId: ALPHA,
              previousTableId: BETA,
              selector: { structures: [{ tableId: ALPHA }] },
            },
            reason: { code: 'idOccupied', site: { tableId: ALPHA } },
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
              because:
                'products/p1/category references categories/c9, which exists only in the Draft',
              site: {
                kind: 'row',
                tableId: PRODUCTS,
                rowId: 'p1',
                path: '/category',
              },
              references: { kind: 'row', tableId: CATEGORIES, rowId: 'c9' },
              cause: { unit: categoryOfP1Unit, role: 'referrer' },
            },
          },
        ],
        blockers: [],
        deferred: [],
        sample: [creationOfC9, categoryOfP1Unit],
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
            defaulted: [],
            omitted: [{ path: '/color' }],
            structure: {
              kind: 'structure',
              tableId: PRODUCTS,
              selector: { structures: [{ tableId: PRODUCTS }] },
            },
          },
        ],
      });
      expect(revert).toMatchObject({ status: 'ready', deferred: [] });
    });

    it('lists deferred rows in the listing order of their units, across tables', async () => {
      const draft = await givenTwoTablesWithNewFields();
      const created = [
        [PRODUCTS, 'p6'],
        [CATEGORIES, 'c3'],
        [PRODUCTS, 'p2'],
        [CATEGORIES, 'c2'],
        [PRODUCTS, 'p4'],
      ] as const;
      for (const [tableId, rowId] of created) {
        await draft.createRows(tableId, {
          [rowId]: { title: rowId, color: 'red' },
        });
      }

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: {
          rows: created.map(([tableId, rowId]) => rowOf(tableId, rowId)),
        },
      });
      const listing = await draft.listChanges();
      const keyOf = (unit: { kind: string; tableId?: string }): string =>
        `${unit.tableId}/${'rowId' in unit ? String(unit.rowId) : ''}`;

      expect(preview.deferred.map(({ unit }) => keyOf(unit))).toEqual(
        listing.units
          .filter(({ kind }) => kind === 'rowCreate')
          .map((unit) => keyOf(unit)),
      );
      expect(preview.deferred.map(({ unit }) => keyOf(unit))).toEqual([
        'categories/c2',
        'categories/c3',
        'products/p2',
        'products/p4',
        'products/p6',
      ]);
    });
  });

  describe('structure units', () => {
    it('plans a commit of a structure unit as ready, as it plans its revert', async () => {
      const draft = await givenProductsWithNewField();
      const selection = { structures: [{ tableId: PRODUCTS }] };

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

  describe('the whole Draft', () => {
    const danglingDrafts: DanglingDraft[] = [
      {
        holding: 'a value that references a row of neither revision',
        given: givenProductReferencingMissingCategory,
        blocker: {
          code: 'danglingInSource',
          tableId: PRODUCTS,
          rowId: 'p1',
          path: '/category',
          message:
            'No unit can restore consistency: products/p1/category references categories/c404, which the new Head does not contain',
          unit: {
            kind: 'field',
            tableId: PRODUCTS,
            rowId: 'p1',
            path: '/category',
            selector: categoryOfP1,
          },
        },
      },
      {
        holding: 'an unchanged row that references a row the Draft deleted',
        given: givenCategoryDeletedUnderUnchangedProduct,
        blocker: {
          code: 'danglingInSource',
          tableId: PRODUCTS,
          rowId: 'p1',
          path: '/category',
          message:
            'No unit can restore consistency: products/p1/category references categories/c1, which the new Head loses',
          unit: {
            kind: 'rowDelete',
            tableId: CATEGORIES,
            rowId: 'c1',
            selector: { rows: [rowOf(CATEGORIES, 'c1')] },
          },
        },
      },
    ];

    it.each(danglingDrafts)(
      'blocks a commit of exactly { all: true } with danglingInSource when the Draft holds $holding (AS-36)',
      async ({ given, blocker }) => {
        const draft = await given();

        const preview = await draft.previewChanges({
          operation: 'commit',
          selection: { all: true },
        });

        expect(preview).toMatchObject({
          status: 'blocked',
          required: [],
          blockers: [blocker],
        });
      },
    );

    it.each(danglingDrafts)(
      'plans a revert of exactly { all: true } as ready when the Draft holds $holding, since the Head it restores holds no dangling reference (AS-36)',
      async ({ given }) => {
        const draft = await given();

        const preview = await draft.previewChanges({
          operation: 'revert',
          selection: { all: true },
        });

        expect(preview).toMatchObject({
          status: 'ready',
          required: [],
          blockers: [],
        });
      },
    );

    it.each(OPERATIONS)(
      'is empty for a %s of exactly { all: true } of a Draft holding only content-equal versions (AS-54)',
      async (operation) => {
        const draft = await givenOnlyContentEqualVersions();

        const preview = await draft.previewChanges({
          operation,
          selection: { all: true },
        });

        expect(preview).toMatchObject({
          status: 'empty',
          counts: { selected: 0, required: 0, remaining: 0 },
          unreadTables: 0,
          blockers: [],
          sample: [],
          unmatched: {},
        });
      },
    );
  });

  describe('ledger replays', () => {
    it('replays the Head and Draft ledgers once each to plan a revert that moves pending migrations', async () => {
      const draft = await givenTwoTablesWithNewFields();
      const sourceLedgers = await sourceLedgersOf(draft);

      const replays = await sourceReplaysDuring(kit, sourceLedgers, () =>
        draft.previewChanges({
          operation: 'revert',
          selection: { structures: [{ tableId: PRODUCTS }] },
        }),
      );

      expect(replays).toEqual({ head: 1, draft: 1 });
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
      refusal: PlanBlocker;
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
        selection: { structures: [{ tableId: PRODUCTS }] },
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
    it('previews with includeRequired and optional selection fields given as null as it previews without them', async () => {
      const draft = await givenEditedAndCreatedCategories();

      const preview = await draft.previewChanges({
        operation: 'commit',
        selection: {
          all: null,
          rows: [{ tableId: CATEGORIES, rowId: 'c9', side: null }],
          fields: null,
          exclude: { rows: null },
        },
        includeRequired: null,
      });

      expect(preview).toEqual(
        await draft.previewChanges({
          operation: 'commit',
          selection: { rows: [rowOf(CATEGORIES, 'c9')], exclude: {} },
        }),
      );
    });

    it.each<{
      input: string;
      selection: unknown;
      operation: unknown;
      includeRequired?: unknown;
    }>([
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
      {
        input: 'a null selection',
        selection: null,
        operation: 'commit',
      },
      {
        input: 'a null operation',
        selection: titleOfC1,
        operation: null,
      },
      {
        input: 'a selector with a null row id',
        selection: { rows: [{ tableId: CATEGORIES, rowId: null }] },
        operation: 'commit',
      },
      {
        input: 'includeRequired given as a string',
        selection: titleOfC1,
        operation: 'commit',
        includeRequired: 'false',
      },
      {
        input: 'includeRequired given as a number',
        selection: titleOfC1,
        operation: 'commit',
        includeRequired: 1,
      },
      ...FORBIDDEN_NULL_FIELDS.map(({ field, selection }) => ({
        input: `${field} given as null`,
        selection,
        operation: 'commit',
      })),
    ])(
      'refuses $input before any transaction',
      async ({ selection, operation, includeRequired }) => {
        const draft = await givenEditedAndCreatedCategories();

        await expectRefusedBeforeAnyTransaction(kit, () =>
          draft.previewChanges({
            operation: operation as ChangeOperation,
            selection: selection as Selection,
            includeRequired: includeRequired as boolean,
          }),
        );
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

  function givenCommittedCatalog(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [PRODUCTS]: {
        schema: productSchema,
        rows: { p1: { title: 'one', category: 'c1' } },
      },
    });
  }

  async function givenProductReferencingMissingCategory(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.writeDanglingReference(PRODUCTS, 'p1', {
      title: 'one',
      category: 'c404',
    });

    return draft;
  }

  async function givenCategoryDeletedUnderUnchangedProduct(): Promise<ChangesScenario> {
    const draft = await givenCommittedCatalog();
    await draft.removeReferencedRows(CATEGORIES, ['c1']);

    expect(await draft.hasDraftVersion(PRODUCTS, 'p1')).toBe(false);

    return draft;
  }

  async function givenOnlyContentEqualVersions(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: pricedSchema,
        rows: { p1: { title: 'one', price: 1 } },
      },
    });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 1 });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'one', price: 1 });

    expect(await draft.hasDraftVersion(PRODUCTS, 'p1')).toBe(true);
    expect(await draft.hasChanges()).toBe(true);

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

  async function givenTwoTablesWithNewFields(): Promise<ChangesScenario> {
    const draft = await ChangesScenario.committed(kit, {
      [CATEGORIES]: { schema: categorySchema, rows: { c1: { title: 'one' } } },
      [PRODUCTS]: { schema: titleSchema, rows: { p1: { title: 'one' } } },
    });
    await draft.updateTable(CATEGORIES, [addField('color', str())]);
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

interface DanglingDraft {
  readonly holding: string;
  readonly given: () => Promise<ChangesScenario>;
  readonly blocker: PlanBlocker;
}

function wholeRowOfC9() {
  return {
    code: 'wholeRowUnit',
    because: 'categories/c9 is created, deleted or replaced as a whole row',
    site: {
      kind: 'selector',
      tableId: CATEGORIES,
      rowId: 'c9',
      path: '/title',
    },
  };
}

function structureOf(tableId: string): UnitRef {
  return {
    kind: 'structure',
    tableId,
    selector: { structures: [{ tableId }] },
  };
}
