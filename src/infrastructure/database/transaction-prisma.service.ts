import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import { AsyncLocalStorage } from 'node:async_hooks';
import { isSerializationFailure } from 'src/infrastructure/database/database-errors';
import {
  NumericSetting,
  readNumericSetting,
} from 'src/infrastructure/database/numeric-setting';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import {
  RetryBackoff,
  retryDelayMs,
} from 'src/infrastructure/database/retry-backoff';
import { TransactionPrismaClient } from 'src/features/share/types';

export interface TransactionOptions {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: TransactionIsolationLevel;
  retry?: {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
}

/**
 * Default retry options for SERIALIZABLE transactions.
 *
 * These values are tuned based on load testing:
 * - 100 concurrent: 100% success
 * - 500 concurrent: 100% success
 * - 1000 concurrent: 82% success (limited by connection pool, not retries)
 *
 * For >500 concurrent requests, increase connection pool size in PostgreSQL/Prisma.
 */
const DEFAULT_SERIALIZABLE_OPTIONS: Required<TransactionOptions> = {
  maxWait: 10000, // 10s - increased for high load (connection pool wait)
  timeout: 15000, // 15s - transaction timeout
  isolationLevel: TransactionIsolationLevel.Serializable,
  retry: {
    maxRetries: 20, // 20 attempts - handles high contention scenarios
    baseDelayMs: 30, // 30ms - fast first retry
    maxDelayMs: 1500, // 1.5s - cap on exponential backoff
  },
};

interface SettingConfig extends NumericSetting {
  unit: string;
}

const SETTINGS_CONFIG: Record<string, SettingConfig> = {
  maxWait: {
    envKey: 'TRANSACTION_MAX_WAIT',
    defaultValue: DEFAULT_SERIALIZABLE_OPTIONS.maxWait,
    minValue: 1,
    unit: 'ms',
  },
  timeout: {
    envKey: 'TRANSACTION_TIMEOUT',
    defaultValue: DEFAULT_SERIALIZABLE_OPTIONS.timeout,
    minValue: 1,
    unit: 'ms',
  },
  maxRetries: {
    envKey: 'TRANSACTION_MAX_RETRIES',
    defaultValue: DEFAULT_SERIALIZABLE_OPTIONS.retry.maxRetries,
    minValue: 0,
    unit: '',
  },
  baseDelayMs: {
    envKey: 'TRANSACTION_BASE_DELAY_MS',
    defaultValue: DEFAULT_SERIALIZABLE_OPTIONS.retry.baseDelayMs,
    minValue: 0,
    unit: 'ms',
  },
  maxDelayMs: {
    envKey: 'TRANSACTION_MAX_DELAY_MS',
    defaultValue: DEFAULT_SERIALIZABLE_OPTIONS.retry.maxDelayMs,
    minValue: 0,
    unit: 'ms',
  },
};

@Injectable()
export class TransactionPrismaService implements OnModuleInit {
  private readonly logger = new Logger(TransactionPrismaService.name);

  private readonly asyncLocalStorage = new AsyncLocalStorage<{
    $prisma: TransactionPrismaClient;
  }>();

  private readonly serializableOptions: Required<TransactionOptions>;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.serializableOptions = this.buildSerializableOptions();
  }

  onModuleInit() {
    this.logTransactionSettings();
  }

  private buildSerializableOptions(): Required<TransactionOptions> {
    return {
      maxWait: this.getValidatedEnvNumber('maxWait'),
      timeout: this.getValidatedEnvNumber('timeout'),
      isolationLevel: DEFAULT_SERIALIZABLE_OPTIONS.isolationLevel,
      retry: {
        maxRetries: this.getValidatedEnvNumber('maxRetries'),
        baseDelayMs: this.getValidatedEnvNumber('baseDelayMs'),
        maxDelayMs: this.getValidatedEnvNumber('maxDelayMs'),
      },
    };
  }

  private getValidatedEnvNumber(settingName: string): number {
    const config = SETTINGS_CONFIG[settingName];

    if (!config) {
      throw new Error(`Unknown transaction setting: ${settingName}`);
    }

    return readNumericSetting(this.configService, config, this.logger);
  }

