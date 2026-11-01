import type { Migration } from '@revisium/schema-toolkit/types';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import type { ApplyMigrationResult } from 'src/features/draft/commands/impl/migration';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import { ChangesScenario } from './changes-scenario';
import { ledgerOf, schemasOf } from './ledger-replaying';
import type { RevisionSide } from './snapshot-reading';

export class HeadSyncedReplica {
  private constructor(
    private readonly kit: PartialChangesTestKit,
    private readonly replica: ChangesScenario,
  ) {}

  public static async of(
    kit: PartialChangesTestKit,
  ): Promise<HeadSyncedReplica> {
    return new HeadSyncedReplica(kit, await ChangesScenario.committed(kit, {}));
  }

  public async syncWith(source: ChangesScenario): Promise<void> {
    const migrations = await newMigrationsOf(this.replica, source, 'head');

    await expect(
      importMigrations(this.kit, this.replica, migrations),
    ).resolves.toEqual(migrations.map(({ id }) => ({ id, status: 'applied' })));
    await this.replica.commit();
  }

  public async expectSchemasOf(source: ChangesScenario): Promise<void> {
    expect(await schemasOf(this.replica, 'head')).toEqual(
      await schemasOf(source, 'head'),
    );
  }
}

export class DraftSyncedReplica {
  private constructor(
    private readonly kit: PartialChangesTestKit,
    private readonly replica: ChangesScenario,
  ) {}

  public static async of(
    kit: PartialChangesTestKit,
  ): Promise<DraftSyncedReplica> {
    return new DraftSyncedReplica(
      kit,
      await ChangesScenario.committed(kit, {}),
    );
  }

  public async syncWith(
    source: ChangesScenario,
  ): Promise<ApplyMigrationResult[]> {
    return importMigrations(
      this.kit,
      this.replica,
      await newMigrationsOf(this.replica, source, 'draft'),
    );
  }
}

export async function expectPendingMigrationsAfterPublished(
  draft: ChangesScenario,
): Promise<void> {
  const published = await draft.ledgerIds('head');
  const lastPublished = published.at(-1) ?? '';
  const pending = await draft.pendingMigrationIds();

  expect(
    pending.filter((id) => compareCodePoints(id, lastPublished) <= 0),
  ).toEqual([]);
}

async function newMigrationsOf(
  replica: ChangesScenario,
  source: ChangesScenario,
  side: RevisionSide,
): Promise<Migration[]> {
  const imported = new Set(await replica.ledgerIds('draft'));
  const ledger = await ledgerOf(source, side);

  return ledger.filter(({ id }) => !imported.has(id));
}

async function importMigrations(
  kit: PartialChangesTestKit,
  replica: ChangesScenario,
  migrations: Migration[],
): Promise<ApplyMigrationResult[]> {
  return kit.draftApi.applyMigrations({
    revisionId: await replica.revisionId('draft'),
    migrations,
  });
}
