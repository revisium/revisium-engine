import { Injectable } from '@nestjs/common';
import objectHash from 'object-hash';
import { TargetState } from 'src/features/partial-changes-poc/assembly/target.types';
import { Blocker } from 'src/features/partial-changes-poc/partial-changes.types';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';

@Injectable()
export class TargetValidator {
  constructor(private readonly validator: JsonSchemaValidatorService) {}

  async findBlockers(state: TargetState): Promise<Blocker[]> {
    return [
      ...this.unsupportedSystemTables(state),
      ...(await this.invalidMergedRows(state)),
    ];
  }

  private unsupportedSystemTables(state: TargetState): Blocker[] {
    return state.tables
      .filter((target) => target.outcome === 'mixedSystemUnsupported')
      .map((target) => ({
        code: 'structureNotSupportedInM1',
        tableId: target.table.tableId,
        message: `Selecting only part of the structure, views or shared-schema changes (${target.table.tableId}) needs M2; select all of them or none`,
      }));
  }

  private async invalidMergedRows(state: TargetState): Promise<Blocker[]> {
    const blockers: Blocker[] = [];

    for (const target of state.tables) {
      const schema = target.table.schema;
      if (!schema) {
        continue;
      }
      const schemaHash = objectHash(schema);

      for (const { outcome } of target.rows) {
        if (outcome.kind !== 'merged') {
          continue;
        }
        const { result, errors } = await this.validator.validate(
          outcome.data,
          schema,
          schemaHash,
        );
        if (!result) {
          blockers.push({
            code: 'invalidRow',
            tableId: target.table.tableId,
            rowId: outcome.id,
            message: `The assembled row is invalid: ${JSON.stringify(errors)}`,
          });
        }
      }
    }

    return blockers;
  }
}
