import { BadRequestException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { PreviousRowStatesFixture } from './previous-row-states.fixture';

describe('PreviousRowStates pagination', () => {
  let fixture: PreviousRowStatesFixture;

  beforeAll(async () => {
    fixture = await PreviousRowStatesFixture.create();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it('concatenates keyset pages with an exact stable totalCount', async () => {
    const scenario = await fixture.createLinearScenario({
      states: ['A', 'B', 'C', 'D', 'E'].map((value) => ({
        rowId: 'row',
        value,
      })),
    });

    const firstPage = await fixture.execute({
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 2,
    });
    const secondPage = await fixture.execute({
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 2,
      after: firstPage?.pageInfo.endCursor,
    });

    expect(firstPage?.totalCount).toBe(4);
    expect(secondPage?.totalCount).toBe(4);
    expect(firstPage?.pageInfo.hasNextPage).toBe(true);
    expect(firstPage?.pageInfo.hasPreviousPage).toBe(false);
    expect(secondPage?.pageInfo.hasNextPage).toBe(false);
    expect(secondPage?.pageInfo.hasPreviousPage).toBe(true);
    expect(
      [...(firstPage?.edges ?? []), ...(secondPage?.edges ?? [])].map(
        ({ node }) => (node.row.data as { value: string }).value,
      ),
    ).toEqual(['D', 'C', 'B', 'A']);
  });

  it('returns an empty exhausted page for a valid cursor', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
        { rowId: 'row', value: 'C' },
      ],
    });
    const firstPage = await fixture.execute({
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 2,
    });

    const exhaustedPage = await fixture.execute({
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 2,
      after: firstPage?.pageInfo.endCursor,
    });

    expect(exhaustedPage).toEqual({
      edges: [],
      totalCount: 2,
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: true,
      },
    });
  });

  it('rejects malformed, scope-mismatched, and non-event cursors', async () => {
    const firstScenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
        { rowId: 'row', value: 'C' },
      ],
    });
    const firstPage = await fixture.execute({
      revisionId: firstScenario.revisionIds.at(-1) as string,
      tableId: firstScenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 1,
    });
    const cursor = firstPage?.pageInfo.endCursor as string;

    await expect(
      fixture.execute({
        revisionId: firstScenario.revisionIds.at(-1) as string,
        tableId: firstScenario.tableIds.at(-1) as string,
        rowId: 'row',
        first: 1,
        after: 'not-a-json-cursor',
      }),
    ).rejects.toThrow(BadRequestException);

    const secondScenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
      ],
    });
    await expect(
      fixture.execute({
        revisionId: secondScenario.revisionIds.at(-1) as string,
        tableId: secondScenario.tableIds.at(-1) as string,
        rowId: 'row',
        first: 1,
        after: cursor,
      }),
    ).rejects.toThrow(BadRequestException);

    const nonEventPayload = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    nonEventPayload.eventRevisionId = firstScenario.revisionIds.at(
      -1,
    ) as string;
    await expect(
      fixture.execute({
        revisionId: firstScenario.revisionIds.at(-1) as string,
        tableId: firstScenario.tableIds.at(-1) as string,
        rowId: 'row',
        first: 1,
        after: Buffer.from(JSON.stringify(nonEventPayload)).toString(
          'base64url',
        ),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an explicitly supplied empty cursor', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
      ],
    });

    await expect(
      fixture.execute({
        revisionId: scenario.revisionIds.at(-1) as string,
        tableId: scenario.tableIds.at(-1) as string,
        rowId: 'row',
        first: 1,
        after: '',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a different-tip cursor before an unresolved selector', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
        { rowId: 'row', value: 'C' },
      ],
    });
    const firstPage = await fixture.execute({
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 1,
    });

    await expect(
      fixture.execute({
        revisionId: nanoid(),
        tableId: scenario.tableIds.at(-1) as string,
        rowId: 'row',
        first: 1,
        after: firstPage?.pageInfo.endCursor as string,
      }),
    ).rejects.toThrow('Previous row states cursor');
  });

  it('rejects a cursor after its selected Row snapshot is invalidated', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
        { rowId: 'row', value: 'C' },
      ],
    });
    const firstPage = await fixture.execute({
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 1,
    });
    await fixture.prisma.row.update({
      where: { versionId: scenario.rowVersionIds.at(-1) as string },
      data: { id: 'renamed-after-cursor' },
    });

    await expect(
      fixture.execute({
        revisionId: scenario.revisionIds.at(-1) as string,
        tableId: scenario.tableIds.at(-1) as string,
        rowId: 'row',
        first: 1,
        after: firstPage?.pageInfo.endCursor as string,
      }),
    ).rejects.toThrow('Previous row states cursor');
  });

  it.each([0, 101, 1.5])('rejects invalid first=%s', async (first) => {
    const scenario = await fixture.createLinearScenario({
      states: [{ rowId: 'row', value: 'A' }],
    });

    await expect(
      fixture.execute({
        revisionId: scenario.revisionIds[0] as string,
        tableId: scenario.tableIds[0] as string,
        rowId: 'row',
        first,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
