import { BadRequestException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import {
  candidateFrom,
  createDraftRevisionStateWriterTestKit,
  givenStateWriter,
  requireTable,
  row,
  table,
} from './draft-revision-state.fixture';

describe('DraftRevision write state: target and tables', () => {
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
    const { headRevisionId } = await testKit.prepare();
    const candidate: DraftRevisionState = { tables: [] };

    await expect(
      testKit.writeState({
        revisionId: headRevisionId,
        candidate,
        sources: { head: { tables: [] }, others: [] },
      }),
    ).rejects.toThrow('The revision is not a draft');
    expect((await testKit.readState(headRevisionId)).tables).toEqual([]);
  });

  it('rejects ambiguous candidate table IDs before writing', async () => {
    const { draftRevisionId } = await testKit.prepare();
    const candidateTable = table({
      id: 'products',
      createdId: 'table-created',
    });

    await expect(
      testKit.writeState({
        revisionId: draftRevisionId,
        candidate: {
          tables: [candidateTable, table({ id: 'Products' })],
        },
        sources: { head: { tables: [] }, others: [] },
      }),
    ).rejects.toThrow(BadRequestException);
    expect((await testKit.readState(draftRevisionId)).tables).toEqual([]);
  });

  it('rejects ambiguous candidate row IDs before writing', async () => {
    const { draftRevisionId } = await testKit.prepare();
    const candidateTable = table({
      rows: [
        row({
          id: 'product-1',
          createdId: 'row-created',
          data: { title: 'A' },
        }),
        row({ id: 'product-1', data: { title: 'B' } }),
      ],
    });

    await expect(
      testKit.writeState({
        revisionId: draftRevisionId,
        candidate: { tables: [candidateTable] },
        sources: { head: { tables: [] }, others: [] },
      }),
    ).rejects.toThrow(BadRequestException);
    expect((await testKit.readState(draftRevisionId)).tables).toEqual([]);
  });

  it('rolls back all created rows and links when a later row violates a real FK', async () => {
    const { draftRevisionId } = await testKit.prepare();
    const validBlob = await testKit.createBlob();
    const tableCreatedId = nanoid();
    const candidateRows = [
      { id: 'row-a', createdId: nanoid() },
      { id: 'row-b', createdId: nanoid() },
    ];
    const rowCreatedIds = candidateRows.map(({ createdId }) => createdId);
    const candidate: DraftRevisionState = {
      tables: [
        table({
          id: 'products',
          createdId: tableCreatedId,
          rows: candidateRows.map(({ id, createdId }, index) =>
            row({
              id,
              createdId,
              data: { order: index },
              hash: `hash-${id}`,
              fileBlobs: [
                { id: index === 0 ? validBlob : 'missing-file-blob' },
              ],
            }),
          ),
        }),
      ],
    };

    await expect(
      testKit.writeState({
        revisionId: draftRevisionId,
        candidate,
        sources: { head: { tables: [] }, others: [] },
      }),
    ).rejects.toThrow();

    expect(await testKit.createdRows(rowCreatedIds)).toBe(0);
    expect(await testKit.createdTableCount(tableCreatedId)).toBe(0);
    expect((await testKit.readState(draftRevisionId)).tables).toEqual([]);
  });

  it('uses exact row and table membership when deciding to reuse a table', async () => {
    const { headRevisionId, draftRevisionId } = await testKit.prepare();
    await testKit.seedState(
      headRevisionId,
      table({
        id: 'products',
        createdId: 'table-created',
        versionId: 'head-table',
        rows: [
          row({ id: 'product-1', createdId: 'row-a', versionId: 'row-a' }),
          row({ id: 'product-2', createdId: 'row-b', versionId: 'row-b' }),
        ],
      }),
    );
    const head = await testKit.readState(headRevisionId);
    const candidate = candidateFrom(head);
    requireTable(candidate).rows.pop();

    const result = await testKit.writeState({
      revisionId: draftRevisionId,
      candidate,
      sources: { head, others: [] },
    });

    expect(result.state.tables[0]?.versionId).not.toBe(
      head.tables[0]?.versionId,
    );
    expect(result.state.tables[0]?.rows).toHaveLength(1);
    expect(
      (await testKit.readState(headRevisionId)).tables[0]?.rows,
    ).toHaveLength(2);
  });

  it('creates a table version when its public ID changes', async () => {
    const { headRevisionId, draftRevisionId } = await testKit.prepare();
    await testKit.seedState(
      headRevisionId,
      table({ rows: [row({ id: 'product-1', createdId: 'row-created' })] }),
    );
    const head = await testKit.readState(headRevisionId);
    const candidate = candidateFrom(head);
    const headTable = requireTable(head);
    requireTable(candidate).id = 'renamed-products';

    const result = await testKit.writeState({
      revisionId: draftRevisionId,
      candidate,
      sources: { head, others: [] },
    });

    expect(requireTable(result.state).versionId).not.toBe(headTable.versionId);
    expect(requireTable(result.state).id).toBe('renamed-products');
    expect(requireTable(result.state).rows[0]?.versionId).toBe(
      headTable.rows[0]?.versionId,
    );
  });

  it('writes an empty candidate without deleting detached versions', async () => {
    const { draftRevisionId } = await testKit.prepare();
    await testKit.seedState(
      draftRevisionId,
      table({
        id: 'products',
        createdId: 'table-created',
        versionId: 'old-table',
        rows: [
          row({
            id: 'product-1',
            createdId: 'row-created',
            versionId: 'old-row',
          }),
        ],
      }),
    );
    const old = await testKit.readState(draftRevisionId);

    const result = await testKit.writeState({
      revisionId: draftRevisionId,
      candidate: { tables: [] },
      sources: { head: { tables: [] }, others: [old] },
    });

    expect(result.state.tables).toEqual([]);
    expect((await testKit.readState(draftRevisionId)).tables).toEqual([]);
    expect(await testKit.tableExists(old.tables[0]?.versionId ?? '')).toBe(
      true,
    );
    expect(
      await testKit.rowExists(old.tables[0]?.rows[0]?.versionId ?? ''),
    ).toBe(true);
  });

  it('fails the batched row association when a referenced row disappears', async () => {
    const scenario = await givenStateWriter(testKit);
    const candidateRow = row({ createdId: nanoid() });
    const candidate = { tables: [table({ rows: [candidateRow] })] };

    await expect(
      scenario.writeAfterCreatedRowDisappears(
        scenario.draftRevisionId,
        candidate,
        {
          head: { tables: [] },
          others: [],
        },
      ),
    ).rejects.toThrow();

    expect(await scenario.rowVersions(candidateRow.createdId)).toEqual([]);
    expect(
      await scenario.hasTableCreatedId(candidate.tables[0]?.createdId ?? ''),
    ).toBe(false);
  });
});
