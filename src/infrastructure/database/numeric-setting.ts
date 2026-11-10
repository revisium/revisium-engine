import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface NumericSetting {
  envKey: string;
  defaultValue: number;
  minValue: number;
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

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    logger.warn(
      `Invalid ${setting.envKey}: "${value}" is not a number, using default ${setting.defaultValue}`,
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
