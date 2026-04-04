import { GetRevisionQueryReturnType } from 'src/features/revision/queries/impl';

export class ApiCreateRevisionCommand {
  constructor(
    public data: {
      projectId: string;
      branchName: string;
      comment?: string;
    },
  ) {}
}

export type ApiCreateRevisionCommandData = ApiCreateRevisionCommand['data'];

export type ApiCreateRevisionCommandReturnType = GetRevisionQueryReturnType;
