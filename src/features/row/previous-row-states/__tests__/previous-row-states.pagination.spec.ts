import { BadRequestException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { PreviousRowStatesFixture } from './previous-row-states.fixture';
import {
  rowState,
  type PreviousRowStatesScenario,
} from './previous-row-states.scenario';

describe('Previous row states pagination', () => {
  let fixture: PreviousRowStatesFixture;

  beforeAll(async () => {
    fixture = await PreviousRowStatesFixture.create();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it('concatenates keyset pages with an exact stable totalCount', async () => {
    const history = await givenValues(fixture, ['A', 'B', 'C', 'D', 'E']);

    const firstPage = await history.at('selected', { first: 2 });
    const secondPage = await history.at('selected', {
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
    const history = await givenValues(fixture, ['A', 'B', 'C']);
    const firstPage = await history.at('selected', { first: 2 });

    const exhaustedPage = await history.at('selected', {
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
    const firstHistory = await givenValues(fixture, ['A', 'B', 'C']);
    const firstPage = await firstHistory.at('selected', { first: 1 });
    const cursor = firstPage?.pageInfo.endCursor as string;

    await expect(
      firstHistory.at('selected', { first: 1, after: 'not-a-json-cursor' }),
    ).rejects.toThrow(BadRequestException);

    const secondHistory = await givenValues(fixture, ['A', 'B']);
    await expect(
      secondHistory.at('selected', { first: 1, after: cursor }),
    ).rejects.toThrow(BadRequestException);

    const nonEventPayload = decodeCursorPayload(cursor);
    nonEventPayload.eventRevisionId = firstHistory.revisionId('selected');
    await expect(
      firstHistory.at('selected', {
        first: 1,
        after: encodeCursorPayload(nonEventPayload),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an explicitly supplied empty cursor', async () => {
    const history = await givenValues(fixture, ['A', 'B']);

    await expect(
      history.at('selected', { first: 1, after: '' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a different-tip cursor before an unresolved selector', async () => {
    const history = await givenValues(fixture, ['A', 'B', 'C']);
    const firstPage = await history.at('selected', { first: 1 });
    const selected = history.revision('selected');

    await expect(
      fixture.execute({
        revisionId: nanoid(),
        tableId: selected.tableId,
        rowId: selected.rowId as string,
        first: 1,
        after: firstPage?.pageInfo.endCursor,
      }),
    ).rejects.toThrow('Previous row states cursor');
  });

  it('rejects a cursor after its selected Row snapshot is invalidated', async () => {
    const history = await givenValues(fixture, ['A', 'B', 'C']);
    const firstPage = await history.at('selected', { first: 1 });
    await fixture.prisma.row.update({
      where: { versionId: history.rowVersionId('selected') },
      data: { id: 'renamed-after-cursor' },
    });

    await expect(
      history.at('selected', {
        first: 1,
        after: firstPage?.pageInfo.endCursor,
      }),
    ).rejects.toThrow('Previous row states cursor');
  });

  it.each([0, 101, 1.5])('rejects invalid first=%s', async (first) => {
    const history = await givenValues(fixture, ['A']);

    await expect(history.at('selected', { first })).rejects.toThrow(
      BadRequestException,
    );
  });
});

function givenValues(
  fixture: PreviousRowStatesFixture,
  values: readonly string[],
): Promise<PreviousRowStatesScenario> {
  return fixture.given({
    revisions: values.map((value, index) =>
      rowState(
        index === values.length - 1 ? 'selected' : `state-${index}`,
        value,
      ),
    ),
  });
}

function decodeCursorPayload(cursor: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(cursor, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}

function encodeCursorPayload(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}
