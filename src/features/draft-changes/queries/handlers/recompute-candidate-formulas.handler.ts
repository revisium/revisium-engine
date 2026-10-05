import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { detachState } from 'src/features/draft-changes/candidates/candidate-state';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { FormulaValidationService } from 'src/features/plugin/formula';
import { recomputeFormulaState } from 'src/features/draft-changes/formulas/recompute-formula-state';
import {
  RecomputeCandidateFormulasQuery,
  type RecomputeCandidateFormulasResult,
} from 'src/features/draft-changes/queries/impl/recompute-candidate-formulas.query';

@QueryHandler(RecomputeCandidateFormulasQuery)
export class RecomputeCandidateFormulasHandler implements IQueryHandler<
  RecomputeCandidateFormulasQuery,
  RecomputeCandidateFormulasResult
> {
  constructor(
    private readonly formulaValidation: FormulaValidationService,
    private readonly validator: JsonSchemaValidatorService,
  ) {}

  async execute(
    query: RecomputeCandidateFormulasQuery,
  ): Promise<RecomputeCandidateFormulasResult> {
    return this.handle(query);
  }

  private async handle(
    query: RecomputeCandidateFormulasQuery,
  ): Promise<RecomputeCandidateFormulasResult> {
    const head = await recomputeFormulaState(
      'head',
      detachState(query.data.head),
      this.formulaValidation,
      this.validator,
    );
    const draft = await recomputeFormulaState(
      'draft',
      detachState(query.data.draft),
      this.formulaValidation,
      this.validator,
    );
    const blockers = [...head.blockers, ...draft.blockers];
    if (blockers.length > 0) {
      return { status: 'blocked', blockers };
    }
    return {
      status: 'recomputed',
      head: head.state,
      draft: draft.state,
      effects: [...head.effects, ...draft.effects],
      formulaErrors: [...head.formulaErrors, ...draft.formulaErrors],
    };
  }
}
