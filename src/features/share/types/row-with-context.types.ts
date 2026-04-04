import type { Row } from 'src/engine-prisma-types';
import { FormulaFieldError } from 'src/features/plugin/types';

export type RowWithContext = Row & {
  context: { revisionId: string; tableId: string };
  formulaErrors?: FormulaFieldError[];
};
