import type { Migration } from '@revisium/schema-toolkit/types';
import type { BranchScenarioTestKit } from 'src/__tests__/kit/create-branch-scenario-test-kit';
import type { RevisionSide } from 'src/features/draft-revision/commands/impl';
import type { ApplyMigrationResult } from 'src/features/draft/commands/impl/migration';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import { BranchScenario } from './branch-scenario';
import {
  ledgerIdsOf,
  pendingMigrationIds,
  storedLedgerOf,
  storedSchemasOf,
} from './stored-ledger';

export class HeadSyncedReplica {
  private constructor(
    private readonly kit: BranchScenarioTestKit,
    private readonly replica: BranchScenario,
  ) {}

  public static async of(
    kit: BranchScenarioTestKit,
  ): Promise<HeadSyncedReplica> {
    return new HeadSyncedReplica(kit, await BranchScenario.committed(kit, {}));
  }

  public async syncWith(source: BranchScenario): Promise<void> {
    const migrations = await newMigrationsOf(this.replica, source, 'head');

    await importMigrations(this.kit, this.replica, migrations);
    await this.replica.commit();
  }

  public async expectSchemasOf(source: BranchScenario): Promise<void> {
    expect(await storedSchemasOf(this.replica, 'head')).toEqual(
      await storedSchemasOf(source, 'head'),
    );
  }
}

export class DraftSyncedReplica {
  private constructor(
    private readonly kit: BranchScenarioTestKit,
    private readonly replica: BranchScenario,
  ) {}

  public static async of(
    kit: BranchScenarioTestKit,
  ): Promise<DraftSyncedReplica> {
    return new DraftSyncedReplica(kit, await BranchScenario.committed(kit, {}));
  }

  public async syncWith(
    source: BranchScenario,
  ): Promise<ApplyMigrationResult[]> {
    return tryImportMigrations(
      this.kit,
      this.replica,
      await newMigrationsOf(this.replica, source, 'draft'),
    );
  }
}

export async function expectHeadSyncedReplicaToReproduceTheHead(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
): Promise<void> {
  const replica = await HeadSyncedReplica.of(kit);

  await replica.syncWith(draft);
  await replica.expectSchemasOf(draft);
}

export async function expectPendingMigrationsAfterPublished(
  draft: BranchScenario,
): Promise<void> {
  const published = await ledgerIdsOf(draft, 'head');
  const lastPublished = published.at(-1) ?? '';
  const pending = await pendingMigrationIds(draft);

  expect(
    pending.filter((id) => compareCodePoints(id, lastPublished) <= 0),
  ).toEqual([]);
}

export async function importMigrations(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
  migrations: Migration[],
): Promise<void> {
  expect(await tryImportMigrations(kit, draft, migrations)).toEqual(
    migrations.map(({ id }) => ({ id, status: 'applied' })),
  );
}

export async function tryImportMigrations(
  kit: BranchScenarioTestKit,
  draft: BranchScenario,
  migrations: Migration[],
): Promise<ApplyMigrationResult[]> {
  return kit.draftApi.applyMigrations({
    revisionId: await draft.revisionId('draft'),
    migrations,
  });
}

async function newMigrationsOf(
  replica: BranchScenario,
  source: BranchScenario,
  side: RevisionSide,
): Promise<Migration[]> {
  const imported = new Set(await ledgerIdsOf(replica, 'draft'));
  const ledger = await storedLedgerOf(source, side);

  return ledger.filter(({ id }) => !imported.has(id));
}
