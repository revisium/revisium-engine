import type { JsonSchema } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import type { BranchScenario } from 'src/__tests__/fixtures/branch-scenario';
import { acceptDamagedCommittedVersions } from 'src/__tests__/fixtures/head-schema-damage';
import type { BranchScenarioTestKit } from 'src/__tests__/kit/create-branch-scenario-test-kit';
import type { InputJsonValue } from 'src/engine-prisma-types';
import type {
  BackfillEntry,
  BackfillSchemaLedgerData,
  SchemaLedgerBackfill,
} from 'src/features/migration/commands/impl/backfill-schema-ledger.command';
import { MigrationApiService } from 'src/features/migration/migration-api.service';
import { SystemTables } from 'src/features/share/system-tables.consts';

export type BackfillInput = Partial<
  Record<keyof BackfillSchemaLedgerData, unknown>
>;

export function backfillLedger(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
  input: BackfillInput = {},
): Promise<SchemaLedgerBackfill> {
  return kit.module.get(MigrationApiService).backfillSchemaLedger({
    ...draft.branch,
    ...input,
  } as BackfillSchemaLedgerData);
}

export function planBackfill(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
): Promise<SchemaLedgerBackfill> {
  return backfillLedger(kit, draft, { dryRun: true });
}

export function initEntry(tableId: string, schema: JsonSchema): BackfillEntry {
  return {
    id: expect.any(String) as string,
    changeType: 'init',
    tableId,
    hash: objectHash(schema),
  };
}

export function updateEntry(
  tableId: string,
  headSchema: JsonSchema,
): BackfillEntry {
  return {
    id: expect.any(String) as string,
    changeType: 'update',
    tableId,
    hash: objectHash(headSchema),
  };
}

export function entriesOf(backfill: SchemaLedgerBackfill): BackfillEntry[] {
  if (backfill.status !== 'planned') {
    throw new Error(`The backfill is ${backfill.status}, not planned`);
  }

  return [...backfill.entries];
}

export function withoutIds(
  entries: readonly BackfillEntry[],
): Omit<BackfillEntry, 'id'>[] {
  return entries.map(({ changeType, tableId, hash }) => ({
    changeType,
    tableId,
    hash,
  }));
}

export async function atClock<T>(
  isoTime: string,
  action: () => Promise<T>,
): Promise<T> {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(isoTime));

  try {
    return await action();
  } finally {
    clock.mockRestore();
  }
}

export async function transactionsStartedDuring(
  kit: BranchScenarioTestKit,
  action: () => Promise<unknown>,
): Promise<number> {
  const transactions = jest.spyOn(kit.prisma, '$transaction');

  try {
    await action();

    return transactions.mock.calls.length;
  } finally {
    transactions.mockRestore();
  }
}

export async function renameHeadTableBelowNativeValidation(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
  tableId: string,
  nextTableId: string,
): Promise<void> {
  await kit.prisma.table.update({
    where: { versionId: await draft.tableVersionId('head', tableId) },
    data: { id: nextTableId },
  });
  await acceptDamagedCommittedVersions(kit, draft);
}

export async function revisionsOf(draft: BranchScenario) {
  return {
    headRevisionId: await draft.revisionId('head'),
    draftRevisionId: await draft.revisionId('draft'),
  };
}

export async function commitHeadSchema(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
  tableId: string,
  schema: JsonSchema,
): Promise<void> {
  await writeDraftSchemaBelowNativeValidation(kit, draft, tableId, schema);
  await draft.commit();
}

export async function linkDraftMigrationTable(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
): Promise<void> {
  await belowNativeValidation(kit, draft, (revisionId) =>
    kit.draftRevisionApi.createTable({
      revisionId,
      tableId: SystemTables.Migration,
      system: true,
    }),
  );
}

async function writeDraftSchemaBelowNativeValidation(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
  tableId: string,
  schema: JsonSchema,
): Promise<void> {
  await belowNativeValidation(kit, draft, (revisionId) =>
    kit.draftRevisionApi.updateRows({
      revisionId,
      tableId: SystemTables.Schema,
      rows: [{ rowId: tableId, data: schema as InputJsonValue }],
    }),
  );
}

async function belowNativeValidation(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
  write: (revisionId: string) => Promise<unknown>,
): Promise<void> {
  const revisionId = await draft.revisionId('draft');

  await kit.draftWriteAdmission.runSerializableRevisionWrite(revisionId, () =>
    write(revisionId),
  );
}
