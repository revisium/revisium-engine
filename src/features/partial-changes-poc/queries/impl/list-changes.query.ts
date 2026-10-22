import {
  ListChangesInput,
  ListChangesResult,
} from 'src/features/partial-changes-poc/partial-changes.types';

export class ListChangesQuery {
  constructor(public readonly data: ListChangesInput) {}
}

export type ListChangesQueryReturnType = ListChangesResult;
