import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type NumericSetting,
  readNumericSetting,
} from 'src/infrastructure/database/numeric-setting';

const SETTING: NumericSetting = {
  envKey: 'SOME_SETTING',
  defaultValue: 50,
  minValue: 0,
  maxValue: 1000,
};

describe('readNumericSetting', () => {
  it.each([
    ['0', 0],
    ['1000', 1000],
    [' 7 ', 7],
  ])('reads %p as %p', (value, expected) => {
    expect(read(value)).toEqual({ value: expected, warnings: [] });
  });

  it('keeps the default without a warning when nothing is configured', () => {
    expect(read(undefined)).toEqual({ value: 50, warnings: [] });
  });

  it.each(['+5', '   ', '0x10', '15000ms', '15000.0', '1e3', '1_000'])(
    'keeps the default for %p, which is not a whole decimal integer, with a warning',
    (value) => {
      expect(read(value)).toEqual({
        value: 50,
        warnings: [
          `Invalid SOME_SETTING: "${value}" is not an integer, using default 50`,
        ],
      });
    },
  );

  it('keeps the default for a value below the minimum, with a warning', () => {
    expect(read('-1')).toEqual({
      value: 50,
      warnings: [
        'Invalid SOME_SETTING: -1 is below minimum 0, using default 50',
      ],
    });
  });

  it.each([
    ['1001', 1000],
    ['99999999999999999999', 1000],
  ])(
    'keeps the default for %p, above the maximum, with a warning',
    (value, maximum) => {
      expect(read(value)).toEqual({
        value: 50,
        warnings: [
          `Invalid SOME_SETTING: ${value} is above maximum ${maximum}, using default 50`,
        ],
      });
    },
  );

  it('bounds a setting without a maximum by the largest safe integer', () => {
    const unbounded: NumericSetting = { ...SETTING, maxValue: undefined };

    expect(read('99999999999999999999', unbounded).value).toBe(50);
    expect(read(String(Number.MAX_SAFE_INTEGER), unbounded).value).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});

function read(value: string | undefined, setting: NumericSetting = SETTING) {
  const logger = new Logger('test');
  const warn = jest.spyOn(logger, 'warn').mockImplementation();
  const settings: Record<string, string> =
    value === undefined ? {} : { [setting.envKey]: value };

  return {
    value: readNumericSetting(new ConfigService(settings), setting, logger),
    warnings: warn.mock.calls.map(([message]) => message as string),
  };
}
