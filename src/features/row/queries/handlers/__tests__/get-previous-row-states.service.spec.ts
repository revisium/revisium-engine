import { PreviousRowStatesService } from 'src/features/row/services/previous-row-states.service';
import { PreviousRowStatesFixture } from './previous-row-states.fixture';

describe('PreviousRowStatesService', () => {
  let fixture: PreviousRowStatesFixture;

  beforeAll(async () => {
    fixture = await PreviousRowStatesFixture.create();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it('is the application boundary for the previous row states read', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
      ],
    });
    const service = fixture.module.get(PreviousRowStatesService);

    const result = await service.get({
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 10,
    });

    expect(result?.totalCount).toBe(1);
    expect(result?.edges[0]?.node.row.data).toEqual({ value: 'A' });
  });
});
