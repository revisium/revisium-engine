import { Injectable } from '@nestjs/common';
import type { ComparedSnapshot } from 'src/features/partial-changes/catalogue/change-catalogue';
import {
  attributeLedger,
  type LedgerAttribution,
  pendingMigrationsOf,
} from 'src/features/partial-changes/catalogue/ledger-attribution';
import {
  checkHeadSchema,
  type HeadSchemaCheck,
  type LedgerReplayRules,
} from 'src/features/partial-changes/head-schema/head-schema-check';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import type {
  ChangesBranch,
  ChangesSnapshot,
  ComparedTable,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  analyzeTableStructure,
  type TableSide,
} from 'src/features/partial-changes/structure/table-structure';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';

export interface ComparisonScope {
  readonly wholeDraft: boolean;
}

type RevisionSide = 'head' | 'draft';

@Injectable()
export class ComparedSnapshotReader {
  private readonly replayRules: LedgerReplayRules;

  constructor(
    private readonly snapshotReader: ChangesSnapshotReader,
    private readonly schemaRules: NativeSchemaRules,
    schemaStore: JsonSchemaStoreService,
    validator: JsonSchemaValidatorService,
  ) {
    this.replayRules = { refs: schemaStore.refs, validator };
  }

  public async readComparedSnapshot(
    branch: ChangesBranch,
    { wholeDraft }: ComparisonScope,
  ): Promise<ComparedSnapshot> {
    const snapshot = await this.snapshotReader.readSnapshot(branch);
    const ledger = attributeLedger(snapshot);
    const headSchema = checkHeadSchema(
      { snapshot, ledger, wholeDraft },
      this.replayRules,
    );

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
          head: sideOf(snapshot, head, 'head'),
          draft: sideOf(snapshot, draft, 'draft'),
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

function sideOf(
  snapshot: ChangesSnapshot,
  version: TableVersion,
  side: RevisionSide,
): TableSide {
  const tableIdentities = new Map<string, string>();

  for (const pair of snapshot.tables) {
    const sideVersion = pair[side];

    if (sideVersion) {
      tableIdentities.set(sideVersion.id, pair.identity);
    }
  }

  return {
    tableId: version.id,
    schema: version.schema,
    history: version.history,
    tableIdentities,
  };
}
