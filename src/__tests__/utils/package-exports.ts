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

const ALL_NAMES = '*';

export function namesExportedFrom(
  entryPath: string,
  modulePrefix: string,
): ExportedNames {
  const entry = ts.createSourceFile(
    entryPath,
    readFileSync(entryPath, 'utf8'),
    ts.ScriptTarget.Latest,
  );
  const names = entry.statements
    .filter(ts.isExportDeclaration)
    .filter((declaration) =>
      moduleSpecifierOf(declaration).startsWith(modulePrefix),
    )
    .flatMap(exportedNamesOf);

  return {
    types: sortedNamesOf(names.filter(({ typeOnly }) => typeOnly)),
    values: sortedNamesOf(names.filter(({ typeOnly }) => !typeOnly)),
  };
}

function moduleSpecifierOf(declaration: ts.ExportDeclaration): string {
  const specifier = declaration.moduleSpecifier;

  if (!specifier || !ts.isStringLiteral(specifier)) {
    return '';
  }

  return specifier.text;
}

function exportedNamesOf(declaration: ts.ExportDeclaration): ExportedName[] {
  const clause = declaration.exportClause;

  if (!clause || !ts.isNamedExports(clause)) {
    return [{ name: ALL_NAMES, typeOnly: declaration.isTypeOnly }];
  }

  return clause.elements.map((element) => ({
    name: element.name.text,
    typeOnly: declaration.isTypeOnly || element.isTypeOnly,
  }));
}

function sortedNamesOf(names: readonly ExportedName[]): string[] {
  return names.map(({ name }) => name).sort(compareCodePoints);
}
