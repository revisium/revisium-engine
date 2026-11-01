import type { Migration } from '@revisium/schema-toolkit/types';
import {
  givenDraftProjectWithRows,
  type DraftProjectScenario,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createBarrier, type Barrier } from 'src/__tests__/utils/barrier';
import { defaultDraftProjectSchema } from 'src/__tests__/utils/prepareProject';
import { DraftRevisionApiService } from 'src/features/draft-revision/draft-revision-api.service';
import { ApiRevertChangesCommand } from 'src/features/draft/commands/impl/api-revert-changes.command';
import { createMigrationRecord } from 'src/features/migration/__tests__/support/migration-database';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import {
  waitUntilQueuedBehindFence,
  waitUntilWrittenWithoutQueuing,
} from './branch-write-fence';

type HeldStep = 'commit' | 'revert' | 'createTable';

type HeldSteps = Record<HeldStep, (data: unknown) => Promise<unknown>>;

export interface QueuedWrite {
  writing: Promise<unknown>;
}

export function givenDraftWithRows(
  kit: DraftTestKit,
  rowIds: string[],
): Promise<DraftProjectScenario> {
  return givenDraftProjectWithRows({
    prismaService: kit.prismaService,
    schema: defaultDraftProjectSchema,
    rows: rowIds.map((rowId) => ({ rowId, data: { ver: 1 } })),
  });
}

export function startHeldCommit(
  kit: DraftTestKit,
  draft: DraftProjectScenario,
) {
  return new HeldBranchOperation(kit, draft, 'commit', () =>
    kit.draftApiService.apiCreateRevision({
      projectId: draft.projectId,
      branchName: draft.branchName,
    }),
  );
}

export function startHeldRevert(
  kit: DraftTestKit,
  draft: DraftProjectScenario,
) {
  return new HeldBranchOperation(kit, draft, 'revert', () =>
    revertBranchDraft(kit, draft),
  );
}

export function startHeldMigrationImport(
  kit: DraftTestKit,
  draft: DraftProjectScenario,
  migration: Migration,
) {
  return new HeldBranchOperation(kit, draft, 'createTable', () =>
    kit.draftApiService.applyMigrations({
      revisionId: draft.draftRevisionId,
      migrations: [migration],
    }),
  );
}

export async function removeRowFromBranchDraft(
  kit: DraftTestKit,
  draft: DraftProjectScenario,
  rowId: string,
): Promise<unknown> {
  return kit.draftApiService.apiRemoveRow({
    revisionId: await readBranchDraftRevisionId(kit, draft),
    tableId: draft.tableId,
    rowId,
  });
}

export async function readBranchDraftRevisionId(
  kit: DraftTestKit,
  draft: DraftProjectScenario,
): Promise<string> {
  const { id } = await kit.prismaService.revision.findFirstOrThrow({
    where: { branchId: draft.branchId, isDraft: true },
    select: { id: true },
  });

  return id;
}

export async function readRowIds(
  kit: DraftTestKit,
  draft: DraftProjectScenario,
  revisionId: string,
): Promise<string[]> {
  const rows = await kit.prismaService.row.findMany({
    where: {
      tables: {
        some: { id: draft.tableId, revisions: { some: { id: revisionId } } },
      },
    },
    select: { id: true },
  });

  return rows.map((row) => row.id).sort();
}

export async function isDraftRevision(
  kit: DraftTestKit,
  revisionId: string,
): Promise<boolean> {
  const revision = await kit.prismaService.revision.findUniqueOrThrow({
    where: { id: revisionId },
    select: { isDraft: true },
  });

  return revision.isDraft;
}

export async function startMigration(
  kit: DraftTestKit,
  draft: DraftProjectScenario,
): Promise<void> {
  await createMigrationRecord(
    kit.prismaService,
    draft.draftRevisionId,
    MigrationStatus.COPYING,
    { tableId: draft.tableId },
  );
}

// Each attempt is held after it took its snapshot, so a write made while it waits conflicts with it.
export class HeldBranchOperation<T> {
  private readonly barriers = new Map<number, Barrier>();

  private readonly backendPids = new Map<number, number>();

  private readonly attempts: jest.SpyInstance;

