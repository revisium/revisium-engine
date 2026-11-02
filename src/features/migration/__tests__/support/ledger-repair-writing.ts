import type { JsonSchema, Migration } from '@revisium/schema-toolkit/types';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { createBarrier, type Barrier } from 'src/__tests__/utils/barrier';
import type { InputJsonValue, Row } from 'src/engine-prisma-types';
import type {
  DraftRevisionCreateRowsCommandData,
  DraftRevisionUpdateRowsCommandData,
  DraftRowVersionsReplacement,
} from 'src/features/draft-revision/commands/impl';
import { DraftRevisionTargetApiService } from 'src/features/draft-revision/draft-revision-target-api.service';
import type {
  RepairSchemaLedgerData,
  SchemaLedgerRepair,
  TableRepair,
  TableRepairOutcome,
} from 'src/features/migration/commands/impl/repair-schema-ledger.command';
import { MigrationApiService } from 'src/features/migration/migration-api.service';
import type { SchemaLedgerRepairPlan } from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import { ChangesScenario } from 'src/features/partial-changes/__tests__/support/changes-scenario';
import type { RevisionSide } from 'src/features/partial-changes/__tests__/support/snapshot-reading';
import { replayOf } from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import type { StoredSchema } from 'src/features/share/ledger/migration-ledger';
import type { ReplayFailure } from 'src/features/share/ledger-replay/ledger-replay';
import type { HistoryPatches } from 'src/features/share/queries/impl';
import { ShareCommands } from 'src/features/share/share.commands';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import {
  importMigrations,
  pendingMigrationIds,
} from './ledger-repair-planning';
import { scanBranch } from './ledger-scan';

export type RepairOptions = Pick<RepairSchemaLedgerData, 'tableIds' | 'dryRun'>;

export interface PausedRepair {
  resume(): Promise<SchemaLedgerRepair>;
}

export interface EndpointNotification {
  readonly revisionId: string;
  readonly pendingMigrationIds: readonly string[];
}

const heldRepairs: { barrier: Barrier; result: Promise<unknown> }[] = [];

export function repairLedger(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  options: RepairOptions = {},
): Promise<SchemaLedgerRepair> {
  return kit.module
    .get(MigrationApiService)
    .repairSchemaLedger({ ...draft.branch, ...options });
}

export function tableRepairOf(
  repair: SchemaLedgerRepair,
  tableId: string,
): TableRepair {
  const table = repair.tables.find((entry) => entry.tableId === tableId);

  if (!table) {
    throw new Error(`The repair has no entry for ${tableId}`);
  }

  return table;
}

export function tableOutcomesOf(
  results: readonly PromiseSettledResult<SchemaLedgerRepair>[],
  tableId: string,
): (TableRepairOutcome | 'rejected')[] {
  return results
    .map((result) => {
      if (result.status === 'rejected') {
        return 'rejected';
      }

      return tableRepairOf(result.value, tableId).outcome;
    })
    .sort(compareCodePoints);
}

export function repairOfPlan(
  plan: SchemaLedgerRepairPlan,
  dryRun: boolean,
): SchemaLedgerRepair {
  return {
    headRevisionId: plan.headRevisionId,
    draftRevisionId: plan.draftRevisionId,
    dryRun,
    tables: plan.tables,
    renumbered: plan.renumbered,
  };
}

export async function repairUntilPlanned(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  options: RepairOptions,
): Promise<PausedRepair> {
  const barrier = createBarrier('The repair');
  holdEachBeforeWriting(kit, [barrier]);
  const repair = repairLedger(kit, draft, options);
  heldRepairs.push({ barrier, result: repair });
  await barrier.expectReachedBefore(repair);

  return {
    resume() {
      barrier.release();

      return repair;
    },
  };
}

export async function repairTwiceConcurrentlyPastTheirPlans(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  options: RepairOptions,
): Promise<PromiseSettledResult<SchemaLedgerRepair>[]> {
  const barriers = [
    createBarrier('The first repair'),
    createBarrier('The second repair'),
  ];
  holdEachBeforeWriting(kit, barriers);
  const repairs = barriers.map(() => repairLedger(kit, draft, options));
  const allRepairs = Promise.all(repairs);

  for (const barrier of barriers) {
    heldRepairs.push({ barrier, result: allRepairs });
    await barrier.expectReachedBefore(allRepairs);
  }

  for (const barrier of barriers) {
    barrier.release();
  }

  return Promise.allSettled(repairs);
}

export async function releaseHeldRepairs(): Promise<void> {
  const held = heldRepairs.splice(0);

  for (const { barrier } of held) {
    barrier.release();
  }

  await Promise.allSettled(held.map(({ result }) => result));
}

export function observeEndpointNotifications(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
): EndpointNotification[] {
  const notifications: EndpointNotification[] = [];

  jest
    .spyOn(kit.module.get(ShareCommands), 'notifyEndpoints')
    .mockImplementation(async ({ revisionId }) => {
      notifications.push({
        revisionId,
        pendingMigrationIds: await pendingMigrationIds(draft),
      });
    });

  return notifications;
}

export function recordRepairsWithoutTheirPatches(
  kit: PartialChangesTestKit,
): void {
  const draftRevisionApi = kit.draftRevisionApi;
  const createRows = draftRevisionApi.createRows.bind(draftRevisionApi);

  jest
    .spyOn(draftRevisionApi, 'createRows')
    .mockImplementation((data) => createRows(withoutPatches(data)));
}

