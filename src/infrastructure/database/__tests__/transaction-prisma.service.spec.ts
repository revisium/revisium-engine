import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

describe('TransactionPrismaService.isRetryableError', () => {
  let service: TransactionPrismaService;

  beforeAll(() => {
    const prismaServiceMock = {} as PrismaService;
    const configServiceMock = {
      get: () => undefined,
    } as unknown as ConfigService;

    service = new TransactionPrismaService(
      prismaServiceMock,
      configServiceMock,
    );
  });

  function callIsRetryable(error: Error): boolean {
    const fn = (
      service as unknown as { isRetryableError: (e: Error) => boolean }
    ).isRetryableError.bind(service);
    return fn(error);
  }

  it('should retry serialization_failure (40001)', () => {
    const err = Object.assign(new Error('could not serialize access'), {
      code: '40001',
    });
    expect(callIsRetryable(err)).toBe(true);
  });

  it('should retry deadlock_detected (40P01)', () => {
    const err = Object.assign(new Error('deadlock detected'), {
      code: '40P01',
    });
    expect(callIsRetryable(err)).toBe(true);
  });

  it('should retry Prisma transaction write conflict (P2034)', () => {
    const err = Object.assign(new Error('TransactionWriteConflict'), {
      code: 'P2034',
    });
    expect(callIsRetryable(err)).toBe(true);
  });

  it('should retry in_failed_sql_transaction (25P02)', () => {
    const err = Object.assign(
      new Error(
        'current transaction is aborted, commands ignored until end of transaction block',
      ),
      { code: '25P02' },
    );
    expect(callIsRetryable(err)).toBe(true);
  });

  it('should retry by message even without code', () => {
    expect(callIsRetryable(new Error('could not serialize access'))).toBe(true);
    expect(callIsRetryable(new Error('current transaction is aborted'))).toBe(
      true,
    );
  });

  it('should NOT retry unrelated errors', () => {
    const err = Object.assign(new Error('foreign key violation'), {
      code: '23503',
    });
    expect(callIsRetryable(err)).toBe(false);
  });

  it('should NOT retry generic errors', () => {
    expect(callIsRetryable(new Error('something else'))).toBe(false);
  });
});
