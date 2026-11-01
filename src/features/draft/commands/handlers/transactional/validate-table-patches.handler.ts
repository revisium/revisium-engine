import { BadRequestException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { JsonPatch } from '@revisium/schema-toolkit/types';
import { ValidateTablePatchesCommand } from 'src/features/draft/commands/impl/transactional/validate-table-patches.command';
import { DraftTransactionalCommands } from 'src/features/draft/draft.transactional.commands';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';

@CommandHandler(ValidateTablePatchesCommand)
export class ValidateTablePatchesHandler implements ICommandHandler<ValidateTablePatchesCommand> {
  constructor(
    private readonly draftTransactionalCommands: DraftTransactionalCommands,
    private readonly jsonSchemaValidator: JsonSchemaValidatorService,
  ) {}

  async execute({ tableId, patches }: ValidateTablePatchesCommand) {
    if (patches.length < 1) {
      throw new BadRequestException('Invalid length of patches');
    }

    await this.validatePatchSchema(tableId, patches);
  }

  private async validatePatchSchema(tableId: string, patches: JsonPatch[]) {
    const { result, errors } =
      this.jsonSchemaValidator.validateJsonPatchSchema(patches);

    if (!result) {
      const details = (errors ?? [])
        .map((e) => `${e.instancePath} ${e.message ?? '<no message>'}`)
        .join('; ');
      throw new BadRequestException(`patches is not valid: ${details}`, {
        cause: errors,
      });
    }

    for (const patch of patches) {
      if (patch.op === 'replace' || patch.op === 'add') {
        await this.draftTransactionalCommands.validateSchema(
          patch.value,
          tableId,
        );
      }
    }
  }
}
