import { nanoid } from 'nanoid';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { GetPendingStorageDeletionsQuery } from 'src/features/file-usage/queries/impl/get-pending-storage-deletions.query';
import { PendingStorageDeletion } from 'src/features/file-usage/types';
import {
  fakeSha256,
  givenBranchWithFileTable,
} from 'src/features/file-usage/commands/handlers/__tests__/utils';

describe('GetPendingStorageDeletionsHandler', () => {
  let kit: DraftTestKit;

  beforeAll(async () => {
    kit = await createDraftTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  function execute(args?: {
    limit?: number;
    afterHash?: string;
  }): Promise<PendingStorageDeletion[]> {
    return kit.queryBus.execute(
      new GetPendingStorageDeletionsQuery(args ?? {}),
    );
  }

  it('returns hashes that are only tombstoned and have no active blob anywhere', async () => {
    const scenario = await givenBranchWithFileTable(kit);
    const hash = fakeSha256(`pending-lonely-${nanoid()}`);

    await kit.prismaService.fileBlob.create({
      data: {
        projectId: scenario.projectId,
        hash,
        size: 123n,
        deletedAt: new Date(),
      },
    });

    const pending = await execute();

    const match = pending.find((row) => row.hash === hash);
    expect(match).toBeDefined();
    expect(match?.size).toBe(123n);
  });

  it('excludes a hash that has at least one active blob', async () => {
    const first = await givenBranchWithFileTable(kit);
    const second = await givenBranchWithFileTable(kit);
    const hash = fakeSha256(`pending-shared-${nanoid()}`);

    await kit.prismaService.fileBlob.create({
      data: {
        projectId: first.projectId,
        hash,
        size: 500n,
        deletedAt: new Date(),
      },
    });
    await kit.prismaService.fileBlob.create({
      data: { projectId: second.projectId, hash, size: 500n },
    });

    const pending = await execute();

    expect(pending.map((row) => row.hash)).not.toContain(hash);
  });

  it('respects the supplied limit', async () => {
    const pending = await execute({ limit: 0 });
    expect(pending).toHaveLength(0);
  });

  it('supports checkpoint-style pagination via afterHash', async () => {
    const scenario = await givenBranchWithFileTable(kit);
    const prefix = `ff${nanoid().replace(/-/g, '').toLowerCase()}`.slice(0, 16);
    const hashA = `${prefix}a`.padEnd(64, 'a');
    const hashB = `${prefix}b`.padEnd(64, 'b');
    const hashC = `${prefix}c`.padEnd(64, 'c');
    const sorted = [hashA, hashB, hashC];

    for (const [index, hash] of sorted.entries()) {
      await kit.prismaService.fileBlob.create({
        data: {
          projectId: scenario.projectId,
          hash,
          size: BigInt(index + 1),
          deletedAt: new Date(),
        },
      });
    }

    const firstPage = await execute({
      limit: 1,
      afterHash: prefix.padEnd(64, '0'),
    });
    expect(firstPage).toHaveLength(1);
    expect(firstPage[0]?.hash).toBe(sorted[0]);

    const secondPage = await execute({
      limit: 2,
      afterHash: firstPage[0]?.hash,
    });
    expect(secondPage.map((row) => row.hash)).toEqual(sorted.slice(1));
  });

  it('can drain a larger backlog across multiple pages without duplicates', async () => {
    const scenario = await givenBranchWithFileTable(kit);
    const prefix = `fe${nanoid().replace(/-/g, '').toLowerCase()}`.slice(0, 16);
    const hashes = Array.from({ length: 25 }, (_, index) =>
      `${prefix}${index.toString(16).padStart(2, '0')}`.padEnd(64, 'f'),
    );

    for (const [index, hash] of hashes.entries()) {
      await kit.prismaService.fileBlob.create({
        data: {
          projectId: scenario.projectId,
          hash,
          size: BigInt(index + 1),
          deletedAt: new Date(),
        },
      });
    }

    const seen: string[] = [];
    let afterHash = `${prefix}`.padEnd(64, '0');

    for (;;) {
      const page = await execute({ limit: 6, afterHash });
      if (page.length === 0) {
        break;
      }

      const matching = page.filter((row) => row.hash.startsWith(prefix));
      if (matching.length === 0) {
        break;
      }

      seen.push(...matching.map((row) => row.hash));
      afterHash = matching[matching.length - 1]?.hash ?? afterHash;

      if (matching.length !== page.length) {
        break;
      }
    }

    expect(seen).toEqual(hashes);
    expect(new Set(seen).size).toBe(hashes.length);
  });
});
