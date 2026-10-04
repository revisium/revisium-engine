import { BadRequestException } from '@nestjs/common';
import { createDraftRevisionStateWriterTestKit, row, table } from './support';

describe('DraftRevision write state validation', () => {
  let testKit: Awaited<
    ReturnType<typeof createDraftRevisionStateWriterTestKit>
  >;

  beforeAll(async () => {
    testKit = await createDraftRevisionStateWriterTestKit();
  });

  afterAll(async () => {
    await testKit.close();
  });

  it('rejects a committed target revision without changing it', async () => {
    const s = await testKit.given();

    await expect(
      s.writeTo(
        s.headRevisionId,
        { tables: [] },
        { head: { tables: [] }, others: [] },
      ),
    ).rejects.toThrow('The revision is not a draft');

    expect((await s.headState()).tables).toEqual([]);
  });

  it('rejects candidate table IDs that differ only by case', async () => {
    const s = await testKit.given();

    await expect(
      s.write({
        tables: [table({ id: 'products' }), table({ id: 'Products' })],
      }),
    ).rejects.toThrow(BadRequestException);

    expect((await s.draftState()).tables).toEqual([]);
  });

  it('rejects duplicate table created IDs', async () => {
    const s = await testKit.given();

    await expect(
      s.write({
        tables: [
          table({ id: 'first', createdId: 'same-table' }),
          table({ id: 'second', createdId: 'same-table' }),
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    expect((await s.draftState()).tables).toEqual([]);
  });

  it('rejects duplicate row public IDs within one table', async () => {
    const s = await testKit.given();

    await expect(
      s.write({
        tables: [
          table({ rows: [row({ id: 'product' }), row({ id: 'product' })] }),
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    expect((await s.draftState()).tables).toEqual([]);
  });

  it('rejects duplicate row created IDs within one table', async () => {
    const s = await testKit.given();

    await expect(
      s.write({
        tables: [
          table({
            rows: [
              row({ id: 'first', createdId: 'same-row' }),
              row({ id: 'second', createdId: 'same-row' }),
            ],
          }),
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    expect((await s.draftState()).tables).toEqual([]);
  });
});
