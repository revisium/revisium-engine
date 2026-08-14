import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  GetPreviousRowStatesQuery,
  type GetPreviousRowStatesQueryReturnType,
} from 'src/features/row/queries/impl/get-previous-row-states.query';
import { PreviousRowStatesService } from 'src/features/row/services/previous-row-states.service';

@QueryHandler(GetPreviousRowStatesQuery)
export class GetPreviousRowStatesHandler implements IQueryHandler<
  GetPreviousRowStatesQuery,
  GetPreviousRowStatesQueryReturnType
> {
  constructor(private readonly service: PreviousRowStatesService) {}

  execute({
    data,
  }: GetPreviousRowStatesQuery): Promise<GetPreviousRowStatesQueryReturnType> {
    return this.service.get(data);
  }
}
