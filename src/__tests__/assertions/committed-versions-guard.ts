import { sql } from 'src/engine-prisma-types';
import type { PrismaService } from 'src/infrastructure/database/prisma.service';

type SubjectKind = 'revision' | 'table version' | 'row version';

interface Subject {
  readonly kind: SubjectKind;
  readonly id: string;
}

interface SubjectState extends Subject {
  readonly committed: boolean;
  readonly mutable: boolean;
  readonly checksum: string;
}

interface DuplicateRowId {
  readonly tableVersionId: string;
  readonly rowId: string;
}

export class CommittedVersionsGuard {
  private readonly branchIds = new Set<string>();
  private readonly firstObservations = new Map<string, SubjectState>();

  constructor(private readonly prisma: PrismaService) {}

  public track(branchId: string): void {
    this.branchIds.add(branchId);
  }

  public async verify(): Promise<void> {
    const subjects = await this.subjectsToVerify();
    const states = await this.readStates(subjects);
    const duplicates = await this.readDuplicateRowIds(subjects);
    const violations = [
      ...this.disappearedSubjects(states),
      ...states.flatMap((state) => this.violationsOf(state)),
      ...duplicates.map(
        ({ tableVersionId, rowId }) =>
          `committed table version ${tableVersionId} holds two rows with id ${rowId}`,
      ),
    ];

    this.rememberFirstObservations(states);

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
    this.firstObservations.clear();
  }

  private async subjectsToVerify(): Promise<Subject[]> {
    const subjects = new Map<string, Subject>(this.firstObservations);

    for (const branchId of this.branchIds) {
      for (const subject of await this.discoverCommittedSubjects(branchId)) {
        subjects.set(subjectName(subject), subject);
      }
    }

    return [...subjects.values()];
  }

  private disappearedSubjects(states: readonly SubjectState[]): string[] {
    const present = new Set(states.map(subjectName));

    return [...this.firstObservations.keys()]
      .filter((name) => !present.has(name))
      .map((name) => `${name} disappeared`);
  }

  private violationsOf(state: SubjectState): string[] {
    const name = subjectName(state);
    const first = this.firstObservations.get(name);
    const violations: string[] = [];

    if (!state.committed) {
      violations.push(`${name} is no longer committed`);
    }

    if (state.mutable) {
      violations.push(`${name} is mutable`);
    }

    if (first && first.checksum !== state.checksum) {
      violations.push(`${name} changed`);
    }

    return violations;
  }

  private rememberFirstObservations(states: readonly SubjectState[]): void {
    for (const state of states) {
      const name = subjectName(state);

      if (!this.firstObservations.has(name)) {
        this.firstObservations.set(name, state);
      }
    }
  }

  private discoverCommittedSubjects(branchId: string): Promise<Subject[]> {
    return this.prisma.$queryRaw<Subject[]>(sql`
      WITH committed_revisions AS (
        SELECT "id" FROM "Revision"
        WHERE "branchId" = ${branchId} AND NOT "isDraft"
      ),
      committed_tables AS (
        SELECT DISTINCT rt."B" AS "versionId" FROM "_RevisionToTable" rt
        WHERE rt."A" IN (SELECT "id" FROM committed_revisions)
      )
      SELECT 'revision' AS "kind", "id" FROM committed_revisions
      UNION ALL
      SELECT 'table version', "versionId" FROM committed_tables
      UNION ALL
      SELECT DISTINCT 'row version', rt."A" FROM "_RowToTable" rt
      WHERE rt."B" IN (SELECT "versionId" FROM committed_tables)
    `);
  }

  private readStates(subjects: readonly Subject[]): Promise<SubjectState[]> {
    return this.prisma.$queryRaw<SubjectState[]>(sql`
      SELECT 'revision' AS "kind", r."id", NOT r."isDraft" AS "committed",
             FALSE AS "mutable",
             md5(ARRAY(
               SELECT rt."B" FROM "_RevisionToTable" rt
               WHERE rt."A" = r."id" ORDER BY rt."B"
             )::text) AS "checksum"
      FROM "Revision" r
      WHERE r."id" = ANY(${idsOf(subjects, 'revision')}::text[])
      UNION ALL
      SELECT 'table version', t."versionId", TRUE, NOT t."readonly",
             md5(jsonb_build_array(to_jsonb(t), ARRAY(
               SELECT rt."A" FROM "_RowToTable" rt
               WHERE rt."B" = t."versionId" ORDER BY rt."A"
             ))::text)
      FROM "Table" t
      WHERE t."versionId" = ANY(${idsOf(subjects, 'table version')}::text[])
      UNION ALL
      SELECT 'row version', r."versionId", TRUE, NOT r."readonly",
             md5(jsonb_build_array(to_jsonb(r), ARRAY(
               SELECT fb."A" FROM "_FileBlobToRow" fb
               WHERE fb."B" = r."versionId" ORDER BY fb."A"
             ))::text)
      FROM "Row" r
      WHERE r."versionId" = ANY(${idsOf(subjects, 'row version')}::text[])
    `);
  }

  private readDuplicateRowIds(
    subjects: readonly Subject[],
  ): Promise<DuplicateRowId[]> {
    return this.prisma.$queryRaw<DuplicateRowId[]>(sql`
      SELECT rt."B" AS "tableVersionId", r."id" AS "rowId"
      FROM "_RowToTable" rt
      JOIN "Row" r ON r."versionId" = rt."A"
      WHERE rt."B" = ANY(${idsOf(subjects, 'table version')}::text[])
      GROUP BY rt."B", r."id"
      HAVING count(*) > 1
    `);
  }
}

function subjectName({ kind, id }: Subject): string {
  return `committed ${kind} ${id}`;
}

function idsOf(subjects: readonly Subject[], kind: SubjectKind): string[] {
  return subjects
    .filter((subject) => subject.kind === kind)
    .map((subject) => subject.id);
}
