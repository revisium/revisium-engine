export interface ValidateProjectFileBytesQueryData {
  projectId: string;
}

export class ValidateProjectFileBytesQuery {
  constructor(public readonly data: ValidateProjectFileBytesQueryData) {}
}
