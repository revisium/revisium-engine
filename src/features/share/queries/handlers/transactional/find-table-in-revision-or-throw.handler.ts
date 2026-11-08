import { BadRequestException } from '@nestjs/common';
import { IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs';
import { FindTableInRevisionOrThrowQuery } from 'src/features/share/queries/impl/transactional/find-table-in-revision-or-throw.query';
import { FindTableInRevisionQuery } from 'src/features/share/queries/impl/transactional/find-table-in-revision.query';
import { FindTableInRevisionType } from 'src/features/share/queries/types';

@QueryHandler(FindTableInRevisionOrThrowQuery)
export class FindTableInRevisionOrThrowHandler implements IQueryHandler<FindTableInRevisionOrThrowQuery> {
  constructor(private readonly queryBus: QueryBus) {}

  async execute({
    data,
  }: FindTableInRevisionOrThrowQuery): Promise<FindTableInRevisionType> {
    const existingTable = await this.queryBus.execute<
      FindTableInRevisionQuery,
      FindTableInRevisionType | null
    >(new FindTableInRevisionQuery(data));

    if (!existingTable) {
      throw new BadRequestException(
        'A table with this name does not exist in the revision',
      );
    }

    return existingTable;
  }
}
