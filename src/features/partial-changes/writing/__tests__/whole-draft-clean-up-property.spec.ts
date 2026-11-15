import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { InputJsonValue } from 'src/engine-prisma-types';
import type { CommitChangesResult } from 'src/features/partial-changes/commands/impl/commit-draft-changes.command';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import {
  seededRandom,
  type SeededRandom,
} from 'src/features/share/ledger-replay/__tests__/support/seeded-random';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TableViewsData } from 'src/features/views/types';
import type { ChangesScenario } from '../../__tests__/support/changes-scenario';
import {
  givenRandomDraft,
  RANDOM_DRAFT_SEED_TIMEOUT_MS,
  RANDOM_DRAFT_SEEDS,
} from '../../__tests__/support/random-draft';

const WHOLE_DRAFT: Selection = { all: true };
const OPERATIONS: ChangeOperation[] = ['commit', 'revert'];
const LEFTOVERS = ['contentEqual', 'schemaHash', 'none'] as const;
const ROW_LEFTOVERS = ['contentEqual', 'schemaHash'] as const;
const DEFAULT_VIEWS: TableViewsData = {
  version: 1,
  defaultViewId: 'default',
  views: [{ id: 'default', name: 'Default' }],
};

type Leftover = (typeof LEFTOVERS)[number];

describe('exactly { all: true } on a Draft the summary says holds only changes without effect, over random Drafts (SPEC §3.8, AS-100)', () => {
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

  it.each(RANDOM_DRAFT_SEEDS)(
    'leaves a Draft without changes and without a new revision (seed %i)',
    async (seed) => {
      const random = seededRandom(seed);
      const draft = await givenRandomDraft(kit, seed);
      await draft.commitChanges({ selection: WHOLE_DRAFT });
      await givenOnlyChangesWithoutEffect(draft, random);
      const headRevisionId = await draft.revisionId('head');

      expect(await draft.readDraftChangesSummary()).toMatchObject({
        onlyChangesWithoutEffect: true,
      });

      const result = await apply(draft, random.pick(OPERATIONS));

      expect(result).toMatchObject({
        status: 'empty',
        draftHasChanges: false,
      });
      expect(await draft.revisionId('head')).toBe(headRevisionId);
      expect(await draft.hasChanges()).toBe(false);
    },
    RANDOM_DRAFT_SEED_TIMEOUT_MS,
  );

  it.each(RANDOM_DRAFT_SEEDS)(
    'cleans up a random Draft whenever its summary says it holds only changes without effect (seed %i)',
    async (seed) => {
      const draft = await givenRandomDraft(kit, seed);
      const { onlyChangesWithoutEffect } =
        await draft.readDraftChangesSummary();

      const result = await draft.commitChanges({ selection: WHOLE_DRAFT });

      expect(
        !onlyChangesWithoutEffect || isCleanUpWithoutRevision(result),
      ).toBe(true);
    },
    RANDOM_DRAFT_SEED_TIMEOUT_MS,
  );

  // The first user table with rows gets a content-equal row version or a schema hash rewrite, every other one either or
  // nothing; when Head has no views table, a views row is also written and removed, leaving an empty views table that
  // only the Draft holds.
  async function givenOnlyChangesWithoutEffect(
    draft: ChangesScenario,
    random: SeededRandom,
  ): Promise<void> {
    let leftovers = 0;

    for (const { id } of await draft.userTables('draft')) {
      const rows = await draft.rows('draft', id);
      const leftover: Leftover =
        leftovers === 0 ? random.pick(ROW_LEFTOVERS) : random.pick(LEFTOVERS);

      if (rows.length > 0 && leftover !== 'none') {
        await writeLeftover(draft, id, random.pick(rows), leftover);
        leftovers += 1;
      }
    }

    if (!(await draft.hasTable('head', SystemTables.Views))) {
      await givenViewsSetAndRemoved(draft, random);
      leftovers += 1;
    }

    expect(leftovers).toBeGreaterThan(0);
  }

  async function writeLeftover(
    draft: ChangesScenario,
    tableId: string,
    row: { id: string; data: unknown },
    leftover: Exclude<Leftover, 'none'>,
  ): Promise<void> {
    if (leftover === 'contentEqual') {
      await draft.writeRowBelowNativeValidation(
        tableId,
        row.id,
        row.data as InputJsonValue,
      );

      return;
    }

    await draft.writeRowColumns(tableId, row.id, { schemaHash: 'other' });
  }

  async function givenViewsSetAndRemoved(
    draft: ChangesScenario,
    random: SeededRandom,
  ): Promise<void> {
    const { id } = random.pick(await draft.userTables('draft'));

    await draft.updateViews(id, DEFAULT_VIEWS);
    await draft.removeViewsRow(id);
  }

  function isCleanUpWithoutRevision(result: CommitChangesResult): boolean {
    return result.status === 'empty' && !result.draftHasChanges;
  }

  function apply(draft: ChangesScenario, operation: ChangeOperation) {
    if (operation === 'commit') {
      return draft.commitChanges({ selection: WHOLE_DRAFT });
    }

    return draft.revertChanges({ selection: WHOLE_DRAFT });
  }
});
