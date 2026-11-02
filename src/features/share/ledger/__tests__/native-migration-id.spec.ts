import { nextNativeMigrationId } from 'src/features/share/ledger/native-migration-id';

describe('Native migration ID range', () => {
  const diagnostic =
    'Native migration history has exhausted the supported date range';

  it('rejects an exhausted nonfractional export bound', () => {
    const id = '9999-12-31T23:59:59Z';

    expect(() =>
      nextNativeMigrationId({ id, publishedAt: new Date(id) }),
    ).toThrow(new RangeError(diagnostic));
  });

  it('rejects a timestamp bound beyond the canonical range', () => {
    expect(() =>
      nextNativeMigrationId({
        id: '9999-12-31T23:59:59-05:00',
        publishedAt: new Date('9999-12-31T23:59:59-05:00'),
      }),
    ).toThrow(new RangeError(diagnostic));
  });

  it('rejects a nonfinite bound with the allocation diagnostic', () => {
    expect(() =>
      nextNativeMigrationId({ id: null, publishedAt: new Date(Number.NaN) }),
    ).toThrow(new RangeError(diagnostic));
  });
});
