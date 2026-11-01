import { BadRequestException } from '@nestjs/common';

export class LedgerUnavailableException extends BadRequestException {
  constructor() {
    super(
      'LEDGER_UNAVAILABLE: the Draft has no migration table to record the imported update',
    );
  }
}
