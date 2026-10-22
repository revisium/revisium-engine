import { Injectable } from '@nestjs/common';
import type { JsonSchema, Migration } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import { TargetState } from 'src/features/partial-changes-poc/assembly/target.types';
import { ChangeCatalogue } from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import { Blocker } from 'src/features/partial-changes-poc/partial-changes.types';
import {
  LedgerPlan,
  remainingLedger,
} from 'src/features/partial-changes-poc/planning/ledger-plan';
import { ChangesSnapshot } from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import {
  compareIds,
  mismatchedTables,
  replayLedger,
  ReplayResult,
} from 'src/features/partial-changes-poc/structure/ledger';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';

export interface ValidationInput {
  snapshot: ChangesSnapshot;
  catalogue: ChangeCatalogue;
  target: TargetState;
  applied: ReadonlySet<string>;
  ledger: LedgerPlan;
}

interface LedgerCheck {
  role: string;
  source: ReplayResult;
  sourceSchemas: Map<string, JsonSchema>;
  result: Migration[];
  resultSchemas: Map<string, JsonSchema>;
}

@Injectable()
export class TargetValidator {
  constructor(
    private readonly validator: JsonSchemaValidatorService,
    private readonly jsonSchemaStore: JsonSchemaStoreService,
  ) {}

  async findBlockers(input: ValidationInput): Promise<Blocker[]> {
    const unrecorded = this.unrecordedStructures(input);
    const reported = new Set(unrecorded.map((blocker) => blocker.tableId));

    return [
      ...unrecorded,
      ...this.rewrittenLedger(input.catalogue),
      ...this.ledgerChecks(input).filter(
        (blocker) => !reported.has(blocker.tableId),
      ),
      ...(await this.invalidMergedRows(input.target)),
    ];
  }

  private unrecordedStructures(input: ValidationInput): Blocker[] {
    if (input.target.operation !== 'commit') {
      return [];
    }

    return input.target.tables
      .filter(
        (target) =>
          target.table.structureUnit &&
          input.applied.has(target.table.structureUnit) &&
          target.table.pair.structure &&
          !target.table.pair.structure.recorded,
      )
      .map((target) => ({
        code: 'unrecordedStructureChange',
        tableId: target.table.tableId,
        message: `The Draft structure of ${target.table.tableId} is not recorded by its schema history and migrations (for example after an async table migration); committing it would publish a Head that the ledger cannot reproduce`,
      }));
  }

  private rewrittenLedger(catalogue: ChangeCatalogue): Blocker[] {
    return catalogue.ledger.rewritten.map((migrationId) => ({
      code: 'ledgerInconsistent',
      message: `The published migration ${migrationId} is missing or changed in the Draft ledger`,
    }));
  }

  private ledgerChecks(input: ValidationInput): Blocker[] {
    return this.checksOf(input).flatMap((check) => this.newMismatches(check));
  }

  private checksOf(input: ValidationInput): LedgerCheck[] {
    const { catalogue, target, ledger } = input;
    const headSchemas = sideSchemas(input.snapshot, 'head');
    const draftSchemas = sideSchemas(input.snapshot, 'draft');
    const headSource = this.replay(catalogue.ledger.published);
    const draftSource = this.replay([
      ...catalogue.ledger.published,
      ...catalogue.ledger.pending,
    ]);
    const targetMigrations = ledger.target.map((entry) => entry.migration);

    if (target.operation === 'revert') {
      return [
        {
          role: 'reverted Draft',
          source: draftSource,
          sourceSchemas: draftSchemas,
          result: targetMigrations,
          resultSchemas: targetSchemas(target),
        },
      ];
    }

    return [
      {
        role: 'new Head',
        source: headSource,
        sourceSchemas: headSchemas,
        result: targetMigrations,
        resultSchemas: targetSchemas(target),
      },
      {
        role: 'remaining Draft',
        source: draftSource,
        sourceSchemas: draftSchemas,
        result: remainingLedger(ledger),
        resultSchemas: draftSchemas,
      },
    ];
  }

  private newMismatches(check: LedgerCheck): Blocker[] {
    const result = this.replayMigrations(check.result);
    const known = new Set(mismatchedTables(check.source, check.sourceSchemas));
    const blockers: Blocker[] = mismatchedTables(result, check.resultSchemas)
      .filter((tableId) => !known.has(tableId))
      .map((tableId) => ({
        code: 'ledgerInconsistent',
        tableId,
        message: `The migration ledger of the ${check.role} does not replay to the structure of ${tableId}`,
      }));

    if (result.failure && !check.source.failure) {
      blockers.push({
        code: 'ledgerInconsistent',
        tableId: result.failure.tableId,
        message: `The migration ledger of the ${check.role} fails at ${result.failure.migrationId}: ${result.failure.message}`,
      });
    }

    return blockers;
  }

  private replay(entries: { migration: Migration }[]): ReplayResult {
    return this.replayMigrations(entries.map((entry) => entry.migration));
  }

  private replayMigrations(migrations: Migration[]): ReplayResult {
    return replayLedger(
      [...migrations].sort((a, b) => compareIds(a.id, b.id)),
      this.jsonSchemaStore.refs,
    );
  }

  private async invalidMergedRows(state: TargetState): Promise<Blocker[]> {
    const blockers: Blocker[] = [];

    for (const target of state.tables) {
      const schema = target.schema;
      if (!schema || target.table.kind === 'system') {
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

function sideSchemas(
  snapshot: ChangesSnapshot,
  side: 'head' | 'draft',
): Map<string, JsonSchema> {
  return new Map(
    snapshot.tables.flatMap((pair) => {
      const table = pair[side];
      const schema = side === 'head' ? pair.headSchema : pair.draftSchema;
      return table && !table.system && schema ? [[table.id, schema]] : [];
    }),
  );
}

function targetSchemas(state: TargetState): Map<string, JsonSchema> {
  return new Map(
    state.tables.flatMap((target) =>
      target.table.kind !== 'system' &&
      target.outcome !== 'absent' &&
      target.publicId &&
      target.schema
        ? [[target.publicId, target.schema]]
        : [],
    ),
  );
}
