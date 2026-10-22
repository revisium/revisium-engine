import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  buildChangeCatalogue,
  publicTableId,
} from 'src/features/partial-changes-poc/catalogue/build-change-catalogue';
import {
  cursorTableOf,
  listUnits,
  UnitsPageRequest,
} from 'src/features/partial-changes-poc/listing/list-units';
import {
  ListChangesQuery,
  ListChangesQueryReturnType,
} from 'src/features/partial-changes-poc/queries/impl/list-changes.query';
import { PlanningTransaction } from 'src/features/partial-changes-poc/queries/planning-transaction.service';
import { SnapshotReader } from 'src/features/partial-changes-poc/snapshot/snapshot-reader.service';
import {
  ChangesSnapshot,
  hasChangedUserRows,
  TablePair,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';
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
    const unread = tablesToRead(snapshot, data);

    for (;;) {
      const [next] = unread;
      const page = listUnits(
        buildChangeCatalogue(snapshot, this.viewsProjection.migrator),
        data,
        next ? publicTableId(next) : undefined,
      );
      if (page.complete || !next) {
        return {
          headRevisionId: snapshot.headRevisionId,
          draftRevisionId: snapshot.draftRevisionId,
          units: page.units,
          nextCursor: page.nextCursor,
        };
      }
      await this.snapshotReader.attachChangedRows([next]);
      unread.shift();
    }
  }
}

function tablesToRead(
  snapshot: ChangesSnapshot,
  page: UnitsPageRequest,
): TablePair[] {
  const from = cursorTableOf(page) ?? '';
  return snapshot.tables
    .filter(hasChangedUserRows)
    .filter((pair) => publicTableId(pair) >= from)
    .filter(
      (pair) =>
        page.tableId === undefined || publicTableId(pair) === page.tableId,
    )
    .sort((a, b) => (publicTableId(a) < publicTableId(b) ? -1 : 1));
}
