import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface NumericSetting {
  envKey: string;
  defaultValue: number;
  minValue: number;
  maxValue?: number;
}

export interface ReadSetting {
  readonly name: string;
  readonly value: number;
  readonly setting: NumericSetting;
  readonly unit?: string;
}

// For the startup log: every value, and the variable it came from when it is not the default.
export function describeSettings(settings: readonly ReadSetting[]): string {
  return settings
    .map(({ name, value, setting, unit = '' }) =>
      value === setting.defaultValue
        ? `${name}=${value}${unit}`
        : `${name}=${value}${unit} (from ${setting.envKey})`,
    )
    .join(', ');
}

export function readNumericSetting(
  configService: ConfigService,
  setting: NumericSetting,
  logger: Logger,
): number {
  const value = configService.get<string>(setting.envKey);

  if (!value) {
    return setting.defaultValue;
  }

  // Whole decimal digits only: parseInt would read "1e5" as 1 and "100_000" as 100.
  if (!/^\s*-?\d+\s*$/.test(value)) {
    logger.warn(
      `Invalid ${setting.envKey}: "${value}" is not an integer, using default ${setting.defaultValue}`,
    );
    return setting.defaultValue;
  }

  const parsed = Number.parseInt(value, 10);

  const maxValue = setting.maxValue ?? Number.MAX_SAFE_INTEGER;

  if (parsed > maxValue) {
    logger.warn(
      `Invalid ${setting.envKey}: ${value.trim()} is above maximum ${maxValue}, using default ${setting.defaultValue}`,
    );
    return setting.defaultValue;
  }

  if (parsed < setting.minValue) {
    logger.warn(
      `Invalid ${setting.envKey}: ${parsed} is below minimum ${setting.minValue}, using default ${setting.defaultValue}`,
    );
    return setting.defaultValue;
  }

  return parsed;
}
