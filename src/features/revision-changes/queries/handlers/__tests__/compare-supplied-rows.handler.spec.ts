import { CompareSuppliedRowsHandler } from 'src/features/revision-changes/queries/handlers/compare-supplied-rows.handler';
import { CompareSuppliedRowsQuery } from 'src/features/revision-changes/queries/impl/compare-supplied-rows.query';
import { RowChangeDetailType } from 'src/features/revision-changes/types';
import { RowDiffService } from 'src/features/revision-changes/services/row-diff.service';

describe('CompareSuppliedRowsHandler', () => {
  it('returns semantic differences correlated to each supplied pair', async () => {
    const result = await new CompareSuppliedRowsHandler(
      new RowDiffService(),
    ).execute(
      new CompareSuppliedRowsQuery({
        pairs: [
          {
            key: 'row-a',
            fromData: { title: 'Head', count: 1 },
            toData: { title: 'Draft', count: 1 },
          },
          {
            key: 'row-b',
            fromData: { title: 'same' },
            toData: { title: 'same', note: null },
          },
        ],
      }),
    );

    expect(result.pairs).toEqual([
      {
        key: 'row-a',
        fieldChanges: [
          {
            fieldPath: 'title',
            oldValue: 'Head',
            newValue: 'Draft',
            changeType: RowChangeDetailType.FieldModified,
          },
        ],
      },
      {
        key: 'row-b',
        fieldChanges: [
          {
            fieldPath: 'note',
            oldValue: null,
            newValue: null,
            changeType: RowChangeDetailType.FieldAdded,
          },
        ],
      },
    ]);
  });

  it('compares invalid JSON values without validating them against a row schema', async () => {
    const result = await new CompareSuppliedRowsHandler(
      new RowDiffService(),
    ).execute(
      new CompareSuppliedRowsQuery({
        pairs: [
          {
            key: 'invalid-draft',
            fromData: { count: 1 },
            toData: { count: 'not-a-number' },
          },
        ],
      }),
    );

    expect(result.pairs[0]?.fieldChanges[0]).toMatchObject({
      fieldPath: 'count',
      oldValue: 1,
      newValue: 'not-a-number',
      changeType: RowChangeDetailType.FieldModified,
    });
  });

  it('leaves supplied row values unchanged', async () => {
    const pairs = [
      {
        key: 'nested',
        fromData: { details: { title: 'Before' } },
        toData: { details: { title: 'After' } },
      },
    ];
    const original = structuredClone(pairs);

    await new CompareSuppliedRowsHandler(new RowDiffService()).execute(
      new CompareSuppliedRowsQuery({ pairs }),
    );

    expect(pairs).toEqual(original);
  });
});
