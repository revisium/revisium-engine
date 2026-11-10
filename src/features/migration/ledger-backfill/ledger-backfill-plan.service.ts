import { Injectable } from '@nestjs/common';
import type { BackfillRefusal } from 'src/features/migration/commands/impl/backfill-schema-ledger.command';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { LedgerReplayer } from 'src/features/share/ledger-replay/ledger-replayer';
import { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';
import {
  checkTableSlot,
  type SlotCheck,
} from 'src/features/share/ledger-replay/slot-check';
import { orderedLedgerOf } from './backfill-order';
import {
  type BackfillMigration,
  backfillMigrationsOf,
} from './backfill-migrations';
import {
  draftStructureChanged,
  unreproducibleSchemas,
  unsplittableCycles,
} from './backfill-refusals';
import type { BackfillState } from './backfill-state-reader';
import { draftStructureChangesOf } from './draft-structure-changes';
import {
  type HeadTableSchema,
  headTableSchemasOf,
  type TableFailure,
} from './head-table-schemas';

export type BackfillPlan =
  | { readonly status: 'notNeeded' }
  | { readonly status: 'refused'; readonly refusal: BackfillRefusal }
  | {
      readonly status: 'planned';
      readonly migrations: readonly BackfillMigration[];
    };

@Injectable()
export class LedgerBackfillPlanService {
  constructor(
    private readonly rules: NativeSchemaRules,
    private readonly replayer: LedgerReplayer,
    private readonly validator: JsonSchemaValidatorService,
  ) {}

  public plan(state: BackfillState): BackfillPlan {
    if (state.head.hasMigrationTable) {
      return { status: 'notNeeded' };
    }

    const draftChanges = draftStructureChangesOf(state);

    if (draftChanges.length > 0) {
      return refusedBy(draftStructureChanged(draftChanges));
    }

    const { tables, failures } = headTableSchemasOf(state.head, this.rules);

    if (failures.length > 0) {
      return refusedBy(unreproducibleSchemas(failures));
    }

    return this.planLedger(tables);
  }

  private planLedger(tables: readonly HeadTableSchema[]): BackfillPlan {
    const ordered = orderedLedgerOf(tables, this.rules);

    if ('cycleTableIds' in ordered) {
      return refusedBy(unsplittableCycles(ordered.cycleTableIds));
    }

    const migrations = backfillMigrationsOf(ordered);
    const failures = this.unreproducedTables(tables, migrations);

    if (failures.length > 0) {
      return refusedBy(unreproducibleSchemas(failures));
    }

    return { status: 'planned', migrations };
  }

  private unreproducedTables(
    tables: readonly HeadTableSchema[],
    migrations: readonly BackfillMigration[],
  ): TableFailure[] {
    const invalidEntryTableIds = new Set(
      migrations
        .filter(
          (migration) =>
            !this.validator.validateTableMigrationsSchema(migration).result,
        )
        .map(({ tableId }) => tableId),
    );
    const replay = this.replayer.replay(migrations);

    return tables.flatMap(({ tableId, schema }): TableFailure[] => {
      if (invalidEntryTableIds.has(tableId)) {
        return [{ tableId, error: 'its entry fails the migrations schema' }];
      }

      const check = checkTableSlot(replay, tableId, schema);

      if (check.kind === 'reproduces') {
        return [];
      }

      return [{ tableId, error: replayErrorOf(check) }];
    });
  }
}

function refusedBy(refusal: BackfillRefusal): BackfillPlan {
  return { status: 'refused', refusal };
}

function replayErrorOf(check: SlotCheck): string {
  if (check.kind === 'unreplayable') {
    return check.failure.error;
  }

  if (check.kind === 'unledgered') {
    return 'the ledger does not create it';
  }

  return 'the ledger replays to a different schema';
}
