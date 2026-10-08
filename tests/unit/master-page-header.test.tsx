/**
 * A moldura da área Master mora no cabeçalho de cada PÁGINA.
 *
 * V5: a pílula dos grupos vai para a barra superior pelo `tabs` do
 * `PageHeader`, que só a publica junto com um título — por isso a moldura
 * (pílula, selo "Modo master", sub-páginas, faixa vermelha) é do
 * `MasterPageHeader`, e não do `MasterLayout`. O que este arquivo trava:
 *
 *   1. **toda página montada sob /master usa o `MasterPageHeader`**, nunca o
 *      `PageHeader` cru. A que esquecer perde a navegação do Master sem erro
 *      nenhum. Lê a fonte, como `nav-leads-topbar.test.ts` faz com o App;
 *   2. **um título só, e a moldura na ordem do mockup**: título com o selo
 *      entre as ações, sub-páginas e faixa depois dele, o grupo da rota
 *      selecionado na pílula.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/modules/identity/master/hooks/useMasterAuth", () => ({
  useMasterAuth: () => ({
    masterUser: { notes: "ui-preview" },
    isOutbounder: false,
    permissions: { all: true },
  }),
}));

import { MasterPageHeader } from "@/modules/identity/master/components/MasterPageHeader";

const raiz = resolve(__dirname, "../..");
const fonteApp = readFileSync(resolve(raiz, "src/App.tsx"), "utf-8");

// Insights é master, mas tem chrome próprio e fica fora do MasterLayout.
// `centrais/` entra: as 5 centrais da Área Dev moram numa subpasta.
const paginas = [...fonteApp.matchAll(/import\("@\/modules\/identity\/master\/pages\/((?:centrais\/)?\w+)"\)/g)]
  .map((m) => m[1])
  .filter((nome) => nome !== "MasterInsights");

// Meta — ativos delega o cabeçalho inteiro ao único componente que ela monta.
const fonteDa = (nome: string) =>
  readFileSync(
    resolve(
      raiz,
      nome === "MasterMetaAssets"
        ? "src/modules/identity/master/components/MetaBindingTab.tsx"
        : `src/modules/identity/master/pages/${nome}.tsx`,
    ),
    "utf-8",
  );

describe("páginas master usam o MasterPageHeader", () => {
  it("o App foi lido e monta as páginas master", () => {
    // Guarda contra o teste virar vácuo se o import mudar de forma.
    expect(paginas.length).toBeGreaterThan(10);
  });

  it.each(paginas)("%s usa o MasterPageHeader, não o PageHeader cru", (nome) => {
    const fonte = fonteDa(nome);
    expect(fonte).not.toMatch(/@\/components\/ui\/page-header/);
    expect(fonte).toMatch(/<MasterPageHeader\b/);
  });
});

describe("MasterPageHeader", () => {
  const montar = (rota: string) =>
    render(
      <MemoryRouter initialEntries={[rota]}>
        <MasterPageHeader title="Usuários ativos" actions={<button type="button">Atualizar</button>} />
      </MemoryRouter>,
    );

  it("tem um título só, com o selo do modo master entre as ações", () => {
    montar("/master/usuarios-ativos");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Usuários ativos" })).toBeTruthy();
    expect(screen.getByText("Modo master")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeTruthy();
  });

  it("seleciona o grupo da rota na pílula e a página no segmentado", () => {
    montar("/master/usuarios-ativos");
    const grupos = screen.getByRole("tablist", { name: "Seções do Master" });
    // Usuários ativos é aba da central Organizações (board das 5 centrais).
    expect(within(grupos).getByRole("tab", { name: "Organizações" }).getAttribute("aria-selected")).toBe("true");

    const paginasDoGrupo = screen.getByRole("navigation", { name: "Páginas de Organizações" });
    expect(within(paginasDoGrupo).getByRole("link", { name: "Usuários ativos" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("põe a faixa vermelha depois do título", () => {
    montar("/master/operacao");
    const titulo = screen.getByRole("heading", { level: 1 });
    const faixa = screen.getByRole("note");
    expect(faixa.textContent).toMatch(/vale para todas as organizações/);
    expect(titulo.compareDocumentPosition(faixa) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Central de uma página só (Operação) não ganha segmentado.
    expect(screen.queryByRole("navigation", { name: /Páginas de/ })).toBeNull();
  });
});
