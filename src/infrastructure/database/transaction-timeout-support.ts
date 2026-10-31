import { Injectable } from '@nestjs/common';
import { TransactionPrismaClient } from 'src/features/share/types';

@Injectable()
export class TransactionTimeoutSupport {
  public async isSupportedOn(
    $prisma: TransactionPrismaClient,
  ): Promise<boolean> {
    const [setting] = await $prisma.$queryRaw<[{ supported: boolean }]>`
      SELECT current_setting('transaction_timeout', true) IS NOT NULL AS supported`;

    return setting.supported;
  }
}
