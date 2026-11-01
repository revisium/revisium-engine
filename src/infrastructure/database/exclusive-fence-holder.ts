import { Logger } from '@nestjs/common';
import { TransactionPrismaClient } from 'src/features/share/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

export interface HolderTransactionOptions {
  maxWait: number;
  timeout: number;
}

type ExclusiveLock = (holder: TransactionPrismaClient) => Promise<void>;

// The holder runs in its own transaction on its own connection: the operation it
// protects must take its snapshot after in-flight writers drained, and the lock
// must outlast that operation's COMMIT.
export class ExclusiveFenceHolder {
  private readonly logger = new Logger(ExclusiveFenceHolder.name);

  private readonly releaseRequest = createSignal();

  private holding?: Promise<void>;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly lockExclusively: ExclusiveLock,
    private readonly options: HolderTransactionOptions,
  ) {}

  public async acquire(): Promise<void> {
    const acquisition = createSignal();
    const holding = this.prismaService.$transaction(async (holder) => {
      await this.lockExclusively(holder);
      acquisition.fire();
      await this.releaseRequest.fired;
    }, this.options);

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
