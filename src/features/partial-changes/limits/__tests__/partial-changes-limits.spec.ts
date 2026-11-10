import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PartialChangesLimits } from 'src/features/partial-changes/limits/partial-changes-limits';

const DEFAULT_MAX_CHANGED_ROWS = 20_000;

describe('PartialChangesLimits', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the conservative defaults when nothing is configured', () => {
    expect(limitsConfiguredWith({})).toEqual({
      maxChangedRows: DEFAULT_MAX_CHANGED_ROWS,
      maxPerRowWork: 2_000,
      maxMixedTableLinks: 100_000,
    });
  });

  it('reads the configured limits', () => {
    expect(
      limitsConfiguredWith({
        PARTIAL_CHANGES_MAX_CHANGED_ROWS: '500',
        PARTIAL_CHANGES_MAX_PER_ROW_WORK: '50',
        PARTIAL_CHANGES_MAX_MIXED_TABLE_LINKS: '5000',
      }),
    ).toEqual({
      maxChangedRows: 500,
      maxPerRowWork: 50,
      maxMixedTableLinks: 5000,
    });
  });

  it('reads a configured value with surrounding whitespace', () => {
    expect(
      limitsConfiguredWith({ PARTIAL_CHANGES_MAX_CHANGED_ROWS: ' 500 ' })
        .maxChangedRows,
    ).toBe(500);
  });

  it.each(['many', '0', '-1', '1e5', '100_000', '2000abc', '2.5'])(
    'keeps the default for the invalid setting %p with a warning',
    (value) => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const limits = limitsConfiguredWith({
        PARTIAL_CHANGES_MAX_CHANGED_ROWS: value,
      });

      expect(limits.maxChangedRows).toBe(DEFAULT_MAX_CHANGED_ROWS);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid PARTIAL_CHANGES_MAX_CHANGED_ROWS'),
      );
    },
  );

  it('logs the effective limits at startup and names the variables of the non-default ones', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const limits = new PartialChangesLimits(
      new ConfigService({ PARTIAL_CHANGES_MAX_PER_ROW_WORK: '50' }),
    );

    limits.onModuleInit();

    expect(log).toHaveBeenCalledWith(
      'Partial changes limits: maxChangedRows=20000, maxPerRowWork=50 (from PARTIAL_CHANGES_MAX_PER_ROW_WORK), maxMixedTableLinks=100000',
    );
  });
});

function limitsConfiguredWith(settings: Record<string, string>) {
  const { maxChangedRows, maxPerRowWork, maxMixedTableLinks } =
    new PartialChangesLimits(new ConfigService(settings));

  return { maxChangedRows, maxPerRowWork, maxMixedTableLinks };
}
