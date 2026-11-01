import type { TargetTable } from 'src/features/partial-changes/closure/target-tables';
import type {
  ChangesSnapshotReader,
  FirstReferrer,
} from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';

export class UnresolvedReferences {
  private readonly reads = new Map<string, Promise<FirstReferrer[]>>();

  constructor(private readonly snapshotReader: ChangesSnapshotReader) {}

  public from(
    referrer: TargetTable,
    jsonPath: string,
    referenced: TargetTable,
  ): Promise<FirstReferrer[]> {
    const key = JSON.stringify([
      referrer.version.versionId,
      jsonPath,
      referenced.version.versionId,
    ]);
    const cached = this.reads.get(key);

    if (cached) {
      return cached;
    }

    const read = this.snapshotReader.readUnresolvedReferences(
      referrer.version.versionId,
      {
        jsonPath,
        exceptRows: referrer.loadedIdentities,
        referencedTableVersionId: referenced.version.versionId,
        changedRowIds: referenced.touchedIds(),
      },
    );
    this.reads.set(key, read);

    return read;
  }
}
