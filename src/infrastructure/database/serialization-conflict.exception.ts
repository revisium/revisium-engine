import { HttpException, HttpStatus } from '@nestjs/common';
import { isSerializationFailure } from 'src/infrastructure/database/database-errors';

export class SerializationConflictException extends HttpException {
  constructor(cause: unknown) {
    super(
      {
        code: 'SERIALIZATION_CONFLICT',
        statusCode: HttpStatus.CONFLICT,
        message:
          'The operation conflicted with concurrent writes on every attempt and was rolled back. Retry it later.',
      },
      HttpStatus.CONFLICT,
      { cause },
    );
  }
}

// For an operation whose attempts are spent: its last serialization failure becomes the engine's own retryable error.
export async function failingWithSerializationConflict<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isSerializationFailure(error)) {
      throw new SerializationConflictException(error);
    }

    throw error;
  }
}
