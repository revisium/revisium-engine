import { BadRequestException } from '@nestjs/common';

function formatContextString(context?: ValidationErrorContext): string {
  if (!context) {
    return '';
  }
  const rowPart = context.rowId ? ` for row "${context.rowId}"` : '';
  return ` in table "${context.tableId}"${rowPart}`;
}

function formatContextStringParens(context?: ValidationErrorContext): string {
  if (!context) {
    return '';
  }
  const rowPart = context.rowId ? `, row "${context.rowId}"` : '';
  return ` (in table "${context.tableId}"${rowPart})`;
}

const MAX_DISPLAY_ROWS = 3;

function formatMissingRowsString(missingRowIds: string[]): string {
  const rowCount = missingRowIds.length;

  if (rowCount === 1) {
    return `"${missingRowIds[0]}"`;
  }

  const quotedRows = missingRowIds
    .slice(0, MAX_DISPLAY_ROWS)
    .map((r) => `"${r}"`)
    .join(', ');
  const ellipsis = rowCount > MAX_DISPLAY_ROWS ? '...' : '';

  return `${rowCount} rows (${quotedRows}${ellipsis})`;
}

function formatDataValidationMessage(
  details: ValidationErrorDetail[],
  context?: ValidationErrorContext,
): string {
  const contextStr = formatContextString(context);

  if (details.length === 0) {
    return `Data validation failed${contextStr}`;
  }

  if (details.length === 1) {
    const first = details[0] as ValidationErrorDetail;
    return `Validation error at "${first.path}"${contextStr}: ${first.message}`;
  }

  return `Validation failed with ${details.length} errors${contextStr}`;
}

function formatForeignKeyTableNotFoundMessage(
  referencedTableId: string,
  context?: ValidationErrorContext,
  path?: string,
): string {
  const contextStr = formatContextStringParens(context);
  const pathStr = path ? ` at path "${path}"` : '';

  return `Referenced table "${referencedTableId}"${pathStr} does not exist in the revision${contextStr}`;
}

function formatForeignKeyRowsNotFoundMessage(
  details: ForeignKeyErrorDetail[],
  context?: ValidationErrorContext,
): string {
  const contextStr = formatContextString(context);

  if (details.length === 0) {
    return `Foreign key validation failed${contextStr}`;
  }

  if (details.length === 1) {
    const detail = details[0] as ForeignKeyErrorDetail;
    const rowsStr = formatMissingRowsString(detail.missingRowIds);
    return `Foreign key error at "${detail.path}"${contextStr}: ${rowsStr} not found in table "${detail.tableId}"`;
  }

  return `Foreign key validation failed: ${details.length} references not found${contextStr}`;
}

function formatFormulaValidationMessage(details: FormulaErrorDetail[]): string {
  if (details.length === 0) {
    return 'Formula validation failed';
  }

  if (details.length === 1) {
    const first = details[0] as FormulaErrorDetail;
    return `Formula validation error in field "${first.field}": ${first.error}`;
  }

  return `Formula validation failed with ${details.length} errors`;
}

export interface ValidationErrorDetail {
  path: string;
  message: string;
}

export interface ForeignKeyErrorDetail {
  path: string;
  tableId: string;
  missingRowIds: string[];
}

export interface FormulaErrorDetail {
  field: string;
  error: string;
}

export interface ValidationErrorContext {
  tableId: string;
  rowId?: string;
}

export interface ValidationErrorResponse {
  code: string;
  message: string;
  context?: ValidationErrorContext;
  details: ValidationErrorDetail[];
}

export interface ForeignKeyErrorResponse {
  code: string;
  message: string;
  context?: ValidationErrorContext;
  details: ForeignKeyErrorDetail[];
}

export interface FormulaErrorResponse {
  code: string;
  message: string;
  details: FormulaErrorDetail[];
}

export const ValidationErrorCode = {
  INVALID_DATA: 'INVALID_DATA',
  INVALID_FORMULA: 'INVALID_FORMULA',
  FOREIGN_KEY_NOT_FOUND: 'FOREIGN_KEY_NOT_FOUND',
  TABLE_NOT_FOUND: 'TABLE_NOT_FOUND',
} as const;

export class DataValidationException extends BadRequestException {
  constructor(
    details: ValidationErrorDetail[],
    context?: ValidationErrorContext,
  ) {
    const response: ValidationErrorResponse = {
      code: ValidationErrorCode.INVALID_DATA,
      message: formatDataValidationMessage(details, context),
      context,
      details,
    };

    super(response);
  }

  getDetails(): ValidationErrorDetail[] {
    const response = this.getResponse() as ValidationErrorResponse;
    return response.details;
  }

  getContext(): ValidationErrorContext | undefined {
    const response = this.getResponse() as ValidationErrorResponse;
    return response.context;
  }
}

export class ForeignKeyTableNotFoundException extends BadRequestException {
  constructor(
    referencedTableId: string,
    context?: ValidationErrorContext,
    path?: string,
  ) {
    super({
      code: ValidationErrorCode.TABLE_NOT_FOUND,
      message: formatForeignKeyTableNotFoundMessage(
        referencedTableId,
        context,
        path,
      ),
      referencedTableId,
      context,
      path,
    });
  }
}

export class ForeignKeyRowsNotFoundException extends BadRequestException {
  constructor(
    details: ForeignKeyErrorDetail[],
    context?: ValidationErrorContext,
  ) {
    const response: ForeignKeyErrorResponse = {
      code: ValidationErrorCode.FOREIGN_KEY_NOT_FOUND,
      message: formatForeignKeyRowsNotFoundMessage(details, context),
      context,
      details,
    };

    super(response);
  }

  getDetails(): ForeignKeyErrorDetail[] {
    const response = this.getResponse() as ForeignKeyErrorResponse;
    return response.details;
  }

  getContext(): ValidationErrorContext | undefined {
    const response = this.getResponse() as ForeignKeyErrorResponse;
    return response.context;
  }
}

export class FormulaValidationException extends BadRequestException {
  constructor(details: FormulaErrorDetail[]) {
    const response: FormulaErrorResponse = {
      code: ValidationErrorCode.INVALID_FORMULA,
      message: formatFormulaValidationMessage(details),
      details,
    };

    super(response);
  }

  getDetails(): FormulaErrorDetail[] {
    const response = this.getResponse() as FormulaErrorResponse;
    return response.details;
  }
}
