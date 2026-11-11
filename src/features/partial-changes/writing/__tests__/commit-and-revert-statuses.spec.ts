import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { branchContentsOf } from 'src/__tests__/fixtures/branch-content';
import { givenActiveMigration } from 'src/__tests__/fixtures/active-migration';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import type { UnappliedChanges } from 'src/features/partial-changes/commands/impl/apply-changes';
import type { CommitChangesResult } from 'src/features/partial-changes/commands/impl/commit-draft-changes.command';
import type { RevertChangesResult } from 'src/features/partial-changes/commands/impl/revert-draft-changes.command';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type {
  RowRef,
  Selection,
} from 'src/features/partial-changes/selection/selection';
import type { CommitOptions } from '../../__tests__/support/change-committing';
import { recordEndpointNotifications } from 'src/__tests__/fixtures/endpoint-notifications';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { titleOf } from '../../__tests__/support/field-refs';
import { expectRefusedBeforeAnyTransaction } from '../../__tests__/support/input-refusal';

const CATEGORIES = 'categories';
const PRODUCTS = 'products';

const categorySchema = obj({ title: str() });
const productSchema = obj({
  title: str(),
  category: str({ foreignKey: CATEGORIES }),
});
const pricedSchema = obj({ title: str(), price: num() });

const rowOf = (tableId: string, rowId: string): RowRef => ({ tableId, rowId });

const titleOfP1: Selection = { fields: [titleOf(PRODUCTS, 'p1')] };
const categoryOfP1: Selection = {
  fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/category' }],
};

const OPERATIONS: ChangeOperation[] = ['commit', 'revert'];

// The inputs both operations refuse; commit-changes.spec.ts adds the commit-only ones.
const REFUSED_INPUTS: { input: string; options: unknown }[] = [
  {
    input: 'includeRequired without expected',
    options: { selection: categoryOfP1, includeRequired: true },
  },
  {
    input: 'includeRequired given as a string',
    options: { selection: categoryOfP1, includeRequired: 'false' },
  },
  {
    input: 'includeRequired given as a number',
    options: { selection: categoryOfP1, includeRequired: 1 },
  },
  {
    input: 'an empty expected',
    options: { selection: categoryOfP1, expected: '' },
  },
  {
    input: 'expected given as a number',
    options: { selection: categoryOfP1, expected: 1 },
  },
  {
    input: 'an expected that is not a fingerprint',
    options: { selection: categoryOfP1, expected: 'other' },
  },
  {
    input: 'a malformed selection',
    options: {
      selection: {
        fields: [{ tableId: PRODUCTS, rowId: 'p1', path: 'title' }],
      },
    },
  },
  {
    input: 'a null selection',
    options: { selection: null },
  },
];

