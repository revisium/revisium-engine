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

const CONNECTION_LOST_MESSAGES = [
  'Client has encountered a connection error and is not queryable',
  'Connection terminated',
  'Server has closed the connection',
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
  if (SERIALIZATION_FAILURE_CODES.includes(errorCodeOf(error) || '')) {
    return true;
  }

  return messageContainsAny(error, SERIALIZATION_FAILURE_MESSAGES);
}

export function isConnectionLost(error: unknown): boolean {
  return messageContainsAny(error, CONNECTION_LOST_MESSAGES);
}

export function sqlStateOf(error: unknown): string | undefined {
  const databaseError = error as DatabaseError | undefined;

  return (
    databaseError?.meta?.driverAdapterError?.cause?.originalCode ??
    databaseError?.cause?.originalCode
  );
}

function messageContainsAny(error: unknown, patterns: string[]): boolean {
  const message = (error as DatabaseError | undefined)?.message || '';

  return patterns.some((pattern) => message.includes(pattern));
}

function errorCodeOf(error: unknown): string | undefined {
  return (error as DatabaseError | undefined)?.code;
}
