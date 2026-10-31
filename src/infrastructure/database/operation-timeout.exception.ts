import { HttpException, HttpStatus } from '@nestjs/common';

export class OperationTimeoutException extends HttpException {
  constructor(timeoutMs: number, cause?: unknown) {
    super(
      {
        code: 'OPERATION_TIMEOUT',
        statusCode: HttpStatus.REQUEST_TIMEOUT,
        message: `The operation did not finish within ${timeoutMs} ms and was rolled back. Retry it later.`,
      },
      HttpStatus.REQUEST_TIMEOUT,
      { cause },
    );
  }
}
