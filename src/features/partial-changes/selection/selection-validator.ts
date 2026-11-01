import { BadRequestException } from '@nestjs/common';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';

export class SelectionValidationError extends BadRequestException {}

export interface RequiredAdditionsAcceptance {
  readonly includeRequired?: boolean;
  readonly expected?: string;
}

type Check = (value: unknown, at: string) => void;

interface Field {
  readonly check: Check;
  readonly optional: boolean;
}

type ObjectRecord = Readonly<Record<string, unknown>>;

const HEAD_SIDE = 'head';

export function validateSelection(input: unknown): Selection {
  checkSelection(input, 'selection');

  return input as Selection;
}

export function validateRequiredAdditionsAcceptance({
  includeRequired,
  expected,
}: RequiredAdditionsAcceptance): void {
  if (includeRequired === true && expected === undefined) {
    throw new SelectionValidationError('includeRequired requires expected');
  }
}

const checkNonEmptyString: Check = (value, at) => {
  if (typeof value !== 'string' || value === '') {
    throw invalid(`${at} must be a non-empty string`);
  }
};

const checkBoolean: Check = (value, at) => {
  if (typeof value !== 'boolean') {
    throw invalid(`${at} must be a boolean`);
  }
};

const checkSide: Check = (value, at) => {
  if (value !== HEAD_SIDE) {
    throw invalid(`${at} must be '${HEAD_SIDE}'`);
  }
};

const checkJsonPointer: Check = (value, at) => {
  if (typeof value !== 'string' || !JsonPointer.isValid(value)) {
    throw invalid(`${at} must be a JSON Pointer`);
  }
};

const checkTableObject = objectOf({
  tableId: required(checkNonEmptyString),
  side: optional(checkSide),
});

const checkTableRef: Check = (value, at) => {
  if (typeof value === 'string') {
    checkNonEmptyString(value, at);
  } else {
    checkTableObject(value, at);
  }
};

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
  tables: optional(arrayOf(checkTableRef)),
  tableData: optional(arrayOf(checkNonEmptyString)),
  views: optional(arrayOf(checkNonEmptyString)),
  sharedSchemas: optional(arrayOf(checkNonEmptyString)),
  rows: optional(arrayOf(checkRowRef)),
  renames: optional(arrayOf(checkRowRef)),
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

    for (const name of Object.keys(object)) {
      if (!known.has(name)) {
        throw invalid(`${at}.${name} is not allowed`);
      }
    }

    for (const [name, field] of known) {
      checkField(field, object[name], `${at}.${name}`);
    }
  };
}

function checkField(field: Field, value: unknown, at: string): void {
  if (value === undefined && field.optional) {
    return;
  }

  field.check(value, at);
}

function arrayOf(checkItem: Check): Check {
  return (value, at) => {
    if (!Array.isArray(value)) {
      throw invalid(`${at} must be an array`);
    }

    for (let index = 0; index < value.length; index += 1) {
      checkItem(value[index], `${at}[${index}]`);
    }
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

function invalid(message: string): SelectionValidationError {
  return new SelectionValidationError(message);
}
