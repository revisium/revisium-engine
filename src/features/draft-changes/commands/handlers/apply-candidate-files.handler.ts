import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ApplyCandidateFilesCommand } from 'src/features/draft-changes/commands/impl/apply-candidate-files.command';
import { FileUsageIntegrationService } from 'src/features/file-usage/services/file-usage-integration.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@CommandHandler(ApplyCandidateFilesCommand)
export class ApplyCandidateFilesHandler implements ICommandHandler<
  ApplyCandidateFilesCommand,
  true
> {
  constructor(
    private readonly fileUsage: FileUsageIntegrationService,
    private readonly transactionPrisma: TransactionPrismaService,
  ) {}

  async execute(command: ApplyCandidateFilesCommand): Promise<true> {
    return this.handle(command.data);
  }

  private async handle(
    data: ApplyCandidateFilesCommand['data'],
  ): Promise<true> {
    this.transactionPrisma.getTransaction();
    await this.registerSavedRowVersions(data);
    await this.cleanupDetachedBlobs(data);
    return true;
  }

  private async registerSavedRowVersions(
    data: ApplyCandidateFilesCommand['data'],
  ): Promise<void> {
    const registrations = new Map<
      string,
      { revisionId: string; tableId: string; rowVersionIds: Set<string> }
    >();
    const seenVersionIds = new Set<string>();
    for (const candidate of [data.head, data.draft]) {
      for (const table of candidate.state.tables) {
        for (const row of table.rows) {
          if (row.fileBlobs.length === 0 || seenVersionIds.has(row.versionId)) {
            continue;
          }
          seenVersionIds.add(row.versionId);
          const key = `${candidate.revisionId}:${table.id}`;
          const registration = registrations.get(key) ?? {
            revisionId: candidate.revisionId,
            tableId: table.id,
            rowVersionIds: new Set<string>(),
          };
          registration.rowVersionIds.add(row.versionId);
          registrations.set(key, registration);
        }
      }
    }

    for (const registration of registrations.values()) {
      await this.fileUsage.registerReferencesForRowVersions({
        revisionId: registration.revisionId,
        tableId: registration.tableId,
        rowVersionIds: [...registration.rowVersionIds],
      });
    }
  }

  private async cleanupDetachedBlobs(
    data: ApplyCandidateFilesCommand['data'],
  ): Promise<void> {
    await this.fileUsage.cleanupBlobsByIds({
      revisionId: data.head.revisionId,
      blobIds: data.cleanupBlobIds,
    });
  }
}
