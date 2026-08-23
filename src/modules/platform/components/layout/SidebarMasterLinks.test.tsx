import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarMasterLinks } from "./SidebarMasterLinks";

/**
 * Os atalhos de master no rodapé da lateral.
 *
 * O que este teste guarda é a REGRESSÃO que motivou a mudança: os três
 * controles moravam dentro do `OrgSwitcher`, no topo da barra, onde a linha
 * `flex` somava quatro itens e transbordava a largura fixa — aparecendo por
 * cima do conteúdo. Aqui eles são linhas de menu, e as duas coisas que não
 * podem voltar a quebrar são: (1) quem NÃO é master não vê nada; (2) no menu
 * recolhido some o rótulo, não o atalho.
 */

const masterRef = { current: { isMaster: false, isOutbounder: false, isFullMaster: false } };

vi.mock("@/modules/identity", () => ({
  useMasterAuth: () => masterRef.current,
  // O indicador tem regra própria (`isFullMaster`) e consulta própria; aqui ele
  // é dublê para o teste falar só do que este componente decide.
  MasterOnlineIndicator: ({ collapsed }: { collapsed?: boolean }) => (
    <div data-testid="online" data-collapsed={String(!!collapsed)} />
  ),
}));

// `TooltipProvider` espelha o app: ele é montado uma vez em `App.tsx:820` e
// serve a lateral inteira — o "Ajuda" recolhido já depende dele do mesmo jeito.
function montar(collapsed = false) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <SidebarMasterLinks collapsed={collapsed} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("SidebarMasterLinks", () => {
  beforeEach(() => {
    masterRef.current = { isMaster: false, isOutbounder: false, isFullMaster: false };
  });

  it("não renderiza nada para quem não é master", () => {
    const { container } = montar();
    expect(container).toBeEmptyDOMElement();
  });

  it("mostra Master, Gestor e o indicador para o master", () => {
    masterRef.current = { isMaster: true, isOutbounder: false, isFullMaster: true };
    montar();

    expect(screen.getByRole("link", { name: "Master" })).toHaveAttribute("href", "/master");
    expect(screen.getByRole("link", { name: "Gestor" })).toHaveAttribute("href", "/insights");
    expect(screen.getByTestId("online")).toBeInTheDocument();
  });

  it("o outbounder entra pela mesma porta com o nome do painel dele", () => {
    masterRef.current = { isMaster: true, isOutbounder: true, isFullMaster: false };
    montar();

    expect(screen.getByRole("link", { name: "Painel Outbound" })).toHaveAttribute("href", "/master");
    expect(screen.queryByRole("link", { name: "Master" })).not.toBeInTheDocument();
  });

  it("recolhido esconde o RÓTULO, nunca o atalho", () => {
    masterRef.current = { isMaster: true, isOutbounder: false, isFullMaster: true };
    montar(true);

    // O link continua alcançável — o nome acessível vem do tooltip/aria, não do
    // texto visível. Some a palavra, não a porta.
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByText("Master")).not.toBeInTheDocument();
    expect(screen.queryByText("Gestor")).not.toBeInTheDocument();
    expect(screen.getByTestId("online")).toHaveAttribute("data-collapsed", "true");
  });
});
