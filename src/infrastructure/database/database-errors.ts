const SERIALIZATION_FAILURE = '40001';
const DEADLOCK_DETECTED = '40P01';
const PRISMA_WRITE_CONFLICT = 'P2034';

const SERIALIZATION_FAILURE_CODES = [
  SERIALIZATION_FAILURE,
  DEADLOCK_DETECTED,
  PRISMA_WRITE_CONFLICT,
];

const SERIALIZATION_FAILURE_MESSAGES = [
  'could not serialize access',
  'deadlock detected',
  'TransactionWriteConflict',
  'Please retry your transaction',
];

interface DriverErrorCause {
  originalCode?: string;
}

interface DatabaseError {
  code?: string;
  message?: string;
  cause?: DriverErrorCause;
  meta?: { driverAdapterError?: { cause?: DriverErrorCause } };
}

export function isSerializationFailure(error: unknown): boolean {
  const code = (error as DatabaseError | undefined)?.code || '';

  if (SERIALIZATION_FAILURE_CODES.includes(code)) {
    return true;
  }

  const message = (error as DatabaseError | undefined)?.message || '';

  return SERIALIZATION_FAILURE_MESSAGES.some((pattern) =>
    message.includes(pattern),
  );
}

export function sqlStateOf(error: unknown): string | undefined {
  const databaseError = error as DatabaseError | undefined;

  return (
    databaseError?.meta?.driverAdapterError?.cause?.originalCode ??
    databaseError?.cause?.originalCode
  );
}
