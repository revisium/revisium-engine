import {
  selectsWholeDraft,
  type Selection,
} from 'src/features/partial-changes/selection/selection';

describe('Selection', () => {
  it('treats only the literal { all: true } as the whole Draft', () => {
    expect(selectsWholeDraft({ all: true })).toBe(true);
  });

  it.each<{ selection: string; value: Selection }>([
    {
      selection: 'all: true with an empty exclusion',
      value: { all: true, exclude: {} },
    },
    {
      selection: 'all: true with an empty exclusion array',
      value: { all: true, exclude: { rows: [] } },
    },
    {
      selection: 'all: true with an empty inclusion array',
      value: { all: true, rows: [] },
    },
    { selection: 'all: false', value: { all: false } },
    { selection: 'an empty selection', value: {} },
  ])('treats $selection as a partial selection', ({ value }) => {
    expect(selectsWholeDraft(value)).toBe(false);
  });
});
