import { Injectable } from '@nestjs/common';

@Injectable()
export class MigrationRecoveryScope {
  restrictedTo(): readonly string[] | undefined {
    return undefined;
  }
}
