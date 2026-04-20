export interface ConfirmStorageDeletedCommandData {
  hashes: readonly string[];
}

export class ConfirmStorageDeletedCommand {
  constructor(public readonly data: ConfirmStorageDeletedCommandData) {}
}
