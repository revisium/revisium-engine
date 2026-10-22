import { RowMerger } from 'src/features/partial-changes-poc/assembly/row-merger.service';
import { TargetAssembler } from 'src/features/partial-changes-poc/assembly/target-assembler.service';
import { CommitChangesHandler } from 'src/features/partial-changes-poc/commands/handlers/commit-changes.handler';
import { RevertPartialChangesHandler } from 'src/features/partial-changes-poc/commands/handlers/revert-changes.handler';
import { DependencyClosure } from 'src/features/partial-changes-poc/dependencies/dependency-closure.service';
import { StructureConsistencyChecks } from 'src/features/partial-changes-poc/dependencies/structure-consistency-checks.service';
import { TargetConsistencyChecks } from 'src/features/partial-changes-poc/dependencies/target-consistency-checks.service';
import { ChangePlanner } from 'src/features/partial-changes-poc/planning/change-planner.service';
import { TargetValidator } from 'src/features/partial-changes-poc/planning/target-validator.service';
import { PreviewChangesHandler } from 'src/features/partial-changes-poc/queries/handlers/preview-changes.handler';
import { SnapshotReader } from 'src/features/partial-changes-poc/snapshot/snapshot-reader.service';
import { CommitWriter } from 'src/features/partial-changes-poc/write/commit-writer.service';
import { RevertWriter } from 'src/features/partial-changes-poc/write/revert-writer.service';
import { VersionWriter } from 'src/features/partial-changes-poc/write/version-writer.service';
import { CreateRevisionHandler } from 'src/features/draft/commands/handlers/create-revision.handler';
import { RevertChangesHandler } from 'src/features/draft/commands/handlers/revert-changes.handler';
import { UpdateTableHandler } from 'src/features/draft/commands/handlers/update-table.handler';
import { FileUsageIntegrationService } from 'src/features/file-usage/services/file-usage-integration.service';
import { DiffService } from 'src/features/share/diff.service';
import type { PartialChangesTestKit } from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import type { BenchProbe } from 'src/features/partial-changes-poc/__bench__/support/bench-probe';

export function instrumentOperations(
  kit: PartialChangesTestKit,
  probe: BenchProbe,
): void {
  const get = <T>(type: new (...args: never[]) => T): T => kit.module.get(type);
  const transaction = { transaction: true };
  const hot = { sampleMemory: false };

  probe.instrument(get(PreviewChangesHandler), ['preview'], 'tx', transaction);
  probe.instrument(get(CommitChangesHandler), ['commit'], 'tx', transaction);
  probe.instrument(
    get(RevertPartialChangesHandler),
    ['revert'],
    'tx',
    transaction,
  );
  probe.instrument(
    get(CreateRevisionHandler),
    ['handler'],
    'tx.native',
    transaction,
  );
  probe.instrument(
    get(RevertChangesHandler),
    ['handler'],
    'tx.native',
    transaction,
  );
  probe.instrument(
    get(UpdateTableHandler),
    ['handler'],
    'tx.nativeUpdateTable',
    transaction,
  );

  probe.instrument(get(ChangePlanner), ['plan'], 'plan');
  probe.instrument(
    get(SnapshotReader),
    [
      'read',
      'readTablePairs',
      'readSystemRows',
      'attachStructures',
      'readChangedRows',
    ],
    'reader',
  );
  probe.instrument(get(DependencyClosure), ['close'], 'closure');
  probe.instrument(get(TargetAssembler), ['assemble'], 'assembly');
  probe.instrument(
    get(RowMerger),
    ['merge', 'migrateToDraftStructure', 'mapToHeadStructure'],
    'assembly.rows',
    hot,
  );
  probe.instrument(
    get(StructureConsistencyChecks),
    ['find'],
    'checks.structure',
  );
  probe.instrument(get(TargetConsistencyChecks), ['find'], 'checks.rows');
  probe.instrument(
    get(TargetValidator),
    ['findBlockers', 'ledgerChecks', 'invalidMergedRows'],
    'validation',
  );
  probe.instrument(
    get(CommitWriter),
    [
      'write',
      'headTableVersion',
      'nextDraftTableVersionIds',
      'retirePreviousHead',
      'promoteDraftToHead',
      'createNextDraft',
      'registerFileReferences',
      'recomputeNextDraftHasChanges',
    ],
    'write.commit',
  );
  probe.instrument(
    get(RevertWriter),
    ['write', 'revertTable', 'relinkDraftTables', 'recomputeDraftHasChanges'],
    'write.revert',
  );
  probe.instrument(
    get(VersionWriter),
    [
      'createTableVersion',
      'createRowVersions',
      'linkRows',
      'unlinkRows',
      'lockRowsOfTable',
      'lockTableWithRows',
      'markRowsReadonly',
    ],
    'write.versions',
  );
  probe.instrument(
    get(FileUsageIntegrationService),
    ['registerReferencesForRowVersions'],
    'write.files',
  );
  probe.instrument(get(DiffService), ['hasTableDiffs'], 'write.hasChanges');
}
