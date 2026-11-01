import { Logger } from '@nestjs/common';
import { TransactionPrismaClient } from 'src/features/share/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

// The protected transaction can run past its own timeout while a statement or its
// COMMIT is in flight, so the holder's timeout exceeds it by this grace; the grace
// only bounds how long a protected transaction that never ends keeps the fence.
const HOLDER_TIMEOUT_GRACE_MS = 30_000;

export interface HolderTransactionOptions {
  maxWait: number;
  protectedTransactionTimeoutMs: number;
}

type ExclusiveLock = (
  holder: TransactionPrismaClient,
  lockWaitMs: number,
) => Promise<void>;

// The holder runs in its own transaction on its own connection: the operation it
// protects must take its snapshot after in-flight writers drained, and the lock
// must outlast that operation's COMMIT or rollback.
export class ExclusiveFenceHolder {
  private readonly logger = new Logger(ExclusiveFenceHolder.name);

  private readonly releaseRequest = createSignal();

  private holding?: Promise<void>;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly lockExclusively: ExclusiveLock,
    private readonly options: HolderTransactionOptions,
  ) {}

  public async acquire(lockWaitMs: number): Promise<void> {
    const acquisition = createSignal();
    const holding = this.prismaService.$transaction(
      async (holder) => {
        await this.lockExclusively(holder, lockWaitMs);
        acquisition.fire();
        await this.releaseRequest.fired;
      },
      {
        maxWait: this.options.maxWait,
        timeout:
          this.options.protectedTransactionTimeoutMs + HOLDER_TIMEOUT_GRACE_MS,
      },
    );

    await Promise.race([acquisition.fired, holding]);
    this.holding = holding;
  }

  public async release(): Promise<void> {
    this.releaseRequest.fire();

    await this.holding?.catch((error: unknown) => {
      this.logger.warn(
        `The exclusive branch write fence ended with an error: ${String(error)}`,
      );
    });
  }
}

function createSignal() {
  let fire!: () => void;
  const fired = new Promise<void>((resolve) => {
    fire = resolve;
  });

  return { fired, fire };
}
