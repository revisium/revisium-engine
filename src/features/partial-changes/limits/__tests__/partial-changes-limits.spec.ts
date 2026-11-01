import { ConfigService } from '@nestjs/config';
import { PartialChangesLimits } from 'src/features/partial-changes/limits/partial-changes-limits';

const DEFAULT_MAX_CHANGED_ROWS = 100_000;

describe('PartialChangesLimits', () => {
  it('uses the provisional defaults when nothing is configured', () => {
    expect(limitsConfiguredWith({})).toEqual({
      maxChangedRows: DEFAULT_MAX_CHANGED_ROWS,
      maxPerRowWork: 10_000,
      maxMixedTableLinks: 250_000,
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

  it.each(['many', '0', '-1'])(
    'keeps the default for the invalid setting %p',
    (value) => {
      const limits = limitsConfiguredWith({
        PARTIAL_CHANGES_MAX_CHANGED_ROWS: value,
      });

      expect(limits.maxChangedRows).toBe(DEFAULT_MAX_CHANGED_ROWS);
    },
  );
});

function limitsConfiguredWith(settings: Record<string, string>) {
  const { maxChangedRows, maxPerRowWork, maxMixedTableLinks } =
    new PartialChangesLimits(new ConfigService(settings));

  return { maxChangedRows, maxPerRowWork, maxMixedTableLinks };
}
