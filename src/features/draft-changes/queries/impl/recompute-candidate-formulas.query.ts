import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { JsonValue } from 'src/engine-prisma-types';

export interface RecomputeCandidateFormulasQueryData {
  head: DraftRevisionState;
  draft: DraftRevisionState;
}

export interface CandidateFormulaEffect {
  role: 'head' | 'draft';
  tableCreatedId: string;
  rowCreatedId: string;
  path: string;
  beforeExists: boolean;
  before?: JsonValue;
  afterExists: boolean;
  after?: JsonValue;
}

export interface CandidateFormulaError {
  role: 'head' | 'draft';
  tableCreatedId: string;
  rowCreatedId: string;
  path: string;
  expression: string;
  error: string;
  defaultUsed: boolean;
}

export type CandidateFormulaBlocker =
  | {
      code: 'INVALID_FORMULA_SCHEMA';
      role: 'head' | 'draft';
      tableCreatedId: string;
      /** Schema pointer (for example, /properties/total). */
      path: string;
      message: string;
    }
  | {
      code: 'INVALID_RESULT_DATA';
      role: 'head' | 'draft';
      tableCreatedId: string;
      rowCreatedId: string;
      path: string;
      message: string;
    };

export type RecomputeCandidateFormulasResult =
  | {
      status: 'recomputed';
      head: DraftRevisionState;
      draft: DraftRevisionState;
      effects: CandidateFormulaEffect[];
      formulaErrors: CandidateFormulaError[];
    }
  | {
      status: 'blocked';
      blockers: CandidateFormulaBlocker[];
    };

export class RecomputeCandidateFormulasQuery {
  constructor(public readonly data: RecomputeCandidateFormulasQueryData) {}
}
