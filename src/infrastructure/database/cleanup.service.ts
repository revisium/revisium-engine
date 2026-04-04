import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  async cleanOrphanedData(): Promise<{ tables: number; rows: number }> {
    const tablesResult = await this.prisma.table.deleteMany({
      where: {
        revisions: { none: {} },
      },
    });

    if (tablesResult.count) {
      this.logger.log(`Deleted ${tablesResult.count} orphaned tables`);
    }

    const rowsResult = await this.prisma.row.deleteMany({
      where: {
        tables: { none: {} },
      },
    });

    if (rowsResult.count) {
      this.logger.log(`Deleted ${rowsResult.count} orphaned rows`);
    }

    return { tables: tablesResult.count, rows: rowsResult.count };
  }
}
