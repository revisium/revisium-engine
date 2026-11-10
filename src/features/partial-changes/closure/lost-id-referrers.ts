import { oppositeOf } from 'src/features/draft-revision/commands/impl/target-write-plan';
import type { TargetTable } from 'src/features/partial-changes/closure/target-tables';
import type { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';

export type ReferrersById = ReadonlyMap<string, string>;

export class LostIdReferrers {
  private readonly reads = new Map<string, Promise<ReferrersById>>();

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

  public async isReferencedOnOtherSide(
    referrer: TargetTable,
    jsonPath: string,
    referencedId: string,
  ): Promise<boolean> {
    const other = referrer.pair[oppositeOf(referrer.structureSide)];

    if (other === undefined) {
      return false;
    }

    if (other.versionId === referrer.version.versionId) {
      return true;
    }

    const found = await this.snapshotReader.readFirstReferrers(
      other.versionId,
      { jsonPath, rowIds: [referencedId], exceptRows: [] },
    );

    return found.length > 0;
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
}
