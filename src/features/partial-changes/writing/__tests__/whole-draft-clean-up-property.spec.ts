import { obj, str } from '@revisium/schema-toolkit/mocks';
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
import type { ChangesScenario } from '../../__tests__/support/changes-scenario';
import {
  givenRandomDraft,
  RANDOM_DRAFT_SEED_TIMEOUT_MS,
  RANDOM_DRAFT_SEEDS,
} from '../../__tests__/support/random-draft';

const WHOLE_DRAFT: Selection = { all: true };
const OPERATIONS: ChangeOperation[] = ['commit', 'revert'];
const LEFTOVERS = ['contentEqual', 'schemaHash', 'none'] as const;

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

  // Every user table gets a content-equal row version, a schema hash rewrite or nothing; a Draft without any of them
  // gets a shared schema created and removed.
  async function givenOnlyChangesWithoutEffect(
    draft: ChangesScenario,
    random: SeededRandom,
  ): Promise<void> {
    let changed = false;

    for (const { id } of await draft.userTables('draft')) {
      const rows = await draft.rows('draft', id);
      const leftover: Leftover = random.pick(LEFTOVERS);

      if (rows.length > 0 && leftover !== 'none') {
        await writeLeftover(draft, id, random.pick(rows), leftover);
        changed = true;
      }
    }

    if (!changed) {
      await givenSharedSchemaCreatedAndRemoved(draft);
    }
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

  async function givenSharedSchemaCreatedAndRemoved(
    draft: ChangesScenario,
  ): Promise<void> {
    const id = (await draft.hasTable('head', SystemTables.SharedSchemas))
      ? 'leftover-address'
      : 'address';

    await draft.createSharedSchema(id, obj({ city: str() }));
    await draft.removeSharedSchema(id);
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
