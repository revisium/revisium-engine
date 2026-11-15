import { num, numFormula, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { givenActiveMigration } from 'src/__tests__/fixtures/active-migration';
import {
  branchContentOf,
  branchContentsOf,
} from 'src/__tests__/fixtures/branch-content';
import { queueWriteBehindBranchFence } from 'src/features/draft/commands/handlers/__tests__/support/branch-write-fence';
import { DraftRevisionTargetApiService } from 'src/features/draft-revision/draft-revision-target-api.service';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import type {
  ApplyChangesInput,
  NothingToApply,
} from 'src/features/partial-changes/commands/impl/apply-changes';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type {
  FieldRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import { TableEffectCheck } from 'src/features/partial-changes/writing/table-effect-check';
import { DiffService } from 'src/features/share/diff.service';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { revertWhileNativeWriteLands } from '../../__tests__/support/revert-races';
import { expectConsistentRevisions } from '../../__tests__/support/revision-consistency';

const PRODUCTS = 'products';
const LOGS = 'logs';
const ORDERS = 'orders';

const pricedSchema = obj({ title: str(), price: num() });
const logSchema = obj({ entry: str() });
const orderSchema = obj({
  price: num(),
  quantity: num(),
  total: numFormula('price * quantity'),
});

const titleOf = (rowId: string): FieldRef => ({
  tableId: PRODUCTS,
  rowId,
  path: '/title',
});

const titleOfP1: Selection = { fields: [titleOf('p1')] };
const WHOLE_DRAFT: Selection = { all: true };

const OPERATIONS: ChangeOperation[] = ['commit', 'revert'];

type ApplyOptions = Omit<ApplyChangesInput, 'branch'>;

describe('exactly { all: true } on a Draft left with only content-equal versions (SPEC §3.8, AS-54, AS-95 – AS-97)', () => {
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

  describe('after every unit was applied by selectors', () => {
    it.each(OPERATIONS)(
      'previews a %s as empty that says the Draft still has changes',
      async (operation) => {
        const draft = await givenEveryUnitApplied(operation);

        const preview = await draft.previewChanges({
          operation,
          selection: WHOLE_DRAFT,
        });

        expect(preview).toMatchObject({
          status: 'empty',
          counts: { selected: 0, required: 0 },
          blockers: [],
          unmatched: {},
          draftHasChanges: true,
        });
      },
    );

    it.each(OPERATIONS)(
      'a %s links the Head version of the content-equal table into the Draft and is empty without changes left, creating no revision',
      async (operation) => {
        const draft = await givenEveryUnitApplied(operation);
        const headRevisionId = await draft.revisionId('head');
        const draftRevisionId = await draft.revisionId('draft');
        const head = (await branchContentOf(kit, draft)).head;
        const commits = jest.spyOn(targetApi(), 'commitToTarget');

        const result = await apply(draft, operation, {
          selection: WHOLE_DRAFT,
        });

        expect(result).toEqual<NothingToApply>({
          status: 'empty',
          headRevisionId,
          draftRevisionId,
          draftHasChanges: false,
        });
        expect(commits).not.toHaveBeenCalled();
        expect(await draft.revisionId('head')).toBe(headRevisionId);
        expect(await draft.revisionId('draft')).toBe(draftRevisionId);
        expect((await branchContentOf(kit, draft)).head).toEqual(head);
        expect(await draft.tableVersionId('draft', LOGS)).toBe(
          await draft.tableVersionId('head', LOGS),
        );
        await expectDraftWithoutChanges(draft);
      },
    );

    it.each(OPERATIONS)(
      'a %s with expected, the fingerprint of its empty preview, normalises the Draft the same way',
      async (operation) => {
        const draft = await givenEveryUnitApplied(operation);
        const preview = await draft.previewChanges({
          operation,
          selection: WHOLE_DRAFT,
        });

        if (!preview.planned) {
          throw new Error('A limit stopped the preview');
        }

        const result = await apply(draft, operation, {
          selection: WHOLE_DRAFT,
          expected: preview.fingerprint,
        });

        expect(result).toMatchObject({
          status: 'empty',
          draftHasChanges: false,
        });
        await expectDraftWithoutChanges(draft);
      },
    );

    it.each(OPERATIONS)(
      'a %s keeps the Draft version when the content checks in its transaction find a difference that change detection missed',
      async (operation) => {
        const draft = await givenEveryUnitApplied(operation);
        const logsVersionId = await draft.tableVersionId('draft', LOGS);
        jest
          .spyOn(kit.module.get(DiffService), 'hasTableVersionContentDiffs')
          .mockResolvedValue(true);
        jest
          .spyOn(kit.module.get(TableEffectCheck), 'hasChangeWithEffect')
          .mockResolvedValue(true);

        const result = await apply(draft, operation, {
          selection: WHOLE_DRAFT,
        });

        expect(result).toMatchObject({
          status: 'empty',
          draftHasChanges: true,
        });
        expect(await draft.tableVersionId('draft', LOGS)).toBe(logsVersionId);
        expect(await draft.hasChanges()).toBe(true);
      },
    );

    it.each(OPERATIONS)(
      'a %s of a selection that matches nothing is empty with its unmatched selectors, says the Draft still has changes and writes nothing',
      async (operation) => {
        const draft = await givenEveryUnitApplied(operation);
        const contents = await branchContentsOf(kit, draft);

        const result = await apply(draft, operation, {
          selection: titleOfP1,
        });

        expect(result).toEqual<NothingToApply>({
          status: 'empty',
          headRevisionId: await draft.revisionId('head'),
          draftRevisionId: await draft.revisionId('draft'),
          unmatched: titleOfP1,
          draftHasChanges: true,
        });
        expect(await branchContentsOf(kit, draft)).toEqual(contents);
      },
    );

    it('a commit keeps its scope: { all: true, exclude: {} } reads every table yet is empty, writes nothing and says the Draft still has changes', async () => {
      const draft = await givenEveryUnitApplied('commit');
      const logsVersionId = await draft.tableVersionId('draft', LOGS);
      const contents = await branchContentsOf(kit, draft);

      const result = await draft.commitChanges({
        selection: { all: true, exclude: {} },
      });

      expect(result).toEqual<NothingToApply>({
        status: 'empty',
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        draftHasChanges: true,
      });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
      expect(await draft.tableVersionId('draft', LOGS)).toBe(logsVersionId);
      expect(await draft.hasChanges()).toBe(true);
    });

    it('a revert keeps its scope: { all: true, exclude: {} } is empty, writes nothing and says the Draft still has changes', async () => {
      const draft = await givenEveryUnitApplied('revert');
      const contents = await branchContentsOf(kit, draft);

      const result = await draft.revertChanges({
        selection: { all: true, exclude: {} },
      });

      expect(result).toMatchObject({ status: 'empty', draftHasChanges: true });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });
  });

  describe('a Draft left with only changes without effect', () => {
    const LEFTOVERS: {
      leftovers: string;
      given: () => Promise<ChangesScenario>;
    }[] = [
      {
        leftovers: 'a row whose only stored difference is a formula output',
        given: givenOnlyAFormulaOutputRewritten,
      },
      {
        leftovers: 'a row that differs only in its schema hash',
        given: givenOnlyASchemaHashRewritten,
      },
      {
        leftovers: 'every kind of change without effect',
        given: givenEveryKindOfChangeWithoutEffect,
      },
    ];

    describe.each(LEFTOVERS)('$leftovers', ({ given }) => {
      it.each(OPERATIONS)(
        'previews a %s of exactly { all: true } as empty that says the Draft still has changes',
        async (operation) => {
          const draft = await given();

          await expect(
            draft.previewChanges({ operation, selection: WHOLE_DRAFT }),
          ).resolves.toMatchObject({
            status: 'empty',
            counts: { selected: 0, required: 0 },
            draftHasChanges: true,
          });
        },
      );

      it.each(OPERATIONS)(
        'a %s of exactly { all: true } links the Head versions into the Draft and is empty without changes left, creating no revision',
        async (operation) => {
          const draft = await given();
          const headRevisionId = await draft.revisionId('head');
          const draftRevisionId = await draft.revisionId('draft');
          const head = (await branchContentOf(kit, draft)).head;
          const commits = jest.spyOn(targetApi(), 'commitToTarget');

          const result = await apply(draft, operation, {
            selection: WHOLE_DRAFT,
          });

          expect(result).toEqual<NothingToApply>({
            status: 'empty',
            headRevisionId,
            draftRevisionId,
            draftHasChanges: false,
          });
          expect(commits).not.toHaveBeenCalled();
          expect(await draft.revisionId('head')).toBe(headRevisionId);
          expect((await branchContentOf(kit, draft)).head).toEqual(head);
          await expectDraftEqualToHead(draft);
        },
      );
    });

    it.each(OPERATIONS)(
      'a %s keeps the Draft version when the content check in its transaction finds a change with an effect that change detection missed',
      async (operation) => {
        const draft = await givenOnlyAFormulaOutputRewritten();
        const ordersVersionId = await draft.tableVersionId('draft', ORDERS);
        jest
          .spyOn(kit.module.get(TableEffectCheck), 'hasChangeWithEffect')
          .mockResolvedValue(true);

        const result = await apply(draft, operation, {
          selection: WHOLE_DRAFT,
        });

        expect(result).toMatchObject({
          status: 'empty',
          draftHasChanges: true,
        });
        expect(await draft.tableVersionId('draft', ORDERS)).toBe(
          ordersVersionId,
        );
      },
    );

    it.each(OPERATIONS)(
      'a %s keeps its scope: { all: true, exclude: {} } on a Draft with only a stale formula output is empty and writes nothing',
      async (operation) => {
        const draft = await givenOnlyAFormulaOutputRewritten();
        const contents = await branchContentsOf(kit, draft);

        const result = await apply(draft, operation, {
          selection: { all: true, exclude: {} },
        });

        expect(result).toMatchObject({
          status: 'empty',
          draftHasChanges: true,
        });
        expect(await branchContentsOf(kit, draft)).toEqual(contents);
      },
    );

    it('a commit of exactly { all: true } beside a change with an effect applies it with the schema hash, publishes the tables without a unit as the Draft holds them, and leaves a Draft equal to Head', async () => {
      const draft = await givenEveryKindOfChangeWithoutEffect();
      await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 1 });
      const headRevisionId = await draft.revisionId('head');

      const result = await draft.commitChanges({ selection: WHOLE_DRAFT });

      expect(result).toMatchObject({
        status: 'applied',
        draftHasChanges: false,
      });
      expect(await draft.revisionId('head')).not.toBe(headRevisionId);
      expect((await draft.row('head', PRODUCTS, 'p2')).schemaHash).toBe(
        'other',
      );
      expect((await draft.row('head', ORDERS, 'o1')).data).toEqual({
        price: 2,
        quantity: 3,
        total: 7,
      });
      await expectDraftEqualToHead(draft);
    });

    it('a revert of exactly { all: true } beside a change with an effect reverts it and leaves a Draft equal to Head', async () => {
      const draft = await givenEveryKindOfChangeWithoutEffect();
      await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 1 });

      const result = await draft.revertChanges({ selection: WHOLE_DRAFT });

      expect(result).toMatchObject({
        status: 'applied',
        draftHasChanges: false,
      });
      await expectDraftEqualToHead(draft);
    });

    async function givenOnlyAFormulaOutputRewritten(): Promise<ChangesScenario> {
      const draft = await givenCommittedTablesWithOrders();
      await draft.writeRowBelowNativeValidation(ORDERS, 'o1', {
        price: 2,
        quantity: 3,
        total: 7,
      });

      return draft;
    }

    async function givenOnlyASchemaHashRewritten(): Promise<ChangesScenario> {
      const draft = await givenCommittedTablesWithOrders();
      await draft.writeRowColumns(PRODUCTS, 'p2', { schemaHash: 'other' });

      return draft;
    }

    async function givenEveryKindOfChangeWithoutEffect(): Promise<ChangesScenario> {
      const draft = await givenOnlyAFormulaOutputRewritten();
      await draft.writeRowColumns(PRODUCTS, 'p2', { schemaHash: 'other' });
      await draft.updateRow(LOGS, 'l1', { entry: 'restarted' });
      await draft.updateRow(LOGS, 'l1', { entry: 'started' });

      return draft;
    }

    function givenCommittedTablesWithOrders(): Promise<ChangesScenario> {
      return ChangesScenario.committed(kit, {
        [PRODUCTS]: {
          schema: pricedSchema,
          rows: {
            p1: { title: 'one', price: 1 },
            p2: { title: 'two', price: 2 },
          },
        },
        [LOGS]: { schema: logSchema, rows: { l1: { entry: 'started' } } },
        [ORDERS]: {
          schema: orderSchema,
          rows: { o1: { price: 2, quantity: 3, total: 6 } },
        },
      });
    }

    async function expectDraftEqualToHead(
      draft: ChangesScenario,
    ): Promise<void> {
      for (const tableId of [PRODUCTS, LOGS, ORDERS]) {
        expect([tableId, await draft.tableVersionId('draft', tableId)]).toEqual(
          [tableId, await draft.tableVersionId('head', tableId)],
        );
      }

      expect(await draft.hasChanges()).toBe(false);
      expect(await draft.readUnitList()).toMatchObject({ units: [] });
    }
  });

  describe('a Draft without any change', () => {
    it.each(OPERATIONS)(
      'a %s of exactly { all: true } is empty without changes and writes nothing',
      async (operation) => {
        const draft = await givenCommittedTables();
        const contents = await branchContentsOf(kit, draft);
        const writes = spyOnTargetWrites();

        const result = await apply(draft, operation, {
          selection: WHOLE_DRAFT,
        });

        expect(result).toEqual<NothingToApply>({
          status: 'empty',
          headRevisionId: await draft.revisionId('head'),
          draftRevisionId: await draft.revisionId('draft'),
          draftHasChanges: false,
        });
        expect(writes.calls()).toBe(0);
        expect(await branchContentsOf(kit, draft)).toEqual(contents);
      },
    );

    it.each(OPERATIONS)(
      'previews a %s of exactly { all: true } as empty without changes',
      async (operation) => {
        const draft = await givenCommittedTables();

        await expect(
          draft.previewChanges({ operation, selection: WHOLE_DRAFT }),
        ).resolves.toMatchObject({ status: 'empty', draftHasChanges: false });
      },
    );
  });

  describe('like every write', () => {
    it.each(OPERATIONS)(
      'a %s is refused with MigrationLocked during an async migration and writes nothing',
      async (operation) => {
        const draft = await givenEveryUnitApplied(operation);
        await givenActiveMigration(kit, draft, PRODUCTS);
        const contents = await branchContentsOf(kit, draft);

        await expect(
          apply(draft, operation, { selection: WHOLE_DRAFT }),
        ).rejects.toThrow(MigrationLockedException);

        expect(await branchContentsOf(kit, draft)).toEqual(contents);
      },
    );

    it('a commit waits behind an exclusive holder of the branch write fence and normalises the Draft after it', async () => {
      const draft = await givenEveryUnitApplied('commit');

      const queued = await queueWriteBehindBranchFence(
        { prismaService: kit.prisma },
        draft.branchId,
        () => draft.commitChanges({ selection: WHOLE_DRAFT }),
      );
      await queued.releaseFence();

      await expect(queued.writing).resolves.toMatchObject({
        status: 'empty',
        draftHasChanges: false,
      });
      await expectDraftWithoutChanges(draft);
    });

    it('a native edit of the content-equal row that lands after the revert planned: the attempt is retried and reverts the edit', async () => {
      const draft = await givenEveryUnitApplied('revert');

      const { result, attempts } = await revertWhileNativeWriteLands(
        kit,
        draft,
        { selection: WHOLE_DRAFT },
        () => draft.updateRow(LOGS, 'l1', { entry: 'restarted again' }),
      );

      expect(attempts).toBe(2);
      expect(result).toMatchObject({
        status: 'applied',
        applied: { selected: 1, required: 0 },
        draftHasChanges: false,
      });
      expect((await draft.row('draft', LOGS, 'l1')).data).toEqual({
        entry: 'started',
      });
      await expectConsistentRevisions(draft);
      await expectDraftWithoutChanges(draft);
    });
  });

  function apply(
    draft: ChangesScenario,
    operation: ChangeOperation,
    options: ApplyOptions,
  ) {
    if (operation === 'commit') {
      return draft.commitChanges(options);
    }

    return draft.revertChanges(options);
  }

  async function expectDraftWithoutChanges(
    draft: ChangesScenario,
  ): Promise<void> {
    expect(await draft.hasChanges()).toBe(false);
    expect((await draft.readNativeSummary()).totalChanges).toBe(0);
    expect(await draft.readDraftTableChanges({ first: 10 })).toMatchObject({
      totalCount: 0,
    });
    expect(await draft.readDraftChangesSummary()).toMatchObject({
      tablesSummary: { total: 0 },
      rowsSummary: { total: 0 },
    });
  }

  function targetApi(): DraftRevisionTargetApiService {
    return kit.module.get(DraftRevisionTargetApiService);
  }

  function spyOnTargetWrites() {
    const commits = jest.spyOn(targetApi(), 'commitToTarget');
    const reverts = jest.spyOn(targetApi(), 'revertToTarget');

    return {
      calls: () => commits.mock.calls.length + reverts.mock.calls.length,
    };
  }

  // The stand reproduction: the edited row is applied by its selector; the table whose row was edited and edited back
  // has no unit, so the selection never reads it and the Draft keeps its content-equal version.
  async function givenEveryUnitApplied(
    operation: ChangeOperation,
  ): Promise<ChangesScenario> {
    const draft = await givenCommittedTables();
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 1 });
    await draft.updateRow(LOGS, 'l1', { entry: 'restarted' });
    await draft.updateRow(LOGS, 'l1', { entry: 'started' });

    await expect(
      apply(draft, operation, { selection: titleOfP1 }),
    ).resolves.toMatchObject({ status: 'applied', draftHasChanges: true });
    expect(await draft.readUnitList()).toMatchObject({ units: [] });
    expect(await draft.tableVersionId('draft', LOGS)).not.toBe(
      await draft.tableVersionId('head', LOGS),
    );

    return draft;
  }

  function givenCommittedTables(): Promise<ChangesScenario> {
    return ChangesScenario.committed(kit, {
      [PRODUCTS]: {
        schema: pricedSchema,
        rows: { p1: { title: 'one', price: 1 } },
      },
      [LOGS]: { schema: logSchema, rows: { l1: { entry: 'started' } } },
    });
  }
});
