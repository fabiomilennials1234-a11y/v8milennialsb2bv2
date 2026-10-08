import React, { type ComponentType, type PropsWithChildren } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Navigate, Route, Routes, useParams } from "react-router-dom";

afterEach(cleanup);

// Execute the real route shell from both published interfaces. The large board
// and its panels are replaced at their boundary; no routing condition is copied.
// Production repro: /funil/confirmacao redirects a master to /funis, while the
// same board's UUID opens all nine stages in the same session and organization.
function loadRouteShell(sourcePath: string, featureAccess: boolean): ComponentType {
  const source = readFileSync(resolve(process.cwd(), sourcePath), "utf8");
  const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const shell = ast.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "FunilPage",
  );
  if (!shell) throw new Error(`Missing actual FunilPage route shell: ${sourcePath}`);
  const javascript = ts.transpileModule(
    shell.getText(ast).replace("export default ", ""),
    { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const PassThrough = ({ children }: PropsWithChildren) => <>{children}</>;
  const Panel = () => null;
  const Board = () => <h1>Etapas do funil</h1>;
  const dependencies = {
    React, useParams, Navigate,
    useOrgFeatures: () => ({ hasFeature: () => featureAccess }),
    LeadPanelProvider: PassThrough, DealPanelProvider: PassThrough,
    LeadPanelLayout: PassThrough, DealCardPanel: Panel, LeadCardPanel: Panel,
    FunilPageInner: Board,
  };
  return new Function(...Object.keys(dependencies), `${javascript}; return FunilPage;`)(
    ...Object.values(dependencies),
  ) as ComponentType;
}

describe.each([
  ["V5", "src/modules/pipelines/pages/Funil.tsx"],
  ["classic", "classic/src/modules/pipelines/pages/Funil.tsx"],
])("scheduling route in %s", (_label, path) => {
  it.each([
    ["master or loading", true, "confirmacao"],
    ["ordinary member", false, "confirmacao"],
    ["master UUID", true, "9695d374-8648-4b59-94d8-f9d6f348ba6b"],
    ["other funnel", true, "whatsapp"],
  ])("opens the existing board for %s", (_role, access, slug) => {
    const Page = loadRouteShell(path, access);
    render(
      <MemoryRouter initialEntries={[`/funil/${slug}`]}>
        <Routes>
          <Route path="/funil/:slug" element={<Page />} />
          <Route path="/funis" element={<h1>Lista de funis</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByRole("heading", { name: "Etapas do funil" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Lista de funis" })).toBeNull();
  });
});
