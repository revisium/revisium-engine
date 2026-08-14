import { GetPreviousRowStatesHandler } from 'src/features/row/queries/handlers/get-previous-row-states.handler';
import { GetPreviousRowStatesQuery } from 'src/features/row/queries/impl';
import { PreviousRowStatesService } from 'src/features/row/services/previous-row-states.service';

describe('GetPreviousRowStatesHandler', () => {
  it('delegates query data to PreviousRowStatesService', async () => {
    const data = {
      revisionId: 'revision',
      tableId: 'table',
      rowId: 'row',
      first: 10,
    };
    const result = {
      edges: [],
      totalCount: 0,
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    };
    const service = {
      get: jest.fn().mockResolvedValue(result),
    } as unknown as PreviousRowStatesService;
    const handler = new GetPreviousRowStatesHandler(service);

    await expect(
      handler.execute(new GetPreviousRowStatesQuery(data)),
    ).resolves.toBe(result);
    expect(service.get).toHaveBeenCalledWith(data);
  });
});
