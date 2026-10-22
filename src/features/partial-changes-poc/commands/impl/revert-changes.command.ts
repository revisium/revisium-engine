import {
  ApplyChangesResult,
  RevertChangesInput,
} from 'src/features/partial-changes-poc/partial-changes.types';

export class RevertPartialChangesCommand {
  constructor(public readonly data: RevertChangesInput) {}
}

export type RevertPartialChangesCommandReturnType = ApplyChangesResult;
