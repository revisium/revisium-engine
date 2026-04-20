export interface RestoreProjectFileBytesCommandData {
  projectId: string;
}

export class RestoreProjectFileBytesCommand {
  constructor(public readonly data: RestoreProjectFileBytesCommandData) {}
}
