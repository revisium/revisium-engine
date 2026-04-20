export interface RegisterFileReferencesForRowVersionsCommandData {
  revisionId: string;
  tableId: string;
  rowVersionIds: readonly string[];
}

export class RegisterFileReferencesForRowVersionsCommand {
  constructor(
    public readonly data: RegisterFileReferencesForRowVersionsCommandData,
  ) {}
}
