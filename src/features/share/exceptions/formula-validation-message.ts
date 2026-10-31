export interface FormulaErrorDetail {
  field: string;
  error: string;
}

export function formatFormulaValidationMessage(
  details: FormulaErrorDetail[],
): string {
  if (details.length === 0) {
    return 'Formula validation failed';
  }

  if (details.length === 1) {
    const first = details[0] as FormulaErrorDetail;
    return `Formula validation error in field "${first.field}": ${first.error}`;
  }

  return `Formula validation failed with ${details.length} errors`;
}
