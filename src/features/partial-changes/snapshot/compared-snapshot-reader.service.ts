import { Injectable } from '@nestjs/common';
import {
  checkHeadSchema,
  type HeadSchemaCheck,
} from 'src/features/partial-changes/head-schema/head-schema-check';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import type {
  ChangesBranch,
  ChangesSnapshot,
  ComparedTable,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  attributeLedger,
  type LedgerAttribution,
  pendingMigrationsOf,
} from 'src/features/partial-changes/snapshot/ledger-attribution';
import { SourceReplays } from 'src/features/partial-changes/snapshot/source-replays';
import { tableSideOf } from 'src/features/partial-changes/snapshot/table-side';
import { analyzeTableStructure } from 'src/features/partial-changes/structure/table-structure';
import { LedgerReplayer } from 'src/features/share/ledger-replay/ledger-replayer';
import { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';

export interface ComparedSnapshot {
  readonly snapshot: ChangesSnapshot;
  readonly ledger: LedgerAttribution;
  readonly headSchema: HeadSchemaCheck;
  readonly tables: readonly ComparedTable[];
}

export interface ComparisonScope {
  readonly wholeDraft: boolean;
}

@Injectable()
export class ComparedSnapshotReader {
  constructor(
    private readonly snapshotReader: ChangesSnapshotReader,
    private readonly schemaRules: NativeSchemaRules,
    private readonly replayer: LedgerReplayer,
  ) {}

  public async readComparedSnapshot(
    branch: ChangesBranch,
    { wholeDraft }: ComparisonScope,
  ): Promise<ComparedSnapshot> {
    const snapshot = await this.snapshotReader.readSnapshot(branch);
    const ledger = attributeLedger(snapshot);
    const headSchema = checkHeadSchema({
      snapshot,
      replays: new SourceReplays(snapshot, this.replayer),
      wholeDraft,
    });

    return {
      snapshot,
      ledger,
      headSchema,
      tables: this.comparedTablesOf(snapshot, ledger, headSchema),
    };
  }

  private comparedTablesOf(
    snapshot: ChangesSnapshot,
    ledger: LedgerAttribution,
    headSchema: HeadSchemaCheck,
  ): ComparedTable[] {
    return snapshot.tables.flatMap(({ identity, head, draft }) => {
      if (!head || !draft) {
        return [];
      }

      const structure = analyzeTableStructure(
        {
          head: tableSideOf(snapshot.tables, head, 'head'),
          draft: tableSideOf(snapshot.tables, draft, 'draft'),
          pendingMigrations: pendingMigrationsOf(ledger, identity),
          replayedHeadSchema: headSchema.replayedHeadSchemas.get(identity),
        },
        this.schemaRules,
      );

      return [
        {
          identity,
          headVersionId: head.versionId,
          draftVersionId: draft.versionId,
          structure,
        },
      ];
    });
  }
}
