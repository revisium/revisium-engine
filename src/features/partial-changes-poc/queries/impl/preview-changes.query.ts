import {
  PreviewChangesInput,
  PreviewChangesResult,
} from 'src/features/partial-changes-poc/partial-changes.types';

export class PreviewChangesQuery {
  constructor(public readonly data: PreviewChangesInput) {}
}

export type PreviewChangesQueryReturnType = PreviewChangesResult;
