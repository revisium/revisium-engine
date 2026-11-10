import { obj, str } from '@revisium/schema-toolkit/mocks';
import type { JsonSchema, Migration } from '@revisium/schema-toolkit/types';
import {
  replayer,
  rules,
  validator,
} from 'src/__tests__/fixtures/ledger-steps';
import type { Row } from 'src/engine-prisma-types';
import type {
  BackfillRevision,
  BackfillState,
} from 'src/features/migration/ledger-backfill/backfill-state-reader';
import {
  type BackfillPlan,
  LedgerBackfillPlanService,
} from 'src/features/migration/ledger-backfill/ledger-backfill-plan.service';
import type { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import {
  LedgerReplayer,
  type LedgerReplayOptions,
} from 'src/features/share/ledger-replay/ledger-replayer';

const catalog = {
  a: obj({ name: str() }),
  b: obj({ title: str() }),
};

const cycle = {
  a: obj({ b: str({ foreignKey: 'b' }), name: str() }),
  b: obj({ a: str({ foreignKey: 'a' }), title: str() }),
};

class ReplayerSkipping extends LedgerReplayer {
  constructor(private readonly skipped: (migration: Migration) => boolean) {
    super(rules);
  }

  public override replay(
    ledger: readonly Migration[],
    options?: LedgerReplayOptions,
  ) {
    return super.replay(
      ledger.filter((migration) => !this.skipped(migration)),
      options,
    );
  }
}

describe('Backfill plan verification by the ledger replay', () => {
  it('refuses the table whose entry fails the migrations schema', () => {
    const planner = new LedgerBackfillPlanService(
      rules,
      replayer,
      validatorFailingEntriesOf('b'),
    );

    expect(planner.plan(stateOf(catalog))).toEqual(
      refusalOf('b', 'its entry fails the migrations schema'),
    );
  });

  it('refuses a table that the replayed ledger does not create', () => {
    const planner = new LedgerBackfillPlanService(
      rules,
      new ReplayerSkipping(({ tableId }) => tableId === 'b'),
      validator,
    );

    expect(planner.plan(stateOf(catalog))).toEqual(
      refusalOf('b', 'the ledger does not create it'),
    );
  });

  it('refuses a table that the replayed ledger gives another schema', () => {
    const planner = new LedgerBackfillPlanService(
      rules,
      new ReplayerSkipping(({ changeType }) => changeType === 'update'),
      validator,
    );

    expect(planner.plan(stateOf(cycle))).toEqual(
      refusalOf('a', 'the ledger replays to a different schema'),
    );
  });

  it('plans the ledger that the replay verifies', () => {
    const planner = new LedgerBackfillPlanService(rules, replayer, validator);

    const plan = planner.plan(stateOf(cycle));

    expect(plan.status).toBe('planned');
  });
});

function validatorFailingEntriesOf(
  tableId: string,
): JsonSchemaValidatorService {
  return {
    validateTableMigrationsSchema: (migration: Migration) => ({
      result: migration.tableId !== tableId,
      errors: null,
    }),
  } as unknown as JsonSchemaValidatorService;
}

function stateOf(schemas: Readonly<Record<string, JsonSchema>>): BackfillState {
  const revision: BackfillRevision = {
    userTables: Object.keys(schemas).map((id) => ({
      versionId: `${id}-version`,
      createdId: `${id}-created`,
      id,
      readonly: true,
      system: false,
    })),
    schemaRows: new Map(
      Object.entries(schemas).map(([id, schema]) => [
        id,
        { id, data: schema, meta: [] } as unknown as Row,
      ]),
    ),
    hasMigrationTable: false,
  };

  return {
    branchId: 'branch',
    headRevisionId: 'head',
    draftRevisionId: 'draft',
    head: revision,
    draft: revision,
  };
}

function refusalOf(tableId: string, reason: string): BackfillPlan {
  return {
    status: 'refused',
    refusal: {
      code: 'schemaNotReproducible',
      tableIds: [tableId],
      message: expect.stringContaining(
        `"${tableId}": ${reason}`,
      ) as unknown as string,
    },
  };
}
