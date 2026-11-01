import type { Migration } from '@revisium/schema-toolkit/types';
import type { Row } from 'src/engine-prisma-types';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';
import {
  type AppliedUnits,
  OutcomeRules,
} from 'src/features/partial-changes/assembly/outcome-rules';
import { systemTableTargetsOf } from 'src/features/partial-changes/assembly/system-table-targets';
import type { AssemblySource } from 'src/features/partial-changes/assembly/target-assembler';
import type { ChangesSnapshot } from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  ledgerOf,
  migrationsOf,
} from 'src/features/share/ledger/migration-ledger';
import { SystemTables } from 'src/features/share/system-tables.consts';

export interface LedgerRole {
  readonly ledger: readonly Migration[];
  readonly schemaRows: readonly Row[];
}

export interface ResultingRole extends LedgerRole {
  readonly name: string;
  readonly keepsInconsistenciesOf: readonly RevisionSide[];
}

interface TargetSystemRows {
  readonly schemas: readonly Row[];
  readonly migrations: readonly Row[];
}

export function sourceRoleOf(
  { systemRows }: ChangesSnapshot,
  side: RevisionSide,
): LedgerRole {
  return {
    ledger: migrationsOf(ledgerOf(systemRows.migrations[side])),
    schemaRows: systemRows.schemas[side],
  };
}

export function resultingRolesOf(
  source: AssemblySource,
  choice: AppliedUnits,
): ResultingRole[] {
  const target = targetSystemRowsOf(source, choice);

  if (choice.operation === 'revert') {
    return [
      {
        name: 'reverted Draft',
        ledger: migrationsOf(ledgerOf(target.migrations)),
        schemaRows: target.schemas,
        keepsInconsistenciesOf: ['draft', 'head'],
      },
    ];
  }

  const { schemas, migrations } = source.snapshot.systemRows;

  return [
    {
      name: 'new Head',
      ledger: migrationsOf(ledgerOf(target.migrations)),
      schemaRows: target.schemas,
      keepsInconsistenciesOf: ['head'],
    },
    {
      name: 'remaining Draft',
      ledger: remainingDraftLedgerOf(migrations.draft, target.migrations),
      schemaRows: schemas.draft,
      keepsInconsistenciesOf: ['draft'],
    },
  ];
}

function targetSystemRowsOf(
  source: AssemblySource,
  choice: AppliedUnits,
): TargetSystemRows {
  const targets = systemTableTargetsOf(source, new OutcomeRules(choice));
  const rowsOf = (tableId: SystemTables) =>
    targets.find((target) => target.tableId === tableId)?.versions ?? [];

  return {
    schemas: rowsOf(SystemTables.Schema),
    migrations: rowsOf(SystemTables.Migration),
  };
}

function remainingDraftLedgerOf(
  draftRows: readonly Row[],
  publishedRows: readonly Row[],
): Migration[] {
  const published = new Set(publishedRows.map(({ versionId }) => versionId));

  // Renumbering (§6.8) keeps the remaining entries in their order after every
  // published one, so the replay needs that order, not the new ids.
  return [
    ...migrationsOf(
      ledgerOf(draftRows.filter(({ versionId }) => published.has(versionId))),
    ),
    ...migrationsOf(
      ledgerOf(draftRows.filter(({ versionId }) => !published.has(versionId))),
    ),
  ];
}
