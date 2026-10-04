import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';

export interface DraftRevisionCleanupDetachedStateCommandData {
  states: DraftRevisionState[];
}

export interface DraftRevisionCleanupDetachedStateCommandResult {
  affectedBlobIds: string[];
}

export class DraftRevisionCleanupDetachedStateCommand {
  constructor(
    public readonly data: DraftRevisionCleanupDetachedStateCommandData,
  ) {}
}
