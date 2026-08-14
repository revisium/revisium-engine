import { EngineApiService } from 'src/engine-api.service';
import { RowApiService } from 'src/features/row/row-api.service';
import { PreviousRowStatesFixture } from './previous-row-states.fixture';

describe('PreviousRowStates API wiring', () => {
  let fixture: PreviousRowStatesFixture;

  beforeAll(async () => {
    fixture = await PreviousRowStatesFixture.create();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it('is exposed through the public row API', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
      ],
    });
    const rowApi = fixture.module.get(RowApiService);

    const result = await rowApi.getPreviousRowStates({
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 10,
    });

    expect(result?.totalCount).toBe(1);
  });

  it('delegates through the flat EngineApi facade', async () => {
    const scenario = await fixture.createLinearScenario({
      states: [
        { rowId: 'row', value: 'A' },
        { rowId: 'row', value: 'B' },
      ],
    });
    const data = {
      revisionId: scenario.revisionIds.at(-1) as string,
      tableId: scenario.tableIds.at(-1) as string,
      rowId: 'row',
      first: 10,
    };
    const rowApi = fixture.module.get(RowApiService);
    const delegate = jest.spyOn(rowApi, 'getPreviousRowStates');
    const engineApi = Object.create(
      EngineApiService.prototype,
    ) as EngineApiService;
    Object.assign(engineApi as unknown as { rowApi: RowApiService }, {
      rowApi,
    });

    const result = await engineApi.getPreviousRowStates(data);

    expect(delegate).toHaveBeenCalledWith(data);
    expect(result?.totalCount).toBe(1);
    delegate.mockRestore();
  });
});
