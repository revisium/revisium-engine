import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ReadScopeMode = 'affected' | 'all';

export interface OperationLimitValues {
  maxChangedRows: number;
  maxMixedTableLinks: number;
  maxPerRowWork: number;
  operationTimeoutMs: number;
  readScope: ReadScopeMode;
}

export const DEFAULT_LIMITS: OperationLimitValues = {
  maxChangedRows: 100_000,
  maxMixedTableLinks: 250_000,
  maxPerRowWork: 10_000,
  operationTimeoutMs: 180_000,
  readScope: 'affected',
};

@Injectable()
export class OperationLimits {
  constructor(private readonly configService: ConfigService) {}

  values(): OperationLimitValues {
    return {
      maxChangedRows: this.limit(
        'PARTIAL_CHANGES_MAX_CHANGED_ROWS',
        DEFAULT_LIMITS.maxChangedRows,
      ),
      maxMixedTableLinks: this.limit(
        'PARTIAL_CHANGES_MAX_MIXED_TABLE_LINKS',
        DEFAULT_LIMITS.maxMixedTableLinks,
      ),
      maxPerRowWork: this.limit(
        'PARTIAL_CHANGES_MAX_PER_ROW_WORK',
        DEFAULT_LIMITS.maxPerRowWork,
      ),
      operationTimeoutMs: this.limit(
        'PARTIAL_CHANGES_OPERATION_TIMEOUT_MS',
        DEFAULT_LIMITS.operationTimeoutMs,
      ),
      readScope:
        this.configService.get('PARTIAL_CHANGES_READ_SCOPE') === 'all'
          ? 'all'
          : DEFAULT_LIMITS.readScope,
    };
  }

  private limit(name: string, fallback: number): number {
    const configured = Number(this.configService.get(name));
    return configured > 0 ? configured : fallback;
  }
}
