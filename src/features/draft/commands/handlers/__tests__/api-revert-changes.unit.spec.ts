import { QueryBus, CommandBus } from '@nestjs/cqrs';
import { ApiRevertChangesHandler } from 'src/features/draft/commands/handlers/api-revert-changes.handler';
import { ApiRevertChangesCommand } from 'src/features/draft/commands/impl/api-revert-changes.command';
import { RevertChangesCommand } from 'src/features/draft/commands/impl/revert-changes.command';
import { GetBranchByIdQuery } from 'src/features/branch/quieries/impl';
import { MigrationLockService } from 'src/features/migration/services/migration-lock.service';
import { ShareCommands } from 'src/features/share/share.commands';
import { DraftWriteAdmissionService } from 'src/features/draft/draft-write-admission.service';

describe('ApiRevertChangesHandler (unit)', () => {
  it('should cancel migrations inside the serializable transaction before revert', async () => {
    const commandBus = {
      execute: jest.fn().mockResolvedValue({
        branchId: 'branch-1',
        draftRevisionId: 'draft-1',
      }),
    } as unknown as CommandBus;
    const queryBus = {
      execute: jest.fn().mockResolvedValue({ id: 'branch-1' }),
    } as unknown as QueryBus;
    const shareCommands = {
      notifyEndpoints: jest.fn().mockResolvedValue(undefined),
    } as unknown as ShareCommands;
    let transactionOpened = false;
    const migrationLockService = {
      cancelBranchMigrations: jest.fn().mockImplementation(async () => {
        expect(transactionOpened).toBe(true);
      }),
    } as unknown as MigrationLockService;

    const draftWriteAdmission = {
      runSerializableRevert: jest
        .fn()
        .mockImplementation(
          async (
            _projectId: string,
            _branchName: string,
            handler: () => Promise<unknown>,
          ) => {
            transactionOpened = true;
            return handler();
          },
        ),
    } as unknown as DraftWriteAdmissionService;

    const handler = new ApiRevertChangesHandler(
      commandBus,
      queryBus,
      draftWriteAdmission,
      shareCommands,
      migrationLockService,
    );

    const result = await handler.execute({
      data: {
        projectId: 'project-1',
        branchName: 'master',
      },
    } as ApiRevertChangesCommand);

    expect(draftWriteAdmission.runSerializableRevert).toHaveBeenCalledWith(
      'project-1',
      'master',
      expect.any(Function),
    );
    expect(migrationLockService.cancelBranchMigrations).toHaveBeenCalledWith(
      'project-1',
      'master',
    );
    expect(commandBus.execute).toHaveBeenCalledWith(
      expect.any(RevertChangesCommand),
    );
    expect(transactionOpened).toBe(true);
    expect(shareCommands.notifyEndpoints).toHaveBeenCalledWith({
      revisionId: 'draft-1',
    });
    expect(queryBus.execute).toHaveBeenCalledWith(
      expect.any(GetBranchByIdQuery),
    );
    expect(result).toEqual({ id: 'branch-1' });
  });
});
