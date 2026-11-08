export class FindTableInRevisionQuery {
  constructor(public readonly data: { revisionId: string; tableId: string }) {}
}
