import { BadRequestException } from '@nestjs/common';

// The input of the schema ledger operations, checked field by field: a transport that forwards JSON can send any type.

export function stringOf(value: unknown, at: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${at} must be a string`);
  }

  return value;
}

export function optionalStringOf(
  value: unknown,
  at: string,
): string | undefined {
  if (isAbsent(value)) {
    return undefined;
  }

  return stringOf(value, at);
}

export function optionalBooleanOf(
  value: unknown,
  at: string,
): boolean | undefined {
  if (isAbsent(value)) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new BadRequestException(`${at} must be a boolean`);
  }

  return value;
}

export function optionalStringsOf(
  value: unknown,
  at: string,
): readonly string[] | undefined {
  if (isAbsent(value)) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every(isString)) {
    throw new BadRequestException(`${at} must be an array of strings`);
  }

  return value;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isAbsent(value: unknown): value is null | undefined {
  return value === undefined || value === null;
}