  private readonly result: Promise<T>;

  private attemptsStarted = 0;

  private attemptsReached = 0;

  private isHolding = true;

  constructor(
    private readonly kit: DraftTestKit,
    private readonly draft: DraftProjectScenario,
    heldStep: HeldStep,
    run: () => Promise<T>,
  ) {
    this.attempts = this.holdEachAttemptAt(heldStep);
    this.result = run();
    this.result.catch(() => undefined);
  }

  async losesAttemptToRemovalOf(
    rowId: string,
    whileHeld?: () => Promise<unknown>,
  ): Promise<void> {
    const attempt = await this.nextHeldAttempt();

    try {
      await waitUntilWrittenWithoutQueuing(
        this.kit,
        this.draft.branchId,
        removeRowFromBranchDraft(this.kit, this.draft, rowId),
      );
      await whileHeld?.();
    } finally {
      attempt.release();
    }
  }

  queuesRemovalOf(rowId: string): Promise<QueuedWrite> {
    return this.queues(() =>
      removeRowFromBranchDraft(this.kit, this.draft, rowId),
    );
  }

  queuesRevert(): Promise<QueuedWrite> {
    return this.queues(() => revertBranchDraft(this.kit, this.draft));
  }

  async outlivesItsTransaction(): Promise<void> {
    const backendPid = this.backendPids.get(this.attemptsReached);

    if (backendPid === undefined) {
      throw new Error('No attempt is held');
    }

    let isOpen = true;

    while (isOpen) {
      isOpen = await isIdleInTransaction(this.kit, backendPid);
    }
  }

  outcome(): Promise<T> {
    this.isHolding = false;

    for (const barrier of this.barriers.values()) {
      barrier.release();
    }

    this.attempts.mockRestore();

    return this.result;
  }

  private async queues(write: () => Promise<unknown>): Promise<QueuedWrite> {
    await this.nextHeldAttempt();

    const writing = write();
    writing.catch(() => undefined);
    await waitUntilQueuedBehindFence(this.kit, this.draft.branchId, writing);

    return { writing };
  }

  private async nextHeldAttempt(): Promise<Barrier> {
    this.attemptsReached += 1;
    const barrier = this.barrierOf(this.attemptsReached);
    await barrier.expectReachedBefore(this.result);

    return barrier;
  }

  private holdEachAttemptAt(heldStep: HeldStep): jest.SpyInstance {
    const steps = this.kit.module.get(
      DraftRevisionApiService,
    ) as unknown as HeldSteps;
    const runStep = steps[heldStep].bind(steps);

    return jest.spyOn(steps, heldStep).mockImplementation(async (data) => {
      this.attemptsStarted += 1;
      const attempt = this.attemptsStarted;

      if (this.isHolding) {
        this.backendPids.set(attempt, await readBackendPid(this.kit));
        await this.barrierOf(attempt).arrive();
      }

      return runStep(data);
    });
  }

  private barrierOf(attempt: number): Barrier {
    const existing = this.barriers.get(attempt);

    if (existing) {
      return existing;
    }

    const barrier = createBarrier(`Attempt ${attempt} of the operation`);
    this.barriers.set(attempt, barrier);

    return barrier;
  }
}

function revertBranchDraft(
  kit: DraftTestKit,
  draft: DraftProjectScenario,
): Promise<unknown> {
  return kit.commandBus.execute(
    new ApiRevertChangesCommand({
      projectId: draft.projectId,
      branchName: draft.branchName,
    }),
  );
}

async function readBackendPid(kit: DraftTestKit): Promise<number> {
  const [backend] = await kit.transactionService.getTransaction().$queryRaw<
    { pid: number }[]
  >`SELECT pg_backend_pid() AS pid`;

  if (!backend) {
    throw new Error('The attempt has no backend');
  }

  return backend.pid;
}

async function isIdleInTransaction(
  kit: DraftTestKit,
  backendPid: number,
): Promise<boolean> {
  const sessions = await kit.prismaService.$queryRaw<unknown[]>`
    SELECT 1 FROM pg_stat_activity
    WHERE pid = ${backendPid} AND state = 'idle in transaction'`;

  return sessions.length > 0;
}
