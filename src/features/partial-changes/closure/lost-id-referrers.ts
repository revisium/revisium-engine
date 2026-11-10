import { oppositeOf } from 'src/features/draft-revision/commands/impl/target-write-plan';
import type { TableSchemas } from 'src/features/partial-changes/closure/table-schemas';
import type { TargetTable } from 'src/features/partial-changes/closure/target-tables';
import type { TableVersion } from 'src/features/partial-changes/snapshot/changes-snapshot';
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
    return this.referrersIn(referrer.version, jsonPath, referrer, losing);
  }

  public async otherSideReferencesOf(
    referrer: TargetTable,
    losing: TargetTable,
    schemas: TableSchemas,
  ): Promise<ReadonlySet<string>> {
    const otherSide = oppositeOf(referrer.structureSide);
    const other = referrer.pair[otherSide];
    const losingId = losing.pair[otherSide]?.id;
    const referenced = new Set<string>();

    if (other === undefined || losingId === undefined) {
      return referenced;
    }

    for (const { jsonPath } of schemas.foreignKeyLeavesOf(other, losingId)) {
      const referrers = await this.referrersIn(
        other,
        jsonPath,
        referrer,
        losing,
      );

      for (const referencedId of referrers.keys()) {
        referenced.add(referencedId);
      }
    }

    return referenced;
  }

  private referrersIn(
    version: TableVersion,
    jsonPath: string,
    referrer: TargetTable,
    losing: TargetTable,
  ): Promise<ReferrersById> {
    const key = JSON.stringify([version.versionId, jsonPath]);
    const cached = this.reads.get(key);

    if (cached) {
      return cached;
    }

    const read = this.readReferrers(
      version,
      jsonPath,
      losing.losableIds(),
      referrer.loadedIdentities,
    );
    this.reads.set(key, read);

    return read;
  }

  private async readReferrers(
    version: TableVersion,
    jsonPath: string,
    rowIds: readonly string[],
    exceptRows: readonly string[],
  ): Promise<ReferrersById> {
    const found = await this.snapshotReader.readFirstReferrers(
      version.versionId,
      { jsonPath, rowIds, exceptRows },
    );

    return new Map(
      found.map(({ referencedId, rowId }) => [referencedId, rowId]),
    );
  }
}
