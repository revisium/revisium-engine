import { BadRequestException } from '@nestjs/common';
import type { BackfillSchemaLedgerData } from 'src/features/migration/commands/impl/backfill-schema-ledger.command';
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

function stringOf(value: unknown, at: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${at} must be a string`);
  }

  return value;
}

function optionalStringOf(value: unknown, at: string): string | undefined {
  if (isAbsent(value)) {
    return undefined;
  }

  return stringOf(value, at);
}

function optionalBooleanOf(value: unknown, at: string): boolean | undefined {
  if (isAbsent(value)) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new BadRequestException(`${at} must be a boolean`);
  }

  return value;
}

function isAbsent(value: unknown): value is null | undefined {
  return value === undefined || value === null;
}
