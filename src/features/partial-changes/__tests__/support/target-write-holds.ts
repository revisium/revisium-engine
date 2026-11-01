import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { createBarrier, type Barrier } from 'src/__tests__/utils/barrier';
import { DraftRevisionTargetApiService } from 'src/features/draft-revision/draft-revision-target-api.service';

// The first writes of partial operations wait at their barriers: after the operation planned, before it writes.
export class TargetWriteHolds {
  private readonly barriers = new Map<number, Barrier>();

  private writesStarted = 0;

  private constructor(
    private readonly operation: string,
    private heldWrites: number,
  ) {}

  public static ofReverts(
    kit: PartialChangesTestKit,
    heldWrites: number,
  ): TargetWriteHolds {
    const holds = new TargetWriteHolds('partial revert', heldWrites);
    const api = targetApiOf(kit);
    const revertToTarget = api.revertToTarget.bind(api);

    jest.spyOn(api, 'revertToTarget').mockImplementation(async (plan) => {
      await holds.holdWrite();

      return revertToTarget(plan);
    });

    return holds;
  }

  public static ofCommits(
    kit: PartialChangesTestKit,
    heldWrites: number,
  ): TargetWriteHolds {
    const holds = new TargetWriteHolds('partial commit', heldWrites);
    const api = targetApiOf(kit);
    const commitToTarget = api.commitToTarget.bind(api);

    jest.spyOn(api, 'commitToTarget').mockImplementation(async (plan) => {
      await holds.holdWrite();

      return commitToTarget(plan);
    });

    return holds;
  }

  public barrierOf(write: number): Barrier {
    const existing = this.barriers.get(write);

    if (existing) {
      return existing;
    }

    const barrier = createBarrier(`Write ${write} of a ${this.operation}`);
    this.barriers.set(write, barrier);

    return barrier;
  }

  public releaseAll(): void {
    this.heldWrites = this.writesStarted;

    for (const barrier of this.barriers.values()) {
      barrier.release();
    }
  }

  private async holdWrite(): Promise<void> {
    this.writesStarted += 1;

    if (this.writesStarted <= this.heldWrites) {
      await this.barrierOf(this.writesStarted).arrive();
    }
  }
}

function targetApiOf(
  kit: PartialChangesTestKit,
): DraftRevisionTargetApiService {
  return kit.module.get(DraftRevisionTargetApiService);
}
