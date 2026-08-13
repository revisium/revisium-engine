import type { InputJsonValue } from 'src/engine-prisma-types';

export class ValidateSchemaCommand {
  constructor(
    readonly schema: InputJsonValue,
    readonly tableId?: string,
  ) {}
}
