import { nanoid } from 'nanoid';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export async function withRowDeleteFailure<T>(
  prisma: PrismaService,
  createdId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const suffix = nanoid()
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
  const functionName = `fail_detached_row_delete_${suffix}`;
  const triggerName = `fail_detached_row_delete_${suffix}`;
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."createdId" = '${createdId}' THEN RAISE EXCEPTION 'simulated detached row cleanup failure'; END IF; RETURN OLD; END; $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER "${triggerName}" BEFORE DELETE ON "Row" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`,
  );
  try {
    return await operation();
  } finally {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${triggerName}" ON "Row"`,
    );
    await prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${functionName}"()`,
    );
  }
}

export function cleanupAfterRowRelink<T>(
  transactions: TransactionPrismaService,
  tableVersionId: string,
  rowVersionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return transactions.run(async () => {
    const tx = transactions.getTransaction();
    const originalDeleteMany = tx.row.deleteMany.bind(tx.row);
    const delegate = tx.row as unknown as {
      deleteMany: (
        args: Parameters<typeof tx.row.deleteMany>[0],
      ) => Promise<unknown>;
    };
    delegate.deleteMany = async (args) => {
      await tx.table.update({
        where: { versionId: tableVersionId },
        data: { rows: { connect: { versionId: rowVersionId } } },
      });
      return originalDeleteMany(args);
    };
    try {
      return await operation();
    } finally {
      delegate.deleteMany = originalDeleteMany as typeof delegate.deleteMany;
    }
  });
}

export function writeAfterCreatedRowDisappears<T>(
  transactions: TransactionPrismaService,
  operation: () => Promise<T>,
): Promise<T> {
  return transactions.run(async () => {
    const tx = transactions.getTransaction();
    const originalCreate = tx.row.create.bind(tx.row);
    const delegate = tx.row as unknown as {
      create: (
        args: Parameters<typeof tx.row.create>[0],
      ) => Promise<{ versionId: string }>;
    };
    delegate.create = async (args) => {
      const created = await originalCreate(args);
      await tx.row.delete({ where: { versionId: created.versionId } });
      return created;
    };
    try {
      return await operation();
    } finally {
      delegate.create = originalCreate as unknown as typeof delegate.create;
    }
  });
}
