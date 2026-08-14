-- Stable logical identities are intentionally non-unique: copy-on-write
-- versions of one Table or Row share the same createdId.
CREATE INDEX "Table_createdId_idx" ON "Table"("createdId");
CREATE INDEX "Row_createdId_idx" ON "Row"("createdId");
