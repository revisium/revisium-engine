import { join } from 'path';
import type { Migration } from '@revisium/schema-toolkit/types';
import { namesExportedFrom } from 'src/__tests__/utils/package-exports';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import * as engine from 'src/index';

const PACKAGE_ENTRY = join(__dirname, '..', '..', '..', 'index.ts');
const MIGRATION_MODULES = './features/migration/';
const LEDGER_REPLAY_MODULE = './features/share/ledger-replay/';

// The input and result types of scanSchemaLedger, repairSchemaLedger and backfillSchemaLedger, and their parts.
const LEDGER_OPERATION_TYPES = [
  'BackfillChangeType',
  'BackfillCommitted',
  'BackfillEntry',
  'BackfillNotNeeded',
  'BackfillPlanned',
  'BackfillRefusal',
  'BackfillRefusalCode',
  'BackfillRefused',
  'BackfillSchemaLedgerData',
  'BackfillStatus',
  'BrokenLineage',
  'DamageShape',
  'DamagedTableDetail',
  'DamagedTableRepair',
  'FindingCode',
  'FindingRole',
  'InvalidRows',
  'MismatchedRowHash',
  'RenumberedMigration',
  'RepairOutcome',
  'RepairSchemaLedgerData',
  'RowDiagnostics',
  'RowHashReason',
  'RowSchemaHashMismatchDetail',
  'ScanSchemaLedgerData',
  'SchemaLedgerBackfill',
  'SchemaLedgerFinding',
  'SchemaLedgerRepair',
  'SchemaLedgerScan',
  'SchemaLedgerScanStats',
  'TableRepair',
  'TableRepairOutcome',
  'UnledgeredDetail',
  'UnledgeredReason',
];

// The values of each code union of the three operations.
const CODE_LISTS: Readonly<Record<string, readonly string[]>> = {
  BACKFILL_CHANGE_TYPES: ['init', 'update'],
  BACKFILL_REFUSAL_CODES: ['draftStructureChanged', 'schemaNotReproducible'],
  BACKFILL_STATUSES: ['backfilled', 'notNeeded', 'planned', 'refused'],
  DAMAGED_TABLE_REPAIRS: [
    'alreadyRepaired',
    'blockedByDependency',
    'deferred',
    'draftOnlyDamage',
    'ledgerDoesNotReplay',
    'ledgerInconsistent',
    'needsDraftStructureRevert',
    'notDamaged',
    'patchNotReproducible',
    'repaired',
    'rowsNeedMigration',
    'unledgered',
  ],
  DAMAGE_SHAPES: ['published', 'unknown', 'unpublished'],
  FINDING_CODES: [
    'damagedHistory',
    'damagedTable',
    'draftOnlyDamage',
    'rowSchemaHashMismatch',
    'unledgeredTable',
    'unreplayableLedger',
  ],
  FINDING_ROLES: ['draft', 'head', 'history'],
  MIGRATION_CHANGE_TYPES: ['init', 'remove', 'rename', 'update'],
  REPAIR_OUTCOMES: [
    'alreadyRepaired',
    'blockedByDependency',
    'draftOnlyDamage',
    'ledgerDoesNotReplay',
    'ledgerInconsistent',
    'needsDraftStructureRevert',
    'notDamaged',
    'patchNotReproducible',
    'repaired',
    'rowsNeedMigration',
    'unledgered',
  ],
  ROW_DIAGNOSTICS: ['all', 'headAndDraft', 'none'],
  ROW_HASH_REASONS: [
    'renamedReference',
    'unknownHash',
    'unmigratedByAsync',
    'unmigratedRows',
  ],
  TABLE_REPAIR_OUTCOMES: [
    'alreadyRepaired',
    'blockedByDependency',
    'draftOnlyDamage',
    'ledgerDoesNotReplay',
    'ledgerInconsistent',
    'needsDraftStructureRevert',
    'notDamaged',
    'patchNotReproducible',
    'repaired',
    'rowsNeedMigration',
    'stale',
    'unledgered',
  ],
  UNLEDGERED_REASONS: ['brokenLineage', 'noLineage', 'noMigrationTable'],
};

// True only when A and B are the same type; mutual assignability would also accept `any`.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type ListMember<List extends readonly unknown[]> = List[number];

type ResultOf<Operation extends (...args: never[]) => Promise<unknown>> =
  Awaited<ReturnType<Operation>>;

