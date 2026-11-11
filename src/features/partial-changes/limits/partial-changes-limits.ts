import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  describeSettings,
  type NumericSetting,
  readNumericSetting,
} from 'src/infrastructure/database/numeric-setting';

// Conservative defaults (SPEC §11): each keeps the cost it bounds at about 20 s or less on the PoC sandbox. Raise them
// through the environment when the operation logs show the real costs.
const MAX_CHANGED_ROWS: NumericSetting = {
  envKey: 'PARTIAL_CHANGES_MAX_CHANGED_ROWS',
  defaultValue: 20_000,
  minValue: 1,
};

const MAX_PER_ROW_WORK: NumericSetting = {
  envKey: 'PARTIAL_CHANGES_MAX_PER_ROW_WORK',
  defaultValue: 2_000,
  minValue: 1,
};

const MAX_MIXED_TABLE_LINKS: NumericSetting = {
  envKey: 'PARTIAL_CHANGES_MAX_MIXED_TABLE_LINKS',
  defaultValue: 100_000,
  minValue: 1,
};

// How many entries of required and of blockers a result lists (SPEC §5.1); the totals count the rest.
const MAX_LISTED_DETAILS: NumericSetting = {
  envKey: 'PARTIAL_CHANGES_MAX_LISTED_DETAILS',
  defaultValue: 200,
  minValue: 1,
};

@Injectable()
export class PartialChangesLimits implements OnModuleInit {
  public readonly maxChangedRows: number;

  public readonly maxPerRowWork: number;

  public readonly maxMixedTableLinks: number;

  public readonly maxListedDetails: number;

  private readonly logger = new Logger(PartialChangesLimits.name);

  constructor(configService: ConfigService) {
    this.maxChangedRows = this.read(configService, MAX_CHANGED_ROWS);
    this.maxPerRowWork = this.read(configService, MAX_PER_ROW_WORK);
    this.maxMixedTableLinks = this.read(configService, MAX_MIXED_TABLE_LINKS);
    this.maxListedDetails = this.read(configService, MAX_LISTED_DETAILS);
  }

  onModuleInit() {
    const settings = describeSettings([
      {
        name: 'maxChangedRows',
        value: this.maxChangedRows,
        setting: MAX_CHANGED_ROWS,
      },
      {
        name: 'maxPerRowWork',
        value: this.maxPerRowWork,
        setting: MAX_PER_ROW_WORK,
      },
      {
        name: 'maxMixedTableLinks',
        value: this.maxMixedTableLinks,
        setting: MAX_MIXED_TABLE_LINKS,
      },
      {
        name: 'maxListedDetails',
        value: this.maxListedDetails,
        setting: MAX_LISTED_DETAILS,
      },
    ]);

    this.logger.log(`Partial changes limits: ${settings}`);
  }

  private read(configService: ConfigService, setting: NumericSetting): number {
    return readNumericSetting(configService, setting, this.logger);
  }
}
