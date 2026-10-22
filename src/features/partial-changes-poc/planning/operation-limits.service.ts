import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OperationLimitValues {
  maxChangedRows: number;
  maxMixedTableLinks: number;
  maxFormulaMerges: number;
}

export const DEFAULT_LIMITS: OperationLimitValues = {
  maxChangedRows: 100_000,
  maxMixedTableLinks: 250_000,
  maxFormulaMerges: 10_000,
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
      maxFormulaMerges: this.limit(
        'PARTIAL_CHANGES_MAX_FORMULA_MERGES',
        DEFAULT_LIMITS.maxFormulaMerges,
      ),
    };
  }

  private limit(name: string, fallback: number): number {
    const configured = Number(this.configService.get(name));
    return configured > 0 ? configured : fallback;
  }
}
