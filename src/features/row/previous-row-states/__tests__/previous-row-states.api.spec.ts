import { EngineApiService } from 'src/engine-api.service';
import { RowApiService } from 'src/features/row/row-api.service';
import { PreviousRowStatesFixture } from './previous-row-states.fixture';
import { rowState } from './previous-row-states.scenario';

describe('Previous row states API wiring', () => {
  let fixture: PreviousRowStatesFixture;

  beforeAll(async () => {
    fixture = await PreviousRowStatesFixture.create();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it('is exposed through the public row API', async () => {
    const history = await fixture.given({
      revisions: [rowState('created', 'A'), rowState('selected', 'B')],
    });
    const rowApi = fixture.module.get(RowApiService);

    const result = await rowApi.getPreviousRowStates(
      history.inputAt('selected'),
    );

    expect(result?.totalCount).toBe(1);
  });

  it('delegates through the flat EngineApi facade', async () => {
    const history = await fixture.given({
      revisions: [rowState('created', 'A'), rowState('selected', 'B')],
    });
    const data = history.inputAt('selected');
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
