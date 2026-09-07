// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOTS = [join(process.cwd(), "src"), join(process.cwd(), "supabase/functions")];
const FORBIDDEN = new Set([
  "pipe_whatsapp",
  "pipe_confirmacao",
  "pipe_propostas",
  "custom_pipe_entries",
  "custom_pipelines",
  "custom_pipeline_stages",
]);
const FORBIDDEN_EMBED = new RegExp(
  `(?:^|[:,\\s])(${[...FORBIDDEN].join("|")})(?:!|\\s*\\()`,
  "m",
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(?:ts|tsx)$/.test(entry.name)) return [];
    if (/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)) return [];
    if (entry.name === "types.ts" || entry.name === "database.types.ts") return [];
    return [path];
  });
}

function literalValues(
  node: ts.Expression,
  bindings: Map<string, ts.Expression>,
  seen = new Set<string>(),
): Set<string> {
  if (ts.isStringLiteralLike(node)) return new Set([node.text]);
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return literalValues(node.expression, bindings, seen);
  }
  if (ts.isConditionalExpression(node)) {
    return new Set([
      ...literalValues(node.whenTrue, bindings, seen),
      ...literalValues(node.whenFalse, bindings, seen),
    ]);
  }
  if (ts.isIdentifier(node) && !seen.has(node.text)) {
    const initializer = bindings.get(node.text);
    if (!initializer) return new Set();
    const nextSeen = new Set(seen);
    nextSeen.add(node.text);
    return literalValues(initializer, bindings, nextSeen);
  }
  return new Set();
}

function hasLegacyDynamicRelation(
  node: ts.Expression,
  bindings: Map<string, ts.Expression>,
  seen = new Set<string>(),
): boolean {
  if (ts.isTemplateExpression(node)) {
    return node.head.text === "pipe_"
      || [...FORBIDDEN].some((relation) => node.getText().includes(relation));
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return hasLegacyDynamicRelation(node.expression, bindings, seen);
  }
  if (ts.isConditionalExpression(node)) {
    return hasLegacyDynamicRelation(node.whenTrue, bindings, seen)
      || hasLegacyDynamicRelation(node.whenFalse, bindings, seen);
  }
  if (ts.isIdentifier(node) && !seen.has(node.text)) {
    const initializer = bindings.get(node.text);
    if (!initializer) return false;
    const nextSeen = new Set(seen);
    nextSeen.add(node.text);
    return hasLegacyDynamicRelation(initializer, bindings, nextSeen);
  }
  return false;
}

describe("espelhos sem leitores de runtime", () => {
  it("bloqueia .from(), relação dinâmica e embed para as seis relações legadas", () => {
    const offenders: string[] = [];

    for (const file of ROOTS.flatMap(sourceFiles)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const bindings = new Map<string, ts.Expression>();

      const collectBindings = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
          bindings.set(node.name.text, node.initializer);
        }
        ts.forEachChild(node, collectBindings);
      };
      collectBindings(source);

      const inspect = (node: ts.Node) => {
        if (
          ts.isCallExpression(node)
          && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === "from"
          && node.arguments[0]
        ) {
          if (hasLegacyDynamicRelation(node.arguments[0], bindings)) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
            offenders.push(`${relative(process.cwd(), file)}:${line + 1} -> relação legada dinâmica`);
          }
          for (const relation of literalValues(node.arguments[0], bindings)) {
            if (!FORBIDDEN.has(relation)) continue;
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
            offenders.push(`${relative(process.cwd(), file)}:${line + 1} -> ${relation}`);
          }
        }
        if (
          ts.isCallExpression(node)
          && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === "select"
          && node.arguments[0]
        ) {
          for (const columns of literalValues(node.arguments[0], bindings)) {
            const match = columns.match(FORBIDDEN_EMBED);
            if (!match) continue;
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
            offenders.push(`${relative(process.cwd(), file)}:${line + 1} -> embed ${match[1]}`);
          }
        }
        ts.forEachChild(node, inspect);
      };
      inspect(source);
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