type FindingOf<Code extends engine.FindingCode> = Extract<
  engine.SchemaLedgerFinding,
  { readonly code: Code }
>;

type BackfillOf<Status extends engine.BackfillStatus> = Extract<
  engine.SchemaLedgerBackfill,
  { readonly status: Status }
>;

// Compiles only when every check holds, so the TypeScript gate proves the checks for the package's own types.
function checksHold<_Checks extends readonly true[]>(): true {
  return true;
}

const CODE_UNIONS_EQUAL_THEIR_LISTS = {
  BACKFILL_CHANGE_TYPES:
    checksHold<
      [
        Equal<
          engine.BackfillChangeType,
          ListMember<typeof engine.BACKFILL_CHANGE_TYPES>
        >,
        Equal<engine.BackfillEntry['changeType'], engine.BackfillChangeType>,
      ]
    >(),
  BACKFILL_REFUSAL_CODES:
    checksHold<
      [
        Equal<
          engine.BackfillRefusalCode,
          ListMember<typeof engine.BACKFILL_REFUSAL_CODES>
        >,
        Equal<engine.BackfillRefusal['code'], engine.BackfillRefusalCode>,
      ]
    >(),
  BACKFILL_STATUSES:
    checksHold<
      [
        Equal<
          engine.BackfillStatus,
          ListMember<typeof engine.BACKFILL_STATUSES>
        >,
        Equal<engine.SchemaLedgerBackfill['status'], engine.BackfillStatus>,
      ]
    >(),
  DAMAGED_TABLE_REPAIRS:
    checksHold<
      [
        Equal<
          engine.DamagedTableRepair,
          ListMember<typeof engine.DAMAGED_TABLE_REPAIRS>
        >,
        Equal<engine.DamagedTableDetail['repair'], engine.DamagedTableRepair>,
      ]
    >(),
  DAMAGE_SHAPES:
    checksHold<
      [
        Equal<engine.DamageShape, ListMember<typeof engine.DAMAGE_SHAPES>>,
        Equal<engine.DamagedTableDetail['shape'], engine.DamageShape>,
      ]
    >(),
  FINDING_CODES:
    checksHold<
      [
        Equal<engine.FindingCode, ListMember<typeof engine.FINDING_CODES>>,
        Equal<engine.SchemaLedgerFinding['code'], engine.FindingCode>,
      ]
    >(),
  FINDING_ROLES:
    checksHold<
      [
        Equal<engine.FindingRole, ListMember<typeof engine.FINDING_ROLES>>,
        Equal<engine.SchemaLedgerFinding['role'], engine.FindingRole>,
      ]
    >(),
  MIGRATION_CHANGE_TYPES:
    checksHold<
      [
        Equal<
          engine.MigrationChangeType,
          ListMember<typeof engine.MIGRATION_CHANGE_TYPES>
        >,
        Equal<engine.ReplayFailure['step'], engine.MigrationChangeType>,
        Equal<Migration['changeType'], engine.MigrationChangeType>,
      ]
    >(),
  REPAIR_OUTCOMES:
    checksHold<
      [Equal<engine.RepairOutcome, ListMember<typeof engine.REPAIR_OUTCOMES>>]
    >(),
  ROW_DIAGNOSTICS:
    checksHold<
      [
        Equal<engine.RowDiagnostics, ListMember<typeof engine.ROW_DIAGNOSTICS>>,
        Equal<
          NonNullable<engine.ScanSchemaLedgerData['rowDiagnostics']>,
          engine.RowDiagnostics
        >,
      ]
    >(),
  ROW_HASH_REASONS:
    checksHold<
      [
        Equal<engine.RowHashReason, ListMember<typeof engine.ROW_HASH_REASONS>>,
        Equal<engine.MismatchedRowHash['reason'], engine.RowHashReason>,
      ]
    >(),
  TABLE_REPAIR_OUTCOMES:
    checksHold<
      [
        Equal<
          engine.TableRepairOutcome,
          ListMember<typeof engine.TABLE_REPAIR_OUTCOMES>
        >,
        Equal<engine.TableRepair['outcome'], engine.TableRepairOutcome>,
      ]
    >(),
  UNLEDGERED_REASONS:
    checksHold<
      [
        Equal<
          engine.UnledgeredReason,
          ListMember<typeof engine.UNLEDGERED_REASONS>
        >,
        Equal<engine.UnledgeredDetail['reason'], engine.UnledgeredReason>,
      ]
    >(),
};

