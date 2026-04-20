-- AlterTable
ALTER TABLE "FileBlob" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "FileBlob_deletedAt_idx" ON "FileBlob"("deletedAt");
