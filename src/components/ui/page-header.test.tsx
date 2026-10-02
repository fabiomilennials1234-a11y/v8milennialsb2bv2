/**
 * PageHeader — contrato do cabeçalho de página do V5.
 *
 * O que importa aqui é o que as ~25 telas assumem dele: o título é o <h1> da
 * página, `back` com rota navega para o "pai" certo, e `secondaryActions`
 * continua alcançável nos dois formatos (pílulas no desktop, menu `⋯` no
 * celular) — no jsdom os dois existem no DOM; a mídia só decide o que aparece.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Download, Upload } from "lucide-react";

import { PageHeader } from "./page-header";

function renderAt(ui: React.ReactElement, path = "/atual") {
  return render(
    <MemoryRouter initialEntries={["/pai", path]} initialIndex={1}>
      <Routes>
        <Route path="/atual" element={ui} />
        <Route path="/pai" element={<p>Tela pai</p>} />
        <Route path="/outra" element={<p>Outra tela</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PageHeader", () => {
  it("o título é o h1 da página e o subtítulo aparece junto", () => {
    renderAt(<PageHeader title="Leads" subtitle="Da primeira conversa à próxima compra." />);
    expect(screen.getByRole("heading", { level: 1, name: "Leads" })).toBeInTheDocument();
    expect(screen.getByText("Da primeira conversa à próxima compra.")).toBeInTheDocument();
  });

  it("sem `back`, não há botão de voltar", () => {
    renderAt(<PageHeader title="Leads" />);
    expect(screen.queryByRole("button", { name: "Voltar" })).toBeNull();
  });

  it("`back` com rota navega para ela, não para o histórico", async () => {
    const user = userEvent.setup();
    renderAt(<PageHeader title="Cliente" back="/outra" />);
    await user.click(screen.getByRole("button", { name: "Voltar" }));
    expect(screen.getByText("Outra tela")).toBeInTheDocument();
  });

  it("`back` verdadeiro volta no histórico", async () => {
    const user = userEvent.setup();
    renderAt(<PageHeader title="Cliente" back />);
    await user.click(screen.getByRole("button", { name: "Voltar" }));
    expect(screen.getByText("Tela pai")).toBeInTheDocument();
  });

  describe("secondaryActions", () => {
    it("viram pílulas com o rótulo como nome acessível, e a ação dispara", async () => {
      const user = userEvent.setup();
      const importar = vi.fn();
      renderAt(
        <PageHeader
          title="Leads"
          secondaryActions={[
            { label: "Importar", icon: Upload, onSelect: importar },
            { label: "Exportar", icon: Download, onSelect: vi.fn() },
          ]}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Importar" }));
      expect(importar).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Exportar" })).toBeInTheDocument();
    });

    it("ação desabilitada fica desabilitada também na pílula", () => {
      renderAt(
        <PageHeader title="Leads" secondaryActions={[{ label: "Exportar", onSelect: vi.fn(), disabled: true }]} />,
      );
      expect(screen.getByRole("button", { name: "Exportar" })).toBeDisabled();
    });

    it("o menu do celular tem nome próprio e leva as mesmas ações", async () => {
      const user = userEvent.setup();
      const exportar = vi.fn();
      renderAt(
        <PageHeader
          title="Leads"
          secondaryActionsLabel="Mais ações de leads"
          secondaryActions={[
            { label: "Importar", onSelect: vi.fn() },
            { label: "Exportar", onSelect: exportar },
          ]}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Mais ações de leads" }));
      const itens = await screen.findAllByRole("menuitem");
      expect(itens.map((i) => i.textContent)).toEqual(["Importar", "Exportar"]);
      await user.click(screen.getByRole("menuitem", { name: "Exportar" }));
      expect(exportar).toHaveBeenCalledTimes(1);
    });

    it("sem ações secundárias, não nasce menu vazio", () => {
      renderAt(<PageHeader title="Leads" actions={<button type="button">Novo lead</button>} />);
      expect(screen.queryByRole("button", { name: "Mais ações" })).toBeNull();
      expect(screen.getByRole("button", { name: "Novo lead" })).toBeInTheDocument();
    });
  });
});
