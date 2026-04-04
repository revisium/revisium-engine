import { Injectable } from '@nestjs/common';
import type { JsonValue } from 'src/engine-prisma-types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';

@Injectable()
export class PostgresqlNotificationService {
  constructor(private readonly prismaService: PrismaService) {}

  async notify(notification: string, payload: JsonValue) {
    await this.prismaService.$executeRaw`
      SELECT pg_notify(
        ${notification},
        ${JSON.stringify(payload)}
      )
    `;
  }
}
