export interface GetPendingStorageDeletionsQueryData {
  limit?: number;
  afterHash?: string;
}

export class GetPendingStorageDeletionsQuery {
  constructor(public readonly data: GetPendingStorageDeletionsQueryData) {}
}
