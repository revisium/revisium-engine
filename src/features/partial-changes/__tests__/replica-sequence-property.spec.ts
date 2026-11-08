import { pendingMigrationsNotAfterPublished } from 'src/__tests__/fixtures/ledger-replicas';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ApplyStatus } from 'src/features/partial-changes/commands/impl/apply-changes';
import type { ListedUnit } from 'src/features/partial-changes/queries/impl/list-draft-changes.query';
import {
  RANDOM_DRAFT_SEED_TIMEOUT_MS,
  RANDOM_DRAFT_SEEDS,
} from './support/random-draft';
import {
  ReplicaSequence,
  StepKindCoverage,
  type TakenStep,
} from './support/replica-sequence';

const STEPS_PER_SEQUENCE = 20;

describe('mixed native and partial sequences with a Head-synced replica (AS-41)', () => {
  let kit: PartialChangesTestKit;
  const coverage = new StepKindCoverage();

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
    'keeps every pending migration after the published ones and the replica accepting every commit (seed %i)',
    async (seed) => {
      const sequence = await ReplicaSequence.overRandomDraft(kit, seed);

      const opening = await sequence.commitTheLaterOfTwoNewTables();
      expect(opening.renumbered).not.toEqual([]);
      await expectStepAppliedWithTheReplicaInStep(sequence, opening);

      for (let taken = 1; taken < STEPS_PER_SEQUENCE; taken += 1) {
        const step = await sequence.takeRandomStep();
        coverage.record(step);
        await expectStepAppliedWithTheReplicaInStep(sequence, step);
      }

      const left = await sequence.draft.listEveryUnit();
      const { step, status } = await sequence.commitEverything();
      expect({ step, status }).toEqual({
        step,
        status: statusOfCommittingEverything(left),
      });
      expect(await sequence.draft.listEveryUnit()).toEqual([]);
      expect(await sequence.draft.hasChanges()).toBe(false);
      await sequence.replica.syncWith(sequence.draft);
      await sequence.replica.expectSchemasOf(sequence.draft);
      await sequence.replica.expectLedgerOf(sequence.draft);
    },
    RANDOM_DRAFT_SEED_TIMEOUT_MS,
  );

  it('takes every kind of step, and renumbers in a later partial commit, across its seeds', () => {
    expect(coverage.missingKinds()).toEqual([]);
    expect(coverage.randomCommitsThatRenumbered).toBeGreaterThan(0);
  });

  async function expectStepAppliedWithTheReplicaInStep(
    sequence: ReplicaSequence,
    { step, status }: TakenStep,
  ): Promise<void> {
    expect({ step, status }).toEqual({ step, status: 'applied' });
    expect({
      step,
      pendingNotAfterPublished: await pendingMigrationsNotAfterPublished(
        sequence.draft,
      ),
    }).toEqual({ step, pendingNotAfterPublished: [] });
    await sequence.replica.syncWith(sequence.draft);
    await sequence.replica.expectSchemasOf(sequence.draft);
  }
});

function statusOfCommittingEverything(
  left: readonly ListedUnit[],
): ApplyStatus {
  if (left.length === 0) {
    return 'empty';
  }

  return 'applied';
}
