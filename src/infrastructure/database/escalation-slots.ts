import { Injectable } from '@nestjs/common';
import { BranchWriteFencedException } from 'src/infrastructure/database/branch-write-fenced.exception';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

// An escalated attempt holds two pool connections at once, its own and its
// holder's. With at most half of the pool escalated, escalations that each hold
// their own connection never all wait for a connection for their holder.
const CONNECTIONS_PER_ESCALATION = 2;

const MIN_SLOTS = 1;

@Injectable()
export class EscalationSlots {
  private free: number;

  private readonly waiting: (() => void)[] = [];

  constructor(prismaService: PrismaService) {
    this.free = Math.max(
      Math.floor(prismaService.connectionPoolSize / CONNECTIONS_PER_ESCALATION),
      MIN_SLOTS,
    );
  }

  public async acquire(waitLimitMs: number): Promise<void> {
    if (this.free > 0) {
      this.free -= 1;
      return;
    }

    if (!(await this.waitForSlot(waitLimitMs))) {
      throw new BranchWriteFencedException(waitLimitMs);
    }
  }

  public release(): void {
    const next = this.waiting.shift();

    if (next) {
      next();
      return;
    }

    this.free += 1;
  }

  private waitForSlot(waitLimitMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const expiry = setTimeout(() => {
        this.stopWaiting(handOver);
        resolve(false);
      }, waitLimitMs);
      const handOver = () => {
        clearTimeout(expiry);
        resolve(true);
      };

      this.waiting.push(handOver);
    });
  }

  private stopWaiting(waiter: () => void): void {
    const index = this.waiting.indexOf(waiter);

    if (index >= 0) {
      this.waiting.splice(index, 1);
    }
  }
}
