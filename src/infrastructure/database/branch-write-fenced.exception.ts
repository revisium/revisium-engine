import { HttpException, HttpStatus } from '@nestjs/common';

export class BranchWriteFencedException extends HttpException {
  constructor(waitedMs: number) {
    super(
      {
        code: 'BRANCH_WRITE_FENCED',
        statusCode: HttpStatus.LOCKED,
        message: `Branch is closed for writes by an operation in progress; the write waited ${waitedMs} ms. Retry it later.`,
      },
      HttpStatus.LOCKED,
    );
  }
}
