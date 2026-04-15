import { Injectable } from '@nestjs/common';
import type { ApiCreateBranchByRevisionIdCommandData } from 'src/features/branch/commands/impl/api-create-branch-by-revision-id.command';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { CurrentVersioningEngineService } from 'src/features/versioning-engine/services/current-versioning-engine.service';
import { CowVersioningEngineService } from 'src/features/versioning-engine/services/cow-versioning-engine.service';
import { ProjectVersioningService } from 'src/features/versioning-engine/services/project-versioning.service';
import { VersioningEngine } from 'src/features/versioning-engine/versioning-engine.interface';

@Injectable()
export class VersioningEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectVersioningService: ProjectVersioningService,
    private readonly currentVersioningEngine: CurrentVersioningEngineService,
    private readonly cowVersioningEngine: CowVersioningEngineService,
  ) {}

  async forProject(projectId: string): Promise<VersioningEngine> {
    const versioningMode =
      await this.projectVersioningService.getVersioningMode(projectId);

    return versioningMode === 'cow'
      ? this.cowVersioningEngine
      : this.currentVersioningEngine;
  }

  async forRevision(revisionId: string): Promise<VersioningEngine> {
    const revision = await this.prisma.revision.findUniqueOrThrow({
      where: { id: revisionId },
      select: { branch: { select: { projectId: true } } },
    });

    return this.forProject(revision.branch.projectId);
  }

  async forBranchCreation(
    data: ApiCreateBranchByRevisionIdCommandData,
  ): Promise<VersioningEngine> {
    return this.forRevision(data.revisionId);
  }
}
