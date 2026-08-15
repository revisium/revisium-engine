import { BISECT_MAX_ROW_VERSIONS } from 'src/features/row/previous-row-states/sql/get-previous-row-states.sql';
import { PreviousRowStatesFixture } from './previous-row-states.fixture';
import { rowState } from './previous-row-states.scenario';

/**
 * Rows with more than BISECT_MAX_ROW_VERSIONS versions switch the
 * introduction stage to the membership scan; nothing else in the suite
 * crosses that threshold, so this exercises the scan SQL end to end.
 */
describe('Previous row states beyond the bisection threshold', () => {
  let fixture: PreviousRowStatesFixture;

  beforeAll(async () => {
    fixture = await PreviousRowStatesFixture.create();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it('scans memberships with identical semantics and pagination', async () => {
    const stateCount = BISECT_MAX_ROW_VERSIONS + 5;
    const history = await fixture.given({
      revisions: Array.from({ length: stateCount }, (_, index) =>
        rowState(
          index === stateCount - 1 ? 'selected' : `state-${index}`,
          // Every second state is a copy-on-write no-op of its predecessor.
          `value-${Math.floor(index / 2)}`,
        ),
      ),
    });

    const firstPage = await history.at('selected', { first: 3 });
    const secondPage = await history.at('selected', {
      first: 3,
      after: firstPage?.pageInfo.endCursor,
    });

    // 105 versions collapse to 53 distinct states; the newest is selected.
    const distinctStates = Math.ceil(stateCount / 2);
    expect(firstPage?.totalCount).toBe(distinctStates - 1);
    expect(firstPage?.pageInfo.hasNextPage).toBe(true);
    expect(
      [...(firstPage?.edges ?? []), ...(secondPage?.edges ?? [])].map(
        ({ node }) => [
          (node.row.data as { value: string }).value,
          node.introducedBy,
        ],
      ),
    ).toEqual([
      ['value-51', ['modified']],
      ['value-50', ['modified']],
      ['value-49', ['modified']],
      ['value-48', ['modified']],
      ['value-47', ['modified']],
      ['value-46', ['modified']],
    ]);
  }, 120_000);
});
