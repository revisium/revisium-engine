import type { BackfillSchemaLedgerData } from 'src/features/migration/commands/impl/backfill-schema-ledger.command';
import {
  optionalBooleanOf,
  optionalStringOf,
  stringOf,
} from 'src/features/migration/ledger-request-fields';
import type { BranchRef } from 'src/features/share/branch-revisions/branch-revision-reader';

const DEFAULT_COMMENT = 'Backfill the schema ledger';

export interface BackfillRequest extends BranchRef {
  readonly dryRun: boolean;
  readonly comment: string;
}

export function backfillRequestOf(
  data: BackfillSchemaLedgerData,
): BackfillRequest {
  return {
    projectId: stringOf(data.projectId, 'projectId'),
    branchName: stringOf(data.branchName, 'branchName'),
    dryRun: optionalBooleanOf(data.dryRun, 'dryRun') ?? false,
    comment: optionalStringOf(data.comment, 'comment') ?? DEFAULT_COMMENT,
  };
}
