import { sql, type Sql } from 'src/engine-prisma-types';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';

interface CommittedVersion {
  readonly subject: string;
  readonly mutable: boolean;
  readonly checksum: string;
}

interface DuplicateRowId {
  readonly tableVersionId: string;
  readonly rowId: string;
}

export class CommittedVersionsGuard {
  private readonly branchIds = new Set<string>();
  private readonly firstChecksums = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  public track(branchId: string): void {
    this.branchIds.add(branchId);
  }

  public async verify(): Promise<void> {
    const violations: string[] = [];

    for (const branchId of this.branchIds) {
      violations.push(...(await this.violationsIn(branchId)));
    }

    expect(violations).toEqual([]);
  }

  public async verifyAndForget(): Promise<void> {
    try {
      await this.verify();
    } finally {
      this.forget();
    }
  }

  public forget(): void {
    this.branchIds.clear();
    this.firstChecksums.clear();
  }

  private async violationsIn(branchId: string): Promise<string[]> {
    const versions = await this.readCommittedVersions(branchId);
    const duplicates = await this.readDuplicateRowIds(branchId);
    const violations = [
      ...versions
        .filter((version) => version.mutable)
        .map((version) => `${version.subject} is mutable`),
      ...versions
        .filter((version) => this.changedSinceFirstObservation(version))
        .map((version) => `${version.subject} changed`),
      ...duplicates.map(
        ({ tableVersionId, rowId }) =>
          `committed table version ${tableVersionId} holds two rows with id ${rowId}`,
      ),
    ];

    this.rememberFirstObservations(versions);

    return violations;
  }

  private changedSinceFirstObservation(version: CommittedVersion): boolean {
    const first = this.firstChecksums.get(version.subject);

    return first !== undefined && first !== version.checksum;
  }

  private rememberFirstObservations(versions: CommittedVersion[]): void {
    for (const { subject, checksum } of versions) {
      if (!this.firstChecksums.has(subject)) {
        this.firstChecksums.set(subject, checksum);
      }
    }
  }

  private readCommittedVersions(branchId: string): Promise<CommittedVersion[]> {
    return this.prisma.$queryRaw<CommittedVersion[]>(sql`
      WITH ${committedLinks(branchId)}
      SELECT 'table links of committed revision ' || r."id" AS "subject",
             FALSE AS "mutable",
             md5(ARRAY(
               SELECT rt."B" FROM "_RevisionToTable" rt
               WHERE rt."A" = r."id" ORDER BY rt."B"
             )::text) AS "checksum"
      FROM committed_revisions r
      UNION ALL
      SELECT 'committed table version ' || t."versionId", NOT t."readonly",
             md5(jsonb_build_array(to_jsonb(t), ARRAY(
               SELECT rt."A" FROM "_RowToTable" rt
               WHERE rt."B" = t."versionId" ORDER BY rt."A"
             ))::text)
      FROM "Table" t
      WHERE t."versionId" IN (SELECT "versionId" FROM committed_tables)
      UNION ALL
      SELECT 'committed row version ' || r."versionId", NOT r."readonly",
             md5(jsonb_build_array(to_jsonb(r), ARRAY(
               SELECT fb."A" FROM "_FileBlobToRow" fb
               WHERE fb."B" = r."versionId" ORDER BY fb."A"
             ))::text)
      FROM "Row" r
      WHERE r."versionId" IN (
        SELECT rt."A" FROM "_RowToTable" rt
        WHERE rt."B" IN (SELECT "versionId" FROM committed_tables)
      )
    `);
  }

  private readDuplicateRowIds(branchId: string): Promise<DuplicateRowId[]> {
    return this.prisma.$queryRaw<DuplicateRowId[]>(sql`
      WITH ${committedLinks(branchId)}
      SELECT rt."B" AS "tableVersionId", r."id" AS "rowId"
      FROM "_RowToTable" rt
      JOIN "Row" r ON r."versionId" = rt."A"
      WHERE rt."B" IN (SELECT "versionId" FROM committed_tables)
      GROUP BY rt."B", r."id"
      HAVING count(*) > 1
    `);
  }
}

function committedLinks(branchId: string): Sql {
  return sql`
    committed_revisions AS (
      SELECT "id" FROM "Revision"
      WHERE "branchId" = ${branchId} AND NOT "isDraft"
    ),
    committed_tables AS (
      SELECT DISTINCT rt."B" AS "versionId" FROM "_RevisionToTable" rt
      WHERE rt."A" IN (SELECT "id" FROM committed_revisions)
    )
  `;
}
