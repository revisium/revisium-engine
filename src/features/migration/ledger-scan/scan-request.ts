import { BadRequestException } from '@nestjs/common';
import {
  ROW_DIAGNOSTICS,
  type RowDiagnostics,
  type ScanSchemaLedgerData,
} from 'src/features/migration/queries/impl/scan-schema-ledger.query';
import type { BranchRef } from 'src/features/share/branch-revisions/branch-revision-reader';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1_000;
const DEFAULT_ROW_DIAGNOSTICS: RowDiagnostics = 'headAndDraft';

type DecodedCursor = Partial<Record<keyof BranchRef, unknown>> | null;

export interface ScanRequest {
  readonly projectId?: string;
  readonly branchName?: string;
  readonly after?: BranchRef;
  readonly limit: number;
  readonly rowDiagnostics: RowDiagnostics;
}

export function scanRequestOf(data: ScanSchemaLedgerData): ScanRequest {
  const projectId = data.projectId ?? undefined;
  const branchName = data.branchName ?? undefined;

  if (branchName !== undefined && projectId === undefined) {
    throw new BadRequestException('branchName requires projectId');
  }

  return {
    projectId,
    branchName,
    after: positionOf(data.cursor ?? undefined),
    limit: limitOf(data.limit ?? DEFAULT_LIMIT),
    rowDiagnostics: rowDiagnosticsOf(
      data.rowDiagnostics ?? DEFAULT_ROW_DIAGNOSTICS,
    ),
  };
}

export function cursorOf({ projectId, branchName }: BranchRef): string {
  return Buffer.from(JSON.stringify({ projectId, branchName })).toString(
    'base64url',
  );
}

function positionOf(cursor: string | undefined): BranchRef | undefined {
  if (cursor === undefined) {
    return undefined;
  }

  const position = decodedCursorOf(cursor);

  if (
    typeof position?.projectId !== 'string' ||
    typeof position.branchName !== 'string'
  ) {
    throw new BadRequestException('Malformed cursor');
  }

  return { projectId: position.projectId, branchName: position.branchName };
}

function decodedCursorOf(cursor: string): DecodedCursor | undefined {
  try {
    return JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as DecodedCursor;
  } catch {
    return undefined;
  }
}

function limitOf(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new BadRequestException(
      `limit must be an integer from 1 to ${MAX_LIMIT}`,
    );
  }

  return limit;
}

function rowDiagnosticsOf(rowDiagnostics: RowDiagnostics): RowDiagnostics {
  if (!ROW_DIAGNOSTICS.includes(rowDiagnostics)) {
    throw new BadRequestException(
      `rowDiagnostics must be one of ${ROW_DIAGNOSTICS.join(', ')}`,
    );
  }

  return rowDiagnostics;
}
