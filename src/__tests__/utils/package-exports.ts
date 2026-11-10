import { readFileSync } from 'fs';
import * as ts from 'typescript';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

export interface ExportedNames {
  readonly types: readonly string[];
  readonly values: readonly string[];
}

interface ExportedName {
  readonly name: string;
  readonly typeOnly: boolean;
}

// Reads the names an entry re-exports from the modules under a prefix. The entry may hold only named re-exports
// (`export { … } from '…'`), so every exported name is visible here; any other export form is refused.
export function namesExportedFrom(
  entryPath: string,
  modulePrefix: string,
): ExportedNames {
  const entry = ts.createSourceFile(
    entryPath,
    readFileSync(entryPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const names = entry.statements
    .filter(isExporting)
    .map(namedReExportOf)
    .filter((declaration) =>
      declaration.moduleSpecifier.text.startsWith(modulePrefix),
    )
    .flatMap(exportedNamesOf);

  return {
    types: sortedNamesOf(names.filter(({ typeOnly }) => typeOnly)),
    values: sortedNamesOf(names.filter(({ typeOnly }) => !typeOnly)),
  };
}

type NamedReExport = ts.ExportDeclaration & {
  readonly moduleSpecifier: ts.StringLiteral;
  readonly exportClause: ts.NamedExports;
};

function isExporting(statement: ts.Statement): boolean {
  if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) {
    return true;
  }

  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      ({ kind }) => kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

function namedReExportOf(statement: ts.Statement): NamedReExport {
  if (
    ts.isExportDeclaration(statement) &&
    statement.moduleSpecifier !== undefined &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.exportClause !== undefined &&
    ts.isNamedExports(statement.exportClause)
  ) {
    return statement as NamedReExport;
  }

  throw new Error(
    `Only named re-exports can be listed: ${statement.getText()}`,
  );
}

function exportedNamesOf(declaration: NamedReExport): ExportedName[] {
  return declaration.exportClause.elements.map((element) => ({
    name: element.name.text,
    typeOnly: declaration.isTypeOnly || element.isTypeOnly,
  }));
}

function sortedNamesOf(names: readonly ExportedName[]): string[] {
  return names.map(({ name }) => name).sort(compareCodePoints);
}