describe('statuses that commit and revert share', () => {
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

  describe.each(OPERATIONS)('a %s', (operation) => {
    const other = otherOperationOf(operation);

    it.each(REFUSED_INPUTS)(
      'refuses $input before any transaction',
      async ({ options }) => {
        const draft = await givenProductOfCreatedCategory();

        await expectRefusedBeforeAnyTransaction(kit, () =>
          applyChanges(draft, operation, options as CommitOptions),
        );
      },
    );

    it('is blocked by a selector that matches no unit next to one that does, and writes nothing', async () => {
      const draft = await givenEditedPrices();
      const contents = await branchContentsOf(kit, draft);
      const missingRow = { rows: [rowOf(PRODUCTS, 'missing')] };

      const result = await applyChanges(draft, operation, {
        selection: { ...titleOfP1, ...missingRow },
      });

      expect(result).toEqual<UnappliedChanges>({
        status: 'blocked',
        planned: true,
        blockers: [expect.objectContaining({ code: 'unmatchedSelector' })],
        blockersTotal: 1,
        required: [],
        requiredTotal: 0,
        unmatched: missingRow,
      });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });

    it('is stale and writes nothing when the selected row changed after the preview', async () => {
      const draft = await givenEditedPrices();
      const preview = await draft.previewChanges({
        operation,
        selection: titleOfP1,
      });
      await draft.updateRow(PRODUCTS, 'p1', { title: 'uno!', price: 10 });
      const contents = await branchContentsOf(kit, draft);

      const result = await applyChanges(draft, operation, {
        selection: titleOfP1,
        expected: preview.fingerprint,
      });

      expect(result).toEqual<UnappliedChanges>({
        status: 'stale',
        changed: ['content'],
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        unmatched: {},
      });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });

    it(`is stale with the fingerprint of a ${other} preview of the same selection, which a ${operation} never passes`, async () => {
      const draft = await givenEditedPrices();
      const preview = await draft.previewChanges({
        operation: other,
        selection: titleOfP1,
      });
      const contents = await branchContentsOf(kit, draft);

      const result = await applyChanges(draft, operation, {
        selection: titleOfP1,
        expected: preview.fingerprint,
      });

      expect(result).toEqual<UnappliedChanges>({
        status: 'stale',
        changed: ['operation'],
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        unmatched: {},
      });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });

    it(`is empty with the current revisions when it is repeated, and never applies a ${operation} twice`, async () => {
      const draft = await givenEditedPrices();
      const preview = await draft.previewChanges({
        operation,
        selection: titleOfP1,
      });
      await expect(
        applyChanges(draft, operation, {
          selection: titleOfP1,
          expected: preview.fingerprint,
        }),
      ).resolves.toMatchObject({ status: 'applied' });
      const contents = await branchContentsOf(kit, draft);

      const repeat = await applyChanges(draft, operation, {
        selection: titleOfP1,
        expected: preview.fingerprint,
      });

      expect(repeat).toEqual<UnappliedChanges>({
        status: 'empty',
        headRevisionId: await draft.revisionId('head'),
        draftRevisionId: await draft.revisionId('draft'),
        unmatched: titleOfP1,
      });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });

    it('is empty for exactly { all: true } of a Draft holding only content-equal versions: it creates no revision, writes nothing and leaves hasChanges true (AS-54)', async () => {
      const draft = await givenOnlyContentEqualVersions();
      const headRevisionId = await draft.revisionId('head');
      const draftRevisionId = await draft.revisionId('draft');
      const contents = await branchContentsOf(kit, draft);

      const result = await applyChanges(draft, operation, {
        selection: { all: true },
      });

      expect(result).toEqual<UnappliedChanges>({
        status: 'empty',
        headRevisionId,
        draftRevisionId,
      });
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
      expect(await draft.hasChanges()).toBe(true);
    });

    it('notifies no endpoint when it writes nothing', async () => {
      const draft = await givenEditedPrices();
      const notifications = recordEndpointNotifications(kit, () =>
        draft.revisionId('draft'),
      );

      await applyChanges(draft, operation, {
        selection: titleOfP1,
        expected: 'pcf3.AA',
      });

      expect(notifications).toEqual([]);
    });

    it('refuses with MigrationLocked during an async migration, cancels nothing and writes nothing', async () => {
      const draft = await givenEditedPrices();
      await givenActiveMigration(kit, draft, PRODUCTS);
      const contents = await branchContentsOf(kit, draft);

      await expect(
        applyChanges(draft, operation, { selection: titleOfP1 }),
      ).rejects.toThrow(MigrationLockedException);

      expect(await migrationStatusesOf(draft)).toEqual([
        MigrationStatus.PENDING,
      ]);
      expect(await branchContentsOf(kit, draft)).toEqual(contents);
    });
  });

  function applyChanges(
    draft: ChangesScenario,
    operation: ChangeOperation,
    options: CommitOptions,
  ): Promise<CommitChangesResult | RevertChangesResult> {
    if (operation === 'commit') {
      return draft.commitChanges(options);
    }

    return draft.revertChanges(options);
  }

  async function migrationStatusesOf(draft: ChangesScenario) {
    const migrations = await kit.prisma.tableMigration.findMany({
      where: { revisionId: await draft.revisionId('draft') },
      select: { status: true },
    });

    return migrations.map(({ status }) => status);
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

  async function givenOnlyContentEqualVersions(): Promise<ChangesScenario> {
    const draft = await givenCommittedPrices();
    await draft.updateRow(PRODUCTS, 'p1', { title: 'uno', price: 1 });
    await draft.updateRow(PRODUCTS, 'p1', { title: 'one', price: 1 });

    expect(await draft.hasDraftVersion(PRODUCTS, 'p1')).toBe(true);
    expect(await draft.hasChanges()).toBe(true);

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

function otherOperationOf(operation: ChangeOperation): ChangeOperation {
  if (operation === 'commit') {
    return 'revert';
  }

  return 'commit';
}
