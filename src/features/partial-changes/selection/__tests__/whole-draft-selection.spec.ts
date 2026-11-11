import type { SelectionInput } from 'src/features/partial-changes/selection/selection';
import {
  isWholeDraftSelection,
  SelectionValidationError,
} from 'src/features/partial-changes/selection/selection-validator';

// The verdicts a host gets for the selection it passes to commit or revert, as the operations decide them: an optional
// field given as null is absent, while any other field, even an empty list or an empty exclusion, makes the selection
// partial.
describe('isWholeDraftSelection', () => {
  it.each<{ selection: string; value: SelectionInput }>([
    { selection: '{ all: true }', value: { all: true } },
    {
      selection: '{ all: true, rows: null }',
      value: { all: true, rows: null },
    },
    {
      selection: '{ all: true, exclude: null }',
      value: { all: true, exclude: null },
    },
    {
      selection: 'all: true with every other field null',
      value: {
        all: true,
        structures: null,
        tableData: null,
        views: null,
        sharedSchemas: null,
        rows: null,
        rowRenames: null,
        rowColumns: null,
        fields: null,
        exclude: null,
      },
    },
  ])('treats $selection as the whole Draft', ({ value }) => {
    expect(isWholeDraftSelection(value)).toBe(true);
  });

  it.each<{ selection: string; value: SelectionInput }>([
    { selection: '{ all: true, rows: [] }', value: { all: true, rows: [] } },
    {
      selection: '{ all: true, exclude: {} }',
      value: { all: true, exclude: {} },
    },
    {
      selection: '{ all: true, exclude: { rows: [] } }',
      value: { all: true, exclude: { rows: [] } },
    },
    {
      selection: '{ all: true, exclude: { rows: null } }',
      value: { all: true, exclude: { rows: null } },
    },
    { selection: '{ all: false }', value: { all: false } },
    { selection: '{ all: null }', value: { all: null } },
    { selection: '{}', value: {} },
  ])('treats $selection as a partial selection', ({ value }) => {
    expect(isWholeDraftSelection(value)).toBe(false);
  });

  it('refuses a malformed selection with the error the operations give', () => {
    const preV2Selection = { all: true, tables: ['products'] };

    expect(() =>
      isWholeDraftSelection(preV2Selection as unknown as SelectionInput),
    ).toThrow(new SelectionValidationError('selection.tables is not allowed'));
  });
});
