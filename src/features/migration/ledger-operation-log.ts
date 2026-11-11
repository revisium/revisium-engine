import type { TrackedOperation } from 'src/infrastructure/database/operation-log';

export type LedgerOperation = 'backfill' | 'repair';

export const LEDGER_OPERATION_FINISHED = 'Schema ledger operation finished';

export function ledgerOperation(
  operation: LedgerOperation,
  input: unknown,
): TrackedOperation {
  return { operation, message: LEDGER_OPERATION_FINISHED, branch: input };
}