export function renumberMigrationsWithoutTheirPatches(
  kit: PartialChangesTestKit,
): void {
  const targetApi = kit.module.get(DraftRevisionTargetApiService);
  const replaceDraftRowVersions =
    targetApi.replaceDraftRowVersions.bind(targetApi);

  jest
    .spyOn(targetApi, 'replaceDraftRowVersions')
    .mockImplementation((replacement) =>
      replaceDraftRowVersions(withoutNewPatches(replacement)),
    );
}

export function recordHistoriesWithEntry(
  kit: PartialChangesTestKit,
  entry: HistoryPatches,
): void {
  const draftRevisionApi = kit.draftRevisionApi;
  const updateRows = draftRevisionApi.updateRows.bind(draftRevisionApi);

  jest
    .spyOn(draftRevisionApi, 'updateRows')
    .mockImplementation((data) => updateRows(withHistoryEntry(data, entry)));
}

export function storedColumnsOf({
  createdId,
  createdAt,
  id,
  readonly,
  data,
  meta,
  hash,
  schemaHash,
  publishedAt,
}: Row) {
  return {
    createdId,
    createdAt,
    id,
    readonly,
    data,
    meta,
    hash,
    schemaHash,
    publishedAt,
  };
}

export async function expectNoHeadOrDraftDamage(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
): Promise<void> {
  const scan = await scanBranch(kit, draft, { rowDiagnostics: 'none' });

  expect(scan.findings.filter(({ role }) => role !== 'history')).toEqual([]);
}

export async function expectHeadSyncedReplicaToReproduceTheHead(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
): Promise<void> {
  const replica = await ChangesScenario.committed(kit, {});
  await importMigrations(kit, replica, await storedLedgerOf(draft, 'head'));
  await replica.commit();

  expect(await headSchemasOf(replica)).toEqual(await headSchemasOf(draft));
}

export async function expectLedgerRowsPublishedAtTheirIds(
  draft: ChangesScenario,
): Promise<void> {
  const snapshot = await draft.readSnapshot();
  const rows = snapshot.systemRows.migrations.draft.map(
    ({ id, data, publishedAt }) => ({
      id,
      migrationId: (data as unknown as Migration).id,
      publishedAt: publishedAt.toISOString(),
    }),
  );

  expect(rows).toEqual(
    rows.map(({ id }) => ({ id, migrationId: id, publishedAt: id })),
  );
}

export async function storedLedgerOf(
  draft: ChangesScenario,
  side: RevisionSide,
): Promise<Migration[]> {
  const snapshot = await draft.readSnapshot();

  return snapshot.systemRows.migrations[side]
    .map(({ data }) => data as unknown as Migration)
    .sort((left, right) => compareCodePoints(left.id, right.id));
}

export async function storedSchemaOf(
  draft: ChangesScenario,
  side: RevisionSide,
  tableId: string,
): Promise<StoredSchema> {
  const row = await draft.row(side, SystemTables.Schema, tableId);

  return {
    schema: row.data as unknown as JsonSchema,
    history: row.meta as unknown as HistoryPatches[],
  };
}

export async function draftReplayFailureOf(
  draft: ChangesScenario,
  tableId: string,
): Promise<ReplayFailure | undefined> {
  const replay = replayOf(...(await storedLedgerOf(draft, 'draft')));

  return replay.unreplayable.get(tableId);
}

async function headSchemasOf(
  draft: ChangesScenario,
): Promise<Record<string, unknown>> {
  const snapshot = await draft.readSnapshot();

  return Object.fromEntries(
    snapshot.systemRows.schemas.head.map(({ id, data }) => [id, data]),
  );
}

function holdEachBeforeWriting(
  kit: PartialChangesTestKit,
  barriers: readonly Barrier[],
): void {
  const admission = kit.draftWriteAdmission;
  const runWrite = admission.runSerializableRevisionWrite.bind(admission);
  let arrivals = 0;

  jest
    .spyOn(admission, 'runSerializableRevisionWrite')
    .mockImplementation(async (revisionId, write) => {
      const barrier = barriers[arrivals];
      arrivals += 1;
      await barrier?.arrive();

      return runWrite(revisionId, write);
    });
}

function withoutNewPatches(
  replacement: DraftRowVersionsReplacement,
): DraftRowVersionsReplacement {
  return {
    ...replacement,
    newRows: replacement.newRows.map((row) => ({
      ...row,
      data: { ...(row.data as object), patches: [] },
    })),
  };
}

function withHistoryEntry(
  data: DraftRevisionUpdateRowsCommandData,
  entry: HistoryPatches,
): DraftRevisionUpdateRowsCommandData {
  return {
    ...data,
    rows: data.rows.map((row) => ({
      ...row,
      meta: [...(row.meta as unknown[]), entry] as InputJsonValue,
    })),
  };
}

function withoutPatches(
  data: DraftRevisionCreateRowsCommandData,
): DraftRevisionCreateRowsCommandData {
  return {
    ...data,
    rows: data.rows.map((row) => ({
      ...row,
      data: { ...(row.data as object), patches: [] } as InputJsonValue,
    })),
  };
}
