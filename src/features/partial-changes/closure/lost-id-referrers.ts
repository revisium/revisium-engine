import { oppositeOf } from 'src/features/draft-revision/commands/impl/target-write-plan';
import type {
  ForeignKeyLeaf,
  TableSchemas,
} from 'src/features/partial-changes/closure/table-schemas';
import type { TargetTable } from 'src/features/partial-changes/closure/target-tables';
import type { TableVersion } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';

export type ReferrersById = ReadonlyMap<string, string>;

export class LostIdReferrers {
  private readonly reads = new Map<string, Promise<ReferrersById>>();
  private readonly otherSideReads = new Map<
    string,
    Promise<ReadonlySet<string>>
  >();

  constructor(private readonly snapshotReader: ChangesSnapshotReader) {}

  public referrersOf(
    referrer: TargetTable,
    jsonPath: string,
    losing: TargetTable,
  ): Promise<ReferrersById> {
    const key = JSON.stringify([referrer.version.versionId, jsonPath]);
    const cached = this.reads.get(key);

    if (cached) {
      return cached;
    }

    const read = this.readReferrers(referrer, jsonPath, losing.losableIds());
    this.reads.set(key, read);

    return read;
  }

  public otherSideReferencesOf(
    referrer: TargetTable,
    losing: TargetTable,
    schemas: TableSchemas,
  ): Promise<ReadonlySet<string>> {
    const otherSide = oppositeOf(referrer.structureSide);
    const other = referrer.pair[otherSide];
    const losingId = losing.pair[otherSide]?.id;

    if (other === undefined || losingId === undefined) {
      return Promise.resolve(new Set());
    }

    const key = JSON.stringify([other.versionId, losingId]);
    const cached = this.otherSideReads.get(key);

    if (cached) {
      return cached;
    }

    const read = this.readReferencedIds(
      other,
      schemas.foreignKeyLeavesOf(other, losingId),
      losing.losableIds(),
    );
    this.otherSideReads.set(key, read);

    return read;
  }

  private async readReferrers(
    referrer: TargetTable,
    jsonPath: string,
    rowIds: readonly string[],
  ): Promise<ReferrersById> {
    const found = await this.snapshotReader.readFirstReferrers(
      referrer.version.versionId,
      { jsonPath, rowIds, exceptRows: referrer.loadedIdentities },
    );

    return new Map(
      found.map(({ referencedId, rowId }) => [referencedId, rowId]),
    );
  }

  private async readReferencedIds(
    version: TableVersion,
    leaves: readonly ForeignKeyLeaf[],
    rowIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    const referenced = new Set<string>();

    for (const { jsonPath } of leaves) {
      const found = await this.snapshotReader.readFirstReferrers(
        version.versionId,
        { jsonPath, rowIds, exceptRows: [] },
      );

      for (const { referencedId } of found) {
        referenced.add(referencedId);
      }
    }

    return referenced;
  }
}