// The facade returns the exported result types, and every object they hold has an exported name.
const RESULT_PARTS_HAVE_THEIR_NAMES =
  checksHold<
    [
      Equal<
        ResultOf<engine.EngineApiService['scanSchemaLedger']>,
        engine.SchemaLedgerScan
      >,
      Equal<
        engine.SchemaLedgerScan['findings'][number],
        engine.SchemaLedgerFinding
      >,
      Equal<engine.SchemaLedgerScan['stats'], engine.SchemaLedgerScanStats>,
      Equal<FindingOf<'unledgeredTable'>['detail'], engine.UnledgeredDetail>,
      Equal<
        Extract<engine.UnledgeredDetail, { readonly reason: 'brokenLineage' }>,
        engine.BrokenLineage
      >,
      Equal<FindingOf<'unreplayableLedger'>['detail'], engine.ReplayFailure>,
      Equal<FindingOf<'damagedTable'>['detail'], engine.DamagedTableDetail>,
      Equal<
        FindingOf<'rowSchemaHashMismatch'>['detail'],
        engine.RowSchemaHashMismatchDetail
      >,
      Equal<
        engine.RowSchemaHashMismatchDetail['rowHashes'][number],
        engine.MismatchedRowHash
      >,
      Equal<
        ResultOf<engine.EngineApiService['repairSchemaLedger']>,
        engine.SchemaLedgerRepair
      >,
      Equal<engine.SchemaLedgerRepair['tables'][number], engine.TableRepair>,
      Equal<
        engine.SchemaLedgerRepair['renumbered'][number],
        engine.RenumberedMigration
      >,
      Equal<NonNullable<engine.TableRepair['invalidRows']>, engine.InvalidRows>,
      Equal<
        ResultOf<engine.EngineApiService['backfillSchemaLedger']>,
        engine.SchemaLedgerBackfill
      >,
      Equal<BackfillOf<'notNeeded'>, engine.BackfillNotNeeded>,
      Equal<BackfillOf<'planned'>, engine.BackfillPlanned>,
      Equal<BackfillOf<'backfilled'>, engine.BackfillCommitted>,
      Equal<BackfillOf<'refused'>, engine.BackfillRefused>,
      Equal<engine.BackfillPlanned['entries'][number], engine.BackfillEntry>,
      Equal<engine.BackfillRefused['refusal'], engine.BackfillRefusal>,
      Equal<
        Parameters<engine.EngineApiService['scanSchemaLedger']>[0],
        engine.ScanSchemaLedgerData | undefined
      >,
      Equal<
        Parameters<engine.EngineApiService['repairSchemaLedger']>[0],
        engine.RepairSchemaLedgerData
      >,
      Equal<
        Parameters<engine.EngineApiService['backfillSchemaLedger']>[0],
        engine.BackfillSchemaLedgerData
      >,
    ]
  >();

describe('package exports of the schema ledger operations', () => {
  it('exports the input and result types of scan, repair and backfill with their code lists', () => {
    expect(namesExportedFrom(PACKAGE_ENTRY, MIGRATION_MODULES)).toEqual({
      types: LEDGER_OPERATION_TYPES,
      values: Object.keys(CODE_LISTS)
        .filter((name) => name !== 'MIGRATION_CHANGE_TYPES')
        .sort(compareCodePoints),
    });
  });

  it('exports the replay failure that an unreplayable ledger finding carries', () => {
    expect(namesExportedFrom(PACKAGE_ENTRY, LEDGER_REPLAY_MODULE)).toEqual({
      types: ['MigrationChangeType', 'ReplayFailure'],
      values: ['MIGRATION_CHANGE_TYPES'],
    });
  });

  it('names every object type that a result holds', () => {
    expect(RESULT_PARTS_HAVE_THEIR_NAMES).toBe(true);
  });

  it('derives every code union from its runtime list', () => {
    expect(Object.keys(CODE_UNIONS_EQUAL_THEIR_LISTS)).toEqual(
      Object.keys(CODE_LISTS),
    );
  });

  it.each(Object.entries(CODE_LISTS))(
    '%s holds exactly the values of its code union',
    (name, values) => {
      const exported: Readonly<Record<string, unknown>> = engine;

      expect(exported[name]).toEqual(expect.arrayContaining(values));
      expect(exported[name]).toHaveLength(values.length);
    },
  );
});
