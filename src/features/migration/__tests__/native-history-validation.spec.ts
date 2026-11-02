import { str } from '@revisium/schema-toolkit/mocks';
import {
  passesNativeHistoryValidation,
  type TableHistories,
} from 'src/features/migration/ledger-repair/draft-ledger';
import {
  addField,
  validator,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import type { HistoryPatches } from 'src/features/share/queries/impl';

const NATIVE_ENTRY: HistoryPatches = {
  patches: [addField('note', str())],
  hash: 'hash of the previous schema',
  date: '2026-11-01T00:00:00.000Z',
};
const REFUSED_ENTRY = {
  hash: 'an entry without patches',
} as unknown as HistoryPatches;

describe('Native validation of the schema histories of a Head table', () => {
  it('passes a missing Draft history when the caller decides the table by its baseline', () => {
    expect(
      passesNativeHistoryValidation(undefined, validator, {
        missingHistory: 'passes',
      }),
    ).toBe(true);
  });

  it('fails a missing Draft history when the caller requires the table to store one', () => {
    expect(
      passesNativeHistoryValidation(undefined, validator, {
        missingHistory: 'fails',
      }),
    ).toBe(false);
  });

  it('passes inherited and pending entries that native writes accept', () => {
    expect(
      passesNativeHistoryValidation(
        historiesOf([NATIVE_ENTRY], [NATIVE_ENTRY]),
        validator,
        { missingHistory: 'fails' },
      ),
    ).toBe(true);
  });

  it.each([
    {
      entry: 'an inherited entry',
      histories: historiesOf([REFUSED_ENTRY], [NATIVE_ENTRY]),
    },
    {
      entry: 'a pending entry',
      histories: historiesOf([NATIVE_ENTRY], [REFUSED_ENTRY]),
    },
  ])('fails $entry that native writes refuse', ({ histories }) => {
    expect(
      passesNativeHistoryValidation(histories, validator, {
        missingHistory: 'passes',
      }),
    ).toBe(false);
  });
});

function historiesOf(
  inherited: readonly HistoryPatches[],
  pending: readonly HistoryPatches[],
): TableHistories {
  return { draftTableId: 'notes', inherited, pending };
}
