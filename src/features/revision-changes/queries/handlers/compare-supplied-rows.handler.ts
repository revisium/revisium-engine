import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import {
  CompareSuppliedRowsQuery,
  type CompareSuppliedRowsQueryResult,
} from '../impl/compare-supplied-rows.query';
import { RowDiffService } from 'src/features/revision-changes/services/row-diff.service';

@QueryHandler(CompareSuppliedRowsQuery)
export class CompareSuppliedRowsHandler implements IQueryHandler<CompareSuppliedRowsQuery> {
  constructor(private readonly rowDiffService: RowDiffService) {}

  async execute(
    query: CompareSuppliedRowsQuery,
  ): Promise<CompareSuppliedRowsQueryResult> {
    return {
      pairs: query.data.pairs.map(({ key, fromData, toData }) => ({
        key,
        fieldChanges: this.rowDiffService.analyzeFieldChanges(fromData, toData),
      })),
    };
  }
}
