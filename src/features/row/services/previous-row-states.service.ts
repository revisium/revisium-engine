import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  GetPreviousRowStatesQueryData,
  GetPreviousRowStatesQueryReturnType,
} from 'src/features/row/queries/impl/get-previous-row-states.query';
import { PreviousRowStatesReader } from 'src/features/row/services/previous-row-states.reader';
import {
  parsePreviousRowStatesRequest,
  throwPreviousRowStatesCursorScopeError,
} from 'src/features/row/services/previous-row-states.request';
import { interpretPreviousRowStatesResult } from 'src/features/row/services/previous-row-states.result';

@Injectable()
export class PreviousRowStatesService {
  constructor(private readonly reader: PreviousRowStatesReader) {}

  async get(
    data: GetPreviousRowStatesQueryData,
  ): Promise<GetPreviousRowStatesQueryReturnType> {
    const request = parsePreviousRowStatesRequest(data);
    const selectedRevision = await this.reader.findSelectedRevision(
      request.revisionId,
    );

    if (!selectedRevision) {
      if (request.after) {
        throwPreviousRowStatesCursorScopeError();
      }
      return null;
    }

    if (selectedRevision.isDraft) {
      throw new BadRequestException(
        'Previous row states require a committed revision',
      );
    }

    const rows = await this.reader.read({
      revisionId: request.revisionId,
      tableId: request.tableId,
      rowId: request.rowId,
      first: request.first,
      afterDepth: request.after?.depth ?? null,
      afterRevisionId: request.after?.eventRevisionId ?? null,
    });
    return interpretPreviousRowStatesResult({ request, rows });
  }
}
