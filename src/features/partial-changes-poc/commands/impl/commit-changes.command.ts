import {
  ApplyChangesResult,
  CommitChangesInput,
} from 'src/features/partial-changes-poc/partial-changes.types';

export class CommitChangesCommand {
  constructor(public readonly data: CommitChangesInput) {}
}

export type CommitChangesCommandReturnType = ApplyChangesResult;
