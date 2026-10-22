import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { buildChangeCatalogue } from 'src/features/partial-changes-poc/catalogue/build-change-catalogue';
import { listUnits } from 'src/features/partial-changes-poc/listing/list-units';
import {
  ListChangesQuery,
  ListChangesQueryReturnType,
} from 'src/features/partial-changes-poc/queries/impl/list-changes.query';
import { PlanningTransaction } from 'src/features/partial-changes-poc/queries/planning-transaction.service';
import { SnapshotReader } from 'src/features/partial-changes-poc/snapshot/snapshot-reader.service';
import { ViewsProjection } from 'src/features/partial-changes-poc/views/views-projection.service';

@QueryHandler(ListChangesQuery)
export class ListChangesHandler implements IQueryHandler<
  ListChangesQuery,
  ListChangesQueryReturnType
> {
  constructor(
    private readonly planningTransaction: PlanningTransaction,
    private readonly snapshotReader: SnapshotReader,
    private readonly viewsProjection: ViewsProjection,
  ) {}

  execute({ data }: ListChangesQuery): Promise<ListChangesQueryReturnType> {
    return this.planningTransaction.run(() => this.list(data));
  }

  private async list(
    data: ListChangesQuery['data'],
  ): Promise<ListChangesQueryReturnType> {
    const snapshot = await this.snapshotReader.read(data.branch);
    const catalogue = buildChangeCatalogue(
      snapshot,
      this.viewsProjection.migrator,
    );
    return {
      headRevisionId: snapshot.headRevisionId,
      draftRevisionId: snapshot.draftRevisionId,
      ...listUnits(catalogue, data),
    };
  }
}
