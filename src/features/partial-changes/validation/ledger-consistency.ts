import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { Row } from 'src/engine-prisma-types';
import type {
  AppliedUnits,
  RevisionSide,
} from 'src/features/partial-changes/assembly/outcome-rules';
import type { AssemblySource } from 'src/features/partial-changes/assembly/target-assembler';
import type { LedgerReplayRules } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { PlanBlocker } from 'src/features/partial-changes/selection/selection-resolution';
import {
  type LedgerRole,
  type ResultingRole,
  resultingRolesOf,
  sourceRoleOf,
} from 'src/features/partial-changes/validation/ledger-roles';
import {
  replayLedger,
  type ReplayedSlot,
} from 'src/features/share/ledger-replay/ledger-replay';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
import { ledgeredTableIdOf } from 'src/features/share/ledger-replay/table-slots';

type LedgerInconsistency =
  | {
      readonly kind: 'unreplayable';
      readonly tableId: string;
      readonly error: string;
    }
  | { readonly kind: 'schemaMismatch'; readonly tableId: string }
  | { readonly kind: 'missingTable'; readonly tableId: string };

type InconsistentTables = Readonly<Record<RevisionSide, ReadonlySet<string>>>;

export class LedgerConsistency {
  constructor(private readonly rules: LedgerReplayRules) {}

  public blockersOf(
    source: AssemblySource,
    choice: AppliedUnits,
  ): PlanBlocker[] {
    const existing: InconsistentTables = {
      head: this.inconsistentTablesOf(sourceRoleOf(source.snapshot, 'head')),
      draft: this.inconsistentTablesOf(sourceRoleOf(source.snapshot, 'draft')),
    };

    return resultingRolesOf(source, choice).flatMap((role) =>
      this.inconsistenciesOf(role)
        .filter(({ tableId }) => !keepsExisting(role, existing, tableId))
        .map((inconsistency) => ledgerInconsistentOf(role, inconsistency)),
    );
  }

  private inconsistentTablesOf(role: LedgerRole): ReadonlySet<string> {
    return new Set(this.inconsistenciesOf(role).map(({ tableId }) => tableId));
  }

  private inconsistenciesOf({
    ledger,
    schemaRows,
  }: LedgerRole): LedgerInconsistency[] {
    const schemas = schemasByTableId(schemaRows);
    const { slots } = replayLedger({ ledger, ...this.rules });

    return slots.flatMap((slot) => {
      const inconsistency = inconsistencyOf(slot, schemas);

      return inconsistency ? [inconsistency] : [];
    });
  }
}

function inconsistencyOf(
  slot: ReplayedSlot,
  schemas: ReadonlyMap<string, JsonSchema>,
): LedgerInconsistency | undefined {
  if (slot.failure) {
    return {
      kind: 'unreplayable',
      tableId: lastTableIdOf(slot),
      error: slot.failure.error,
    };
  }

  const tableId = ledgeredTableIdOf(slot);

  if (tableId === undefined) {
    return undefined;
  }

  const schema = schemas.get(tableId);

  if (schema === undefined) {
    return { kind: 'missingTable', tableId };
  }

  if (slot.schema === undefined || !schemasEqual(slot.schema, schema)) {
    return { kind: 'schemaMismatch', tableId };
  }

  return undefined;
}

function keepsExisting(
  role: ResultingRole,
  existing: InconsistentTables,
  tableId: string,
): boolean {
  return role.keepsInconsistenciesOf.some((side) =>
    existing[side].has(tableId),
  );
}

function ledgerInconsistentOf(
  { name }: ResultingRole,
  inconsistency: LedgerInconsistency,
): PlanBlocker {
  const { tableId } = inconsistency;

  return {
    code: 'ledgerInconsistent',
    tableId,
    message: `The migration ledger of the ${name} ${problemOf(name, inconsistency)}`,
  };
}

function problemOf(role: string, inconsistency: LedgerInconsistency): string {
  switch (inconsistency.kind) {
    case 'unreplayable':
      return `cannot replay ${inconsistency.tableId}: ${inconsistency.error}`;
    case 'schemaMismatch':
      return `does not replay to the schema of ${inconsistency.tableId}`;
    case 'missingTable':
      return `holds ${inconsistency.tableId}, which the ${role} does not have`;
  }
}

function schemasByTableId(
  schemaRows: readonly Row[],
): ReadonlyMap<string, JsonSchema> {
  return new Map(
    schemaRows.map(({ id, data }) => [id, data as unknown as JsonSchema]),
  );
}

function lastTableIdOf({ tableIds }: ReplayedSlot): string {
  const tableId = tableIds.at(-1);

  if (tableId === undefined) {
    throw new Error('A replayed ledger slot holds no table id');
  }

  return tableId;
}
