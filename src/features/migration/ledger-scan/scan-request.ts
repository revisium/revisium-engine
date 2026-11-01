import { BadRequestException } from '@nestjs/common';
import type {
  RowDiagnostics,
  ScanSchemaLedgerData,
} from 'src/features/migration/queries/impl/scan-schema-ledger.query';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1_000;
const ROW_DIAGNOSTICS: readonly string[] = ['none', 'headAndDraft', 'all'];

export interface BranchPosition {
  readonly projectId: string;
  readonly branchName: string;
}

type DecodedCursor = Partial<Record<keyof BranchPosition, unknown>> | null;

export interface ScanRequest {
  readonly projectId?: string;
  readonly branchName?: string;
  readonly after?: BranchPosition;
  readonly limit: number;
  readonly rowDiagnostics: RowDiagnostics;
}

export function scanRequestOf(data: ScanSchemaLedgerData): ScanRequest {
  if (data.branchName !== undefined && data.projectId === undefined) {
    throw new BadRequestException('branchName requires projectId');
  }

  return {
    projectId: data.projectId,
    branchName: data.branchName,
    after: positionOf(data.cursor),
    limit: limitOf(data.limit),
    rowDiagnostics: rowDiagnosticsOf(data.rowDiagnostics),
  };
}

export function cursorOf({ projectId, branchName }: BranchPosition): string {
  return Buffer.from(JSON.stringify({ projectId, branchName })).toString(
    'base64url',
  );
}

function positionOf(cursor: string | undefined): BranchPosition | undefined {
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

function limitOf(limit: number = DEFAULT_LIMIT): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new BadRequestException(
      `limit must be an integer from 1 to ${MAX_LIMIT}`,
    );
  }

  return limit;
}

function rowDiagnosticsOf(
  rowDiagnostics: RowDiagnostics = 'headAndDraft',
): RowDiagnostics {
  if (!ROW_DIAGNOSTICS.includes(rowDiagnostics)) {
    throw new BadRequestException(
      `rowDiagnostics must be one of ${ROW_DIAGNOSTICS.join(', ')}`,
    );
  }

  return rowDiagnostics;
}
