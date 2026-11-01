import type { DraftProjectScenario } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createBarrier, type Barrier } from 'src/__tests__/utils/barrier';
import type { DraftRevisionCommitCommandData } from 'src/features/draft-revision/commands/impl/draft-revision-commit.command';
import { DraftRevisionApiService } from 'src/features/draft-revision/draft-revision-api.service';
import { EscalatingTransactionRunner } from 'src/infrastructure/database/escalating-transaction-runner';
import { EscalationSlots } from 'src/infrastructure/database/escalation-slots';
import { ExclusiveFenceHolder } from 'src/infrastructure/database/exclusive-fence-holder';

const SERIALIZATION_FAILURE = '40001';

type EscalationKit = Pick<DraftTestKit, 'module' | 'transactionService'>;

// Every attempt before escalation fails serialization, so each commit escalates
// after its second attempt; an escalated attempt can be held inside its transaction.
export class EscalatingCommits {
  private readonly heldBranches = new Map<string, Barrier>();

  constructor(private readonly kit: DraftTestKit) {
    this.failAttemptsBeforeEscalation();
  }

  start(draft: DraftProjectScenario): Promise<unknown> {
    const commit = this.kit.draftApiService.apiCreateRevision({
      projectId: draft.projectId,
      branchName: draft.branchName,
    });
    commit.catch(() => undefined);

    return commit;
  }

  holdEscalatedAttemptOf(draft: DraftProjectScenario): Barrier {
    const barrier = createBarrier('The escalated attempt');
    this.heldBranches.set(draft.branchId, barrier);

    return barrier;
  }

  private failAttemptsBeforeEscalation(): void {
    const steps = this.kit.module.get(DraftRevisionApiService);
    const commit = steps.commit.bind(steps);

    jest
      .spyOn(steps, 'commit')
      .mockImplementation(async (data: DraftRevisionCommitCommandData) => {
        if (this.kit.transactionService.exclusiveHeldBranchId === undefined) {
          throw serializationFailure();
        }

        await this.heldBranches.get(data.branchId)?.arrive();

        return commit(data);
      });
  }
}

// Each attempt of the next escalating operation fails serialization without
// running it until the operation escalates, even where its admission would
// refuse; the escalated attempt is then held under the exclusive fence before it runs.
export function holdNextOperationEscalatedUnderItsFence(
  kit: EscalationKit,
): Barrier {
  const barrier = createBarrier('The escalated attempt');
  const runner = kit.module.get(EscalatingTransactionRunner);
  const runSerializable = runner.runSerializable.bind(runner);

  jest
    .spyOn(runner, 'runSerializable')
    .mockImplementationOnce((branch, operation) =>
      runSerializable(branch, async () => {
        if (kit.transactionService.exclusiveHeldBranchId === undefined) {
          throw serializationFailure();
        }

        await barrier.arrive();

        return operation();
      }),
    );

  return barrier;
}

// Holds each escalated attempt after its own transaction started and before its
// holder asks for a connection, until no other escalation can still reach that
// point: every one either waits there or waits for an escalation slot.
export function holdEscalatedAttemptsBeforeTheirHolders(
  kit: DraftTestKit,
  escalations: number,
): void {
  const opened = createSignal();
  let beforeHolder = 0;
  let waitingForSlot = 0;
  const openWhenNoneCanAdvance = () => {
    if (beforeHolder + waitingForSlot === escalations) {
      opened.fire();
    }
  };

  const acquire = ExclusiveFenceHolder.prototype.acquire;
  jest
    .spyOn(ExclusiveFenceHolder.prototype, 'acquire')
    .mockImplementation(async function (
      this: ExclusiveFenceHolder,
      lockWaitMs: number,
    ) {
      beforeHolder += 1;
      openWhenNoneCanAdvance();
      await opened.fired;

      return acquire.call(this, lockWaitMs);
    });

  const slots = kit.module.get(EscalationSlots);
  const takeSlot = slots.acquire.bind(slots);
  jest.spyOn(slots, 'acquire').mockImplementation(async (waitLimitMs) => {
    waitingForSlot += 1;
    openWhenNoneCanAdvance();

    try {
      return await takeSlot(waitLimitMs);
    } finally {
      waitingForSlot -= 1;
    }
  });
}

function serializationFailure(): Error {
  return Object.assign(
    new Error('could not serialize access due to concurrent update'),
    { code: SERIALIZATION_FAILURE },
  );
}

function createSignal() {
  let fire!: () => void;
  const fired = new Promise<void>((resolve) => {
    fire = resolve;
  });

  return { fired, fire };
}
