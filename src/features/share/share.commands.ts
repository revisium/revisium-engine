import { Injectable } from '@nestjs/common';

@Injectable()
export class ShareCommands {
  public async notifyEndpoints(_data: { revisionId: string }): Promise<void> {
    // no-op in engine — endpoint notifications are not supported
  }
}
