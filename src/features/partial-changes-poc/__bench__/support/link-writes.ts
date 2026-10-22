import { VersionWriter } from 'src/features/partial-changes-poc/write/version-writer.service';
import type { PartialChangesTestKit } from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';

export interface TableLinkWrites {
  tableId: string;
  tableVersionId: string;
  newVersion: boolean;
  linksWritten: number;
  linksRemoved: number;
}

type AnyMethod = (...args: unknown[]) => Promise<unknown>;

export class LinkWriteRecorder {
  private readonly created = new Set<string>();
  private readonly linked = new Map<string, number>();
  private readonly unlinked = new Map<string, number>();

  constructor(kit: PartialChangesTestKit) {
    const writer = kit.module.get(VersionWriter) as unknown as Record<
      string,
      AnyMethod
    >;
    this.wrap(writer, 'createTableVersion', async (call) => {
      const versionId = (await call()) as string;
      this.created.add(versionId);
      return versionId;
    });
    this.wrap(writer, 'linkRows', (call, args) => {
      this.add(this.linked, args);
      return call();
    });
    this.wrap(writer, 'unlinkRows', (call, args) => {
      this.add(this.unlinked, args);
      return call();
    });
  }

  reset(): void {
    this.created.clear();
    this.linked.clear();
    this.unlinked.clear();
  }

  async report(prisma: PrismaService): Promise<TableLinkWrites[]> {
    const versionIds = [
      ...new Set([
        ...this.created,
        ...this.linked.keys(),
        ...this.unlinked.keys(),
      ]),
    ];
    if (versionIds.length === 0) {
      return [];
    }
    const tables = await prisma.$queryRaw<
      { versionId: string; id: string; links: number }[]
    >`
      SELECT t."versionId", t."id",
             (SELECT count(*)::int FROM "_RowToTable" rt WHERE rt."B" = t."versionId") AS "links"
      FROM "Table" t WHERE t."versionId" = ANY(${versionIds}::text[])
    `;
    return tables
      .map((table) => ({
        tableId: table.id,
        tableVersionId: table.versionId,
        newVersion: this.created.has(table.versionId),
        linksWritten: this.created.has(table.versionId)
          ? table.links
          : (this.linked.get(table.versionId) ?? 0),
        linksRemoved: this.unlinked.get(table.versionId) ?? 0,
      }))
      .sort((a, b) => (a.tableId < b.tableId ? -1 : 1));
  }

  private add(target: Map<string, number>, args: unknown[]): void {
    const [tableVersionId, rowVersionIds] = args as [string, readonly string[]];
    target.set(
      tableVersionId,
      (target.get(tableVersionId) ?? 0) + rowVersionIds.length,
    );
  }

  private wrap(
    owner: Record<string, AnyMethod>,
    method: string,
    around: (call: () => Promise<unknown>, args: unknown[]) => Promise<unknown>,
  ): void {
    const original = owner[method];
    if (!original) {
      throw new Error(`VersionWriter.${method} is not a method`);
    }
    owner[method] = function (this: unknown, ...args: unknown[]) {
      return around(() => original.apply(this, args), args);
    };
  }
}
