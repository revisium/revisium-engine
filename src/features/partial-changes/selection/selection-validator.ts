import { BadRequestException } from '@nestjs/common';
import { SELECTOR_SIDES } from 'src/features/partial-changes/catalogue/unit';
import {
  CHANGE_OPERATIONS,
  type ChangeOperation,
} from 'src/features/partial-changes/plan/change-operation';
import {
  type ExpectedFingerprint,
  readExpected,
} from 'src/features/partial-changes/plan/fingerprint';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';

export class SelectionValidationError extends BadRequestException {}

export interface RequiredAdditionsAcceptance {
  readonly includeRequired: boolean;
  readonly expected?: ExpectedFingerprint;
}

interface RequiredAdditionsAcceptanceInput {
  readonly includeRequired?: unknown;
  readonly expected?: unknown;
}

type Check = (value: unknown, at: string) => unknown;

interface Field {
  readonly check: Check;
  readonly optional: boolean;
}

type ObjectRecord = Readonly<Record<string, unknown>>;

const OPERATIONS: ReadonlySet<unknown> = new Set(CHANGE_OPERATIONS);

const SIDES: ReadonlySet<unknown> = new Set(SELECTOR_SIDES);

export function validateSelection(input: unknown): Selection {
  return checkSelection(input, 'selection') as Selection;
}

export function validateOperation(input: unknown): ChangeOperation {
  if (!OPERATIONS.has(input)) {
    throw invalid(`operation must be ${oneOf(CHANGE_OPERATIONS)}`);
  }

  return input as ChangeOperation;
}

export function validateIncludeRequired(input: unknown): boolean {
  return optionalInputOf(input, 'includeRequired', checkBoolean) === true;
}

export function validateRequiredAdditionsAcceptance({
  includeRequired,
  expected,
}: RequiredAdditionsAcceptanceInput): RequiredAdditionsAcceptance {
  const acceptance = {
    includeRequired: validateIncludeRequired(includeRequired),
    expected: validateExpected(expected),
  };

  if (acceptance.includeRequired && acceptance.expected === undefined) {
    throw invalid('includeRequired requires expected');
  }

  return acceptance;
}

export function validateComment(input: unknown): string | undefined {
  return optionalInputOf(input, 'comment', checkString) as string | undefined;
}

function validateExpected(input: unknown): ExpectedFingerprint | undefined {
  return optionalInputOf(input, 'expected', checkFingerprint) as
    | ExpectedFingerprint
    | undefined;
}

const checkString: Check = (value, at) => {
  if (typeof value !== 'string') {
    throw invalid(`${at} must be a string`);
  }

  return value;
};

const checkNonEmptyString: Check = (value, at) => {
  if (typeof value !== 'string' || value === '') {
    throw invalid(`${at} must be a non-empty string`);
  }

  return value;
};

const checkFingerprint: Check = (value, at) => {
  const expected = readExpected(checkNonEmptyString(value, at) as string);

  if (expected === undefined) {
    throw invalid(`${at} must be a fingerprint`);
  }

  return expected;
};

const checkBoolean: Check = (value, at) => {
  if (typeof value !== 'boolean') {
    throw invalid(`${at} must be a boolean`);
  }

  return value;
};

const checkSide: Check = (value, at) => {
  if (!SIDES.has(value)) {
    throw invalid(`${at} must be ${oneOf(SELECTOR_SIDES)}`);
  }

  return value;
};

const checkJsonPointer: Check = (value, at) => {
  if (typeof value !== 'string' || !JsonPointer.isValid(value)) {
    throw invalid(`${at} must be a JSON Pointer`);
  }

  return value;
};

const checkTableRef = objectOf({
  tableId: required(checkNonEmptyString),
  side: optional(checkSide),
});

const checkRowRef = objectOf({
  tableId: required(checkNonEmptyString),
  rowId: required(checkNonEmptyString),
  side: optional(checkSide),
});

const checkFieldRef = objectOf({
  tableId: required(checkNonEmptyString),
  rowId: required(checkNonEmptyString),
  path: required(checkJsonPointer),
});

const ITEM_FIELDS = {
  structures: optional(arrayOf(checkTableRef)),
  tableData: optional(arrayOf(checkNonEmptyString)),
  views: optional(arrayOf(checkNonEmptyString)),
  sharedSchemas: optional(arrayOf(checkNonEmptyString)),
  rows: optional(arrayOf(checkRowRef)),
  rowRenames: optional(arrayOf(checkRowRef)),
  rowColumns: optional(arrayOf(checkRowRef)),
  fields: optional(arrayOf(checkFieldRef)),
};

const checkSelection = objectOf({
  ...ITEM_FIELDS,
  all: optional(checkBoolean),
  exclude: optional(objectOf(ITEM_FIELDS)),
});

function objectOf(fields: Readonly<Record<string, Field>>): Check {
  const known = new Map(Object.entries(fields));

  return (value, at) => {
    const object = objectAt(value, at);

    rejectUnknownFields(object, known, at);

    return checkedFieldsOf(object, known, at);
  };
}

function rejectUnknownFields(
  object: ObjectRecord,
  known: ReadonlyMap<string, Field>,
  at: string,
): void {
  for (const name of Object.keys(object)) {
    if (!known.has(name)) {
      throw invalid(`${at}.${name} is not allowed`);
    }
  }
}

function checkedFieldsOf(
  object: ObjectRecord,
  known: ReadonlyMap<string, Field>,
  at: string,
): ObjectRecord {
  const checked: Record<string, unknown> = {};

  for (const [name, field] of known) {
    const value = object[name];

    if (!isOmitted(field, value)) {
      checked[name] = field.check(value, `${at}.${name}`);
    }
  }

  return checked;
}

function isOmitted(field: Field, value: unknown): boolean {
  return field.optional && isAbsent(value);
}

function optionalInputOf(value: unknown, at: string, check: Check): unknown {
  if (isAbsent(value)) {
    return undefined;
  }

  return check(value, at);
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

function arrayOf(checkItem: Check): Check {
  return (value, at) => {
    if (!Array.isArray(value)) {
      throw invalid(`${at} must be an array`);
    }

    const checked: unknown[] = [];

    for (let index = 0; index < value.length; index += 1) {
      checked.push(checkItem(value[index], `${at}[${index}]`));
    }

    return checked;
  };
}

function objectAt(value: unknown, at: string): ObjectRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${at} must be an object`);
  }

  return value as ObjectRecord;
}

function required(check: Check): Field {
  return { check, optional: false };
}

function optional(check: Check): Field {
  return { check, optional: true };
}

function oneOf(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(' or ');
}

function invalid(message: string): SelectionValidationError {
  return new SelectionValidationError(message);
}
