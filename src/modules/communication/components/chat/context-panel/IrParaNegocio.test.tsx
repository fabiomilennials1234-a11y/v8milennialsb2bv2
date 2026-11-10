import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const acesso = vi.hoisted(() => ({ allowed: true, isLoading: false, funis: true }));
vi.mock("@/modules/identity", () => ({
  useCanDo: (acao: string) =>
    acao === "pipeline.view" ? { allowed: acesso.allowed, isLoading: acesso.isLoading, reason: "" } : { allowed: false, isLoading: false, reason: "" },
}));
vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeaturesOptional: () => ({ hasFeature: (f: string) => (f === "funnels" ? acesso.funis : false) }),
}));

import { IrParaNegocio } from "./IrParaNegocio";

const FUNIL = "8106f2dc-e13b-4aaa-8058-05034c1e239a";
const NEGOCIO = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f";

function OndeEstou() {
  const l = useLocation();
  return <p data-testid="local">{l.pathname + l.search + "|" + JSON.stringify(l.state)}</p>;
}

function montar(props: Partial<{ movendo: boolean; etapa: string | null }> = {}) {
  return render(
    <MemoryRouter initialEntries={["/chat-whatsapp"]}>
      <Routes>
        <Route
          path="/chat-whatsapp"
          element={<IrParaNegocio pipelineId={FUNIL} entryId={NEGOCIO} funil="ENVASE" etapa="Em andamento" movendo={false} {...props} />}
        />
        <Route path="/funil/:slug" element={<OndeEstou />} />
      </Routes>
    </MemoryRouter>,
  );
}

const NOME = "Ir para o negócio em ENVASE, etapa Em andamento";

beforeEach(() => {
  acesso.allowed = true;
  acesso.isLoading = false;
  acesso.funis = true;
});

describe("IrParaNegocio", () => {
  it("é um link de verdade para o negócio no board (Ctrl/⌘+clique abre noutra aba)", () => {
    montar();
    const link = screen.getByRole("link", { name: NOME });
    expect(link).toHaveAttribute("href", `/funil/${FUNIL}?negocio=${NEGOCIO}`);
    expect(link).toHaveTextContent("Ir para o negócio");
  });

  it("é um botão grande — largura inteira, 32 px — contra o clique errado", () => {
    montar();
    const link = screen.getByRole("link", { name: NOME });
    expect(link.className).toContain("w-full");
    expect(link.className).toContain("h-8");
  });

  it("clique do mouse leva ao funil com o negócio pedido", () => {
    montar();
    fireEvent.click(screen.getByRole("link", { name: NOME }), { detail: 1 });
    expect(screen.getByTestId("local")).toHaveTextContent(`/funil/${FUNIL}?negocio=${NEGOCIO}|null`);
  });

  it("ativado pelo teclado (Enter): o board é avisado para levar o foco até o card", () => {
    montar();
    fireEvent.click(screen.getByRole("link", { name: NOME }), { detail: 0 });
    expect(screen.getByTestId("local")).toHaveTextContent(`/funil/${FUNIL}?negocio=${NEGOCIO}|{"viaTeclado":true}`);
  });

  it("Ctrl/⌘/Shift+Enter: fica com o navegador (outra aba/janela), sem navegar nesta", () => {
    montar();
    const link = screen.getByRole("link", { name: NOME });
    // Roda DEPOIS do onClick do React (bolha até a window): registra se o
    // componente tomou o clique para si e cancela a navegação do jsdom.
    const tomado: boolean[] = [];
    const observar = (e: Event) => {
      tomado.push(e.defaultPrevented);
      e.preventDefault();
    };
    window.addEventListener("click", observar);
    try {
      for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
        link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0, ...mod }));
      }
    } finally {
      window.removeEventListener("click", observar);
    }
    expect(tomado).toEqual([false, false, false]);
    expect(screen.queryByTestId("local")).toBeNull();
  });

  it("sem a etapa (inativa), o nome acessível diz só o funil", () => {
    montar({ etapa: null });
    expect(screen.getByRole("link", { name: "Ir para o negócio em ENVASE" })).toBeInTheDocument();
  });

  it("move da etapa em curso na linha: aguarda, não navega", () => {
    montar({ movendo: true });
    const link = screen.getByRole("link", { name: NOME });
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("title", "Aguarde a etapa terminar de mudar");
    fireEvent.click(link, { detail: 1 });
    expect(screen.queryByTestId("local")).toBeNull();
  });

  it("sem permissão de ver o funil: o botão não existe (o funil não existe para a pessoa)", () => {
    acesso.allowed = false;
    montar();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("Ir para o negócio")).toBeNull();
  });

  it("plano sem funis: também não existe", () => {
    acesso.funis = false;
    montar();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("permissão carregando: reserva a linha, sem piscar um botão apagado", () => {
    acesso.allowed = false;
    acesso.isLoading = true;
    const { container } = montar();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector('[data-testid="ir-para-negocio-reserva"]')).not.toBeNull();
  });
});
