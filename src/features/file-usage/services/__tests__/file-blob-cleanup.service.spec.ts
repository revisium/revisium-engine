import { Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { DatabaseServiceTestKit } from 'src/__tests__/kit/create-database-service-test-kit';
import { createDatabaseServiceTestKit } from 'src/__tests__/kit/create-database-service-test-kit';
import { FileBlobCleanupService } from 'src/features/file-usage/services/file-blob-cleanup.service';

describe('FileBlobCleanupService', () => {
  let kit: DatabaseServiceTestKit;
  let service: FileBlobCleanupService;
  let warnSpy: jest.SpyInstance;

  beforeAll(async () => {
    kit = await createDatabaseServiceTestKit([FileBlobCleanupService]);
    service = kit.module.get(FileBlobCleanupService);
  });

  afterAll(async () => {
    await kit.close();
  });

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('creates a zeroed row when the project usage row does not exist', async () => {
    const projectId = nanoid();

    await service.decrementProjectCounter(projectId, 500n);

    const usage = await kit.prismaService.projectFileUsage.findUnique({
      where: { projectId },
    });

    expect(usage?.fileBytes).toBe(0n);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('decrements the counter when the current value covers the requested amount', async () => {
    const projectId = nanoid();

    await kit.prismaService.projectFileUsage.create({
      data: {
        projectId,
        fileBytes: 1000n,
      },
    });

    await service.decrementProjectCounter(projectId, 300n);

    const usage = await kit.prismaService.projectFileUsage.findUnique({
      where: { projectId },
    });

    expect(usage?.fileBytes).toBe(700n);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('clamps the counter to zero when the requested decrement exceeds the current value', async () => {
    const projectId = nanoid();

    await kit.prismaService.projectFileUsage.create({
      data: {
        projectId,
        fileBytes: 100n,
      },
    });

    await service.decrementProjectCounter(projectId, 500n);

    const usage = await kit.prismaService.projectFileUsage.findUnique({
      where: { projectId },
    });

    expect(usage?.fileBytes).toBe(0n);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('does not hit projectFileUsage when the decrement amount is zero', async () => {
    const updateManySpy = jest.spyOn(
      kit.prismaService.projectFileUsage,
      'updateMany',
    );
    const findUniqueSpy = jest.spyOn(
      kit.prismaService.projectFileUsage,
      'findUnique',
    );
    const createSpy = jest.spyOn(kit.prismaService.projectFileUsage, 'create');
    const updateSpy = jest.spyOn(kit.prismaService.projectFileUsage, 'update');

    try {
      await service.decrementProjectCounter(nanoid(), 0n);

      expect(updateManySpy).not.toHaveBeenCalled();
      expect(findUniqueSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    } finally {
      updateManySpy.mockRestore();
      findUniqueSpy.mockRestore();
      createSpy.mockRestore();
      updateSpy.mockRestore();
    }
  });
});
