import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { VersioningMode } from 'src/features/versioning-engine/types/versioning-mode.types';

@Injectable()
export class ProjectVersioningService {
  constructor(private readonly prisma: PrismaService) {}

  async getVersioningMode(projectId: string): Promise<VersioningMode> {
    const config = await this.prisma.projectVersioningConfig.findUnique({
      where: { projectId },
      select: { versioningMode: true },
    });

    return config?.versioningMode ?? 'current';
  }

  async setVersioningMode(
    projectId: string,
    versioningMode: VersioningMode,
  ): Promise<void> {
    await this.prisma.projectVersioningConfig.upsert({
      where: { projectId },
      create: { projectId, versioningMode },
      update: { versioningMode },
    });
  }
}
