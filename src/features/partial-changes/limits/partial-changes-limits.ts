import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type NumericSetting,
  readNumericSetting,
} from 'src/infrastructure/database/numeric-setting';

const MAX_CHANGED_ROWS: NumericSetting = {
  envKey: 'PARTIAL_CHANGES_MAX_CHANGED_ROWS',
  defaultValue: 100_000,
  minValue: 1,
};

const MAX_PER_ROW_WORK: NumericSetting = {
  envKey: 'PARTIAL_CHANGES_MAX_PER_ROW_WORK',
  defaultValue: 10_000,
  minValue: 1,
};

const MAX_MIXED_TABLE_LINKS: NumericSetting = {
  envKey: 'PARTIAL_CHANGES_MAX_MIXED_TABLE_LINKS',
  defaultValue: 250_000,
  minValue: 1,
};

@Injectable()
export class PartialChangesLimits {
  public readonly maxChangedRows: number;

  public readonly maxPerRowWork: number;

  public readonly maxMixedTableLinks: number;

  private readonly logger = new Logger(PartialChangesLimits.name);

  constructor(configService: ConfigService) {
    this.maxChangedRows = this.read(configService, MAX_CHANGED_ROWS);
    this.maxPerRowWork = this.read(configService, MAX_PER_ROW_WORK);
    this.maxMixedTableLinks = this.read(configService, MAX_MIXED_TABLE_LINKS);
  }

  private read(configService: ConfigService, setting: NumericSetting): number {
    return readNumericSetting(configService, setting, this.logger);
  }
}
