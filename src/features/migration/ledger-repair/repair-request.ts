import type { RepairSchemaLedgerData } from 'src/features/migration/commands/impl/repair-schema-ledger.command';
import {
  optionalBooleanOf,
  optionalStringsOf,
  stringOf,
} from 'src/features/migration/ledger-request-fields';
import type { BranchRef } from 'src/features/share/branch-revisions/branch-revision-reader';

export interface RepairRequest extends BranchRef {
  readonly tableIds?: readonly string[];
  readonly dryRun: boolean;
}

export function repairRequestOf(data: RepairSchemaLedgerData): RepairRequest {
  return {
    projectId: stringOf(data.projectId, 'projectId'),
    branchName: stringOf(data.branchName, 'branchName'),
    tableIds: optionalStringsOf(data.tableIds, 'tableIds'),
    dryRun: optionalBooleanOf(data.dryRun, 'dryRun') ?? false,
  };
}
