import type { JsonSchema, Migration } from '@revisium/schema-toolkit/types';
import { prepareBranch } from 'src/__tests__/utils/prepareProject';
import type { ApplyMigrationResult } from 'src/features/draft/commands/impl/migration';
import { GetMigrationsQuery } from 'src/features/revision/queries/impl/get-migrations.query';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import type { PartialChangesTestKit } from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';

export type SyncResult = Array<Pick<ApplyMigrationResult, 'id' | 'status'>>;

export class Replica {
  private constructor(
    private readonly kit: PartialChangesTestKit,
    private readonly branch: {
      projectId: string;
      branchId: string;
      branchName: string;
    },
  ) {}

  static async create(kit: PartialChangesTestKit): Promise<Replica> {
    const graph = await prepareBranch(kit.prisma);
    return new Replica(kit, graph);
  }

  async syncFromHead(source: ChangesScenario): Promise<SyncResult> {
    return this.applyLedger(await source.ledger('head'));
  }

  async syncFromDraft(source: ChangesScenario): Promise<SyncResult> {
    return this.applyLedger(await source.ledger('draft'));
  }

  async headSchemas(): Promise<Record<string, JsonSchema>> {
    const head = await this.revision('head');
    const rows = await this.kit.prisma.row.findMany({
      where: {
        tables: {
          some: {
            id: SystemTables.Schema,
            revisions: { some: { id: head.id } },
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    return Object.fromEntries(
      rows.map((row) => [row.id, row.data as JsonSchema]),
    );
  }

  async headLedgerIds(): Promise<string[]> {
    const head = await this.revision('head');
    const ledger: Migration[] = await this.kit.queryBus.execute(
      new GetMigrationsQuery({ revisionId: head.id }),
    );
    return ledger.map(({ id }) => id);
  }

  async applyLedger(migrations: Migration[]): Promise<SyncResult> {
    const draft = await this.revision('draft');
    const results = await this.kit.draftApi.applyMigrations({
      revisionId: draft.id,
      migrations,
    });

    if (results.some(({ status }) => status === 'applied')) {
      await this.kit.draftApi.apiCreateRevision({
        projectId: this.branch.projectId,
        branchName: this.branch.branchName,
      });
    }

    return results.map(({ id, status }) => ({ id, status }));
  }

  private revision(role: 'head' | 'draft') {
    return this.kit.prisma.revision.findFirstOrThrow({
      where:
        role === 'head'
          ? { branchId: this.branch.branchId, isHead: true }
          : { branchId: this.branch.branchId, isDraft: true },
    });
  }
}

export function failedMigrations(results: SyncResult): SyncResult {
  return results.filter(({ status }) => status === 'failed');
}

export async function expectReplicaMirrorsHead(
  replica: Replica,
  source: ChangesScenario,
): Promise<void> {
  expect(failedMigrations(await replica.syncFromHead(source))).toEqual([]);
  expect(await replica.headSchemas()).toEqual(await source.schemas('head'));
  expect(await replica.headLedgerIds()).toEqual(
    (await source.ledger('head')).map(({ id }) => id),
  );
}

export async function expectLedgerReplaysTo(
  kit: PartialChangesTestKit,
  source: ChangesScenario,
  role: 'head' | 'draft',
): Promise<void> {
  const fresh = await Replica.create(kit);
  const results = await fresh.applyLedger(await source.ledger(role));
  expect(failedMigrations(results)).toEqual([]);
  expect(await fresh.headSchemas()).toEqual(await source.schemas(role));
}