  private logTransactionSettings() {
    const flatOptions: Record<string, number> = {
      maxWait: this.serializableOptions.maxWait,
      timeout: this.serializableOptions.timeout,
      maxRetries: this.serializableOptions.retry.maxRetries,
      baseDelayMs: this.serializableOptions.retry.baseDelayMs,
      maxDelayMs: this.serializableOptions.retry.maxDelayMs,
    };

    const settings = Object.entries(SETTINGS_CONFIG).map(([name, config]) => {
      const value = flatOptions[name] ?? 0;
      const isOverridden = value !== config.defaultValue;
      return isOverridden
        ? `${name}=${value}${config.unit} (from ${config.envKey})`
        : `${name}=${value}${config.unit}`;
    });

    this.logger.log(`Transaction settings: ${settings.join(', ')}`);
  }

  public get serializableTimeoutMs(): number {
    return this.serializableOptions.timeout;
  }

  public get serializableMaxWaitMs(): number {
    return this.serializableOptions.maxWait;
  }

  public get serializableRetryBackoff(): RetryBackoff {
    const { baseDelayMs, maxDelayMs } = this.serializableOptions.retry;

    return { baseDelayMs, maxDelayMs };
  }

  public getTransaction() {
    const transactionInCurrentContext = this.asyncLocalStorage.getStore();

    if (!transactionInCurrentContext?.$prisma) {
      throw new InternalServerErrorException(
        'TransactionPrismaClient not found. It appears that an attempt was made to access a transaction outside the context of TransactionalPrismaService.runTransaction.',
      );
    }

    return transactionInCurrentContext.$prisma;
  }

  public getTransactionUnsafe() {
    const transactionInCurrentContext = this.asyncLocalStorage.getStore();

    return transactionInCurrentContext?.$prisma;
  }

  public getTransactionOrPrisma() {
    return this.getTransactionUnsafe() ?? this.prismaService;
  }

  public async run<T>(
    handler: (...rest: unknown[]) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const { retry, ...prismaOptions } = options || {};

    if (!retry) {
      return this.executeTransaction(handler, prismaOptions);
    }

    return this.executeTransactionWithRetry(handler, prismaOptions, retry);
  }

  public runSerializable<T>(
    handler: (...rest: unknown[]) => Promise<T>,
    options?: Omit<Partial<TransactionOptions>, 'isolationLevel'>,
  ): Promise<T> {
    const mergedOptions: TransactionOptions = {
      maxWait: options?.maxWait ?? this.serializableOptions.maxWait,
      timeout: options?.timeout ?? this.serializableOptions.timeout,
      isolationLevel: this.serializableOptions.isolationLevel,
      retry: options?.retry ?? this.serializableOptions.retry,
    };

    return this.run(handler, mergedOptions);
  }

  public runInTransactionContext<T>(
    $prisma: TransactionPrismaClient,
    handler: () => Promise<T>,
  ): Promise<T> {
    return this.asyncLocalStorage.run({ $prisma }, async () => {
      // A lazy PrismaPromise returned by the handler runs only when awaited: await it inside the context.
      const result = await handler();
      return result;
    });
  }

  private executeTransaction<T>(
    handler: (...rest: unknown[]) => Promise<T>,
    options?: Omit<TransactionOptions, 'retry'>,
  ): Promise<T> {
    return this.prismaService.$transaction(async ($prisma) => {
      return this.runInTransactionContext($prisma, handler);
    }, options);
  }

  private async executeTransactionWithRetry<T>(
    handler: (...rest: unknown[]) => Promise<T>,
    prismaOptions: Omit<TransactionOptions, 'retry'>,
    retryOptions: NonNullable<TransactionOptions['retry']>,
  ): Promise<T> {
    const { maxRetries } = retryOptions;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.executeTransaction(handler, prismaOptions);
      } catch (error) {
        lastError = error as Error;

        if (!isSerializationFailure(lastError)) {
          throw error;
        }

        if (attempt < maxRetries - 1) {
          const delay = retryDelayMs(attempt, retryOptions);
          this.logger.debug(
            `Serialization failure (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms`,
          );
          await this.sleep(delay);
        }
      }
    }

    this.logger.warn(
      `Transaction failed after ${maxRetries} attempts due to serialization conflicts`,
    );
    throw (
      lastError ||
      new Error('Max retries exceeded for serializable transaction')
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
