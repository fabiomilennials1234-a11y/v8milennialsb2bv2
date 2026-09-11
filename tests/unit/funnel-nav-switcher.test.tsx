/**
 * Navegação entre funis pelo registro canônico `pipelines`.
 *
 * O nome, a rota e a identidade vêm do funil escolhido pelo usuário. O tipo
 * histórico do registro não cria grupos nem muda seu comportamento.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, fireEvent } from "@testing-library/react";
import { Kanban, List, BarChart3 } from "lucide-react";

// ── Dependências do useFunnelOptions ────────────────────────────────────────
const temporaryRef: { value: unknown[]; loading: boolean } = { value: [], loading: false };
vi.mock("@/modules/pipelines/hooks/custom/useCustomPipelines", () => ({
  useTemporaryFunnels: () => ({ data: temporaryRef.value, isLoading: temporaryRef.loading }),
}));

// Registro único `pipelines` — de onde saem cor/ícone reais (SCRUM-637).
const pipelinesRef: { value: unknown[]; loading: boolean } = { value: [], loading: false };
vi.mock("@/modules/pipelines/hooks/model/usePipelines", () => ({
  usePipelines: () => ({ data: pipelinesRef.value, isLoading: pipelinesRef.loading }),
}));

// ── Dependências do FunnelSwitcher ──────────────────────────────────────────
const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

// ── Diálogo de identidade: o seletor é só a PORTA ───────────────────────────
// O miolo (FunnelIdentitySection + useUpdatePipelineIdentity) já é coberto no
// hub e nas abas "Geral"; aqui interessa qual funil chega nele.
vi.mock("@/modules/pipelines/components/shared/FunnelIdentityDialog", () => ({
  FunnelIdentityDialog: ({
    open,
    pipeline,
    displayName,
  }: {
    open: boolean;
    pipeline: { id: string };
    displayName?: string;
  }) =>
    open ? (
      <div data-testid="identity-dialog" data-pipeline={pipeline.id}>
        {displayName}
      </div>
    ) : null,
}));

// ── SavedViewsDropdown: só o suficiente para exercitar o header ─────────────
const closeSpy = vi.fn();
vi.mock("@/modules/platform/components/saved-views/SavedViewsDropdown", () => ({
  SavedViewsDropdown: ({
    header,
    triggerIcon: Icone,
  }: {
    header: (a: { close: () => void }) => React.ReactNode;
    triggerIcon?: React.ComponentType<{ "data-testid"?: string }>;
  }) => (
    <div>
      <span data-testid="gatilho">{Icone ? <Icone data-testid="icone-da-visao" /> : null}</span>
      {header({ close: closeSpy })}
    </div>
  ),
}));

import { useFunnelOptions } from "@/modules/pipelines/lib/funnel-nav";
import { FunnelSwitcher } from "@/modules/pipelines/components/shared/FunnelSwitcher";
import { FunnelViewsMenu } from "@/modules/pipelines/components/shared/FunnelViewsMenu";

const SYS = [
  { id: "p1", slug: "whatsapp", name: "Oportunidades", type: "system", color: "#111", icon: "target", is_active: true },
  { id: "p2", slug: "confirmacao", name: "Agenda Comercial", type: "system", color: "#222", icon: "calendar", is_active: true },
  { id: "p3", slug: "propostas", name: "Orçamentos", type: "system", color: "#333", icon: "file", is_active: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  temporaryRef.value = [];
  temporaryRef.loading = false;
  pipelinesRef.value = SYS;
  pipelinesRef.loading = false;
});

describe("useFunnelOptions — o que entra na navegação", () => {
  it("lista todos os funis pelo registro único e usa chave por id", () => {
    const { result } = renderHook(() => useFunnelOptions());

    expect(result.current.options.map((o) => o.key)).toEqual([
      "pipeline:p1",
      "pipeline:p2",
      "pipeline:p3",
    ]);
    expect(result.current.options[0].path).toBe("/funil/whatsapp");
    expect(result.current.options[0].label).toBe("Oportunidades");
  });

  it("a cor vem do registro `pipelines` — funil de sistema personalizado reflete (SCRUM-637)", () => {
    pipelinesRef.value = [
      { ...SYS[0], name: "Entrada de Obra", color: "#ff0000" },
    ];

    const { result } = renderHook(() => useFunnelOptions());

    expect(result.current.options[0].color).toBe("#ff0000");
    expect(result.current.options[0].label).toBe("Entrada de Obra");
  });

  it("não esconde funil pelo antigo tipo", () => {
    const { result } = renderHook(() => useFunnelOptions());

    expect(result.current.options.some((o) => o.key === "pipeline:p2")).toBe(true);
    expect(result.current.options).toHaveLength(3);
  });

  it("respeita o estado ativo do registro único", () => {
    pipelinesRef.value = [{ ...SYS[0], is_active: false }, SYS[2]];

    const { result } = renderHook(() => useFunnelOptions());

    expect(result.current.options.map((o) => o.key)).toEqual(["pipeline:p3"]);
  });

  it("aceita qualquer slug de funil criado pelo usuário", () => {
    pipelinesRef.value = [{ ...SYS[0], id: "novo", slug: "inventado", name: "Inventado" }];

    const { result } = renderHook(() => useFunnelOptions());

    expect(result.current.options).toHaveLength(1);
    expect(result.current.options[0].path).toBe("/funil/inventado");
  });

  it("funil criado pelo usuário recebe o mesmo formato dos demais", () => {
    pipelinesRef.value = [
      { ...SYS[0], id: "c2", name: "Parcerias", slug: "parcerias", type: "custom", color: "#0f0" },
    ];

    const { result } = renderHook(() => useFunnelOptions());

    const custom = result.current.options.filter((o) => o.group === "custom");
    expect(custom).toHaveLength(1);
    // SCRUM-632: custom navega pela rota única.
    expect(custom[0]).toMatchObject({ key: "pipeline:c2", path: "/funil/parcerias" });
  });

  it("marca como encerrado o funil com prazo vencido", () => {
    temporaryRef.value = [
      { id: "t1", name: "Black Friday", slug: "bf", color: null, status: "ended" },
      { id: "t2", name: "Junho", slug: "junho", color: null, status: "active" },
    ];
    pipelinesRef.value = [
      { ...SYS[0], id: "t1", name: "Black Friday", slug: "bf", type: "custom", color: "#444", is_active: false },
      { ...SYS[0], id: "t2", name: "Junho", slug: "junho", type: "custom", color: "#555" },
    ];

    const { result } = renderHook(() => useFunnelOptions());

    const prazo = result.current.options.filter((o) => o.group === "prazo");
    expect(prazo.map((o) => o.ended)).toEqual([true, false]);
    expect(prazo[0].color).toBe("#444");
  });

  it("isLoading acompanha a fonte canônica", () => {
    pipelinesRef.loading = true;

    const { result } = renderHook(() => useFunnelOptions());

    expect(result.current.isLoading).toBe(true);
  });
});

describe("FunnelSwitcher — escolher troca, abrir não", () => {
  const abrir = () => fireEvent.click(screen.getByTestId("funnel-switcher"));

  it("não navega ao abrir a lista", () => {
    render(<FunnelSwitcher currentKey="pipeline:p1" fallbackLabel="Oportunidades" />);

    abrir();

    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("funnel-switcher")).toHaveAttribute("aria-expanded", "true");
  });

  it("navega para o funil escolhido", () => {
    render(<FunnelSwitcher currentKey="pipeline:p1" fallbackLabel="Oportunidades" />);

    abrir();
    fireEvent.click(screen.getByTestId("funnel-switcher-option-pipeline:p3"));

    expect(navigate).toHaveBeenCalledWith("/funil/propostas");
  });

  it("escolher o funil já aberto não navega", () => {
    render(<FunnelSwitcher currentKey="pipeline:p1" fallbackLabel="Oportunidades" />);

    abrir();
    fireEvent.click(screen.getByTestId("funnel-switcher-option-pipeline:p1"));

    expect(navigate).not.toHaveBeenCalled();
  });

  it("marca o funil aberto como selecionado", () => {
    render(<FunnelSwitcher currentKey="pipeline:p3" fallbackLabel="Orçamentos" />);

    abrir();

    expect(screen.getByTestId("funnel-switcher-option-pipeline:p3")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("funnel-switcher-option-pipeline:p1")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("empurra funil encerrado para o fim do próprio grupo", () => {
    temporaryRef.value = [
      { id: "t1", name: "Black Friday", slug: "bf", color: null, status: "ended" },
      { id: "t2", name: "Junho", slug: "junho", color: null, status: "active" },
    ];
    pipelinesRef.value = [
      ...SYS,
      { ...SYS[0], id: "t1", name: "Black Friday", slug: "bf", type: "custom", is_active: false },
      { ...SYS[0], id: "t2", name: "Junho", slug: "junho", type: "custom" },
    ];
    render(<FunnelSwitcher currentKey="pipeline:p1" fallbackLabel="Oportunidades" />);

    abrir();
    const ids = screen
      .getAllByRole("option")
      .map((e) => e.getAttribute("data-testid"));

    expect(ids.indexOf("funnel-switcher-option-pipeline:t2")).toBeLessThan(
      ids.indexOf("funnel-switcher-option-pipeline:t1"),
    );
    expect(screen.getByText("encerrado")).toBeInTheDocument();
  });

  it("usa o nome da página enquanto a lista carrega", () => {
    pipelinesRef.value = [];
    pipelinesRef.loading = true;
    render(<FunnelSwitcher currentKey="pipeline:p1" fallbackLabel="Oportunidades" />);

    expect(screen.getByTestId("funnel-switcher")).toHaveTextContent("Oportunidades");
    abrir();
    expect(screen.getByText(/carregando funis/i)).toBeInTheDocument();
  });

  it("diz que não há funil em vez de abrir lista vazia", () => {
    pipelinesRef.value = [];
    render(<FunnelSwitcher currentKey="pipeline:p1" fallbackLabel="Oportunidades" />);

    abrir();

    expect(screen.getByText(/nenhum funil disponível/i)).toBeInTheDocument();
  });
});

describe("FunnelViewsMenu — o único caminho de volta do Analytics", () => {
  const OPCOES = [
    { value: "kanban" as const, icon: Kanban, label: "Kanban" },
    { value: "lista" as const, icon: List, label: "Lista", hint: "beta" },
    { value: "analytics" as const, icon: BarChart3, label: "Analytics" },
  ];

  const montar = (viewMode: "kanban" | "lista" | "analytics", onViewModeChange = vi.fn()) => {
    render(
      <FunnelViewsMenu
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        viewOptions={OPCOES}
        entityType="leads"
        currentFilters={{}}
        defaultFilters={{}}
        onApplyFilters={vi.fn()}
        activeViewId={null}
        onActiveViewChange={vi.fn()}
      />,
    );
    return onViewModeChange;
  };

  it("troca de visão e fecha o menu", () => {
    const onViewModeChange = montar("analytics");

    fireEvent.click(screen.getByRole("button", { name: /kanban/i }));

    expect(onViewModeChange).toHaveBeenCalledWith("kanban");
    expect(closeSpy).toHaveBeenCalled();
  });

  it("clicar na visão ativa fecha sem re-emitir a troca", () => {
    const onViewModeChange = montar("kanban");

    fireEvent.click(screen.getByRole("button", { name: /kanban/i }));

    expect(onViewModeChange).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalled();
  });

  it("marca a visão ativa por aria-pressed", () => {
    montar("lista");

    expect(screen.getByRole("button", { name: /lista/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /kanban/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("o gatilho carrega o ícone da visão ativa, não um fixo", () => {
    montar("analytics");

    expect(screen.getByTestId("icone-da-visao")).toBeInTheDocument();
    expect(screen.getByTestId("gatilho").querySelector("svg")).toBeTruthy();
  });

  it("viewMode desconhecido cai na primeira opção em vez de sumir com o gatilho", () => {
    montar("inexistente" as unknown as "kanban");

    expect(screen.getByTestId("icone-da-visao")).toBeInTheDocument();
  });
});

/**
 * Renomear a partir do NOME do funil (o cabeçalho do quadro).
 *
 * A decisão do protótipo fica de pé: clicar no nome abre a lista, escolher é
 * que troca. O que entrou é o rodapé da lista — a identidade do funil aberto
 * deixou de morar só na última aba de Configurações.
 */
describe("FunnelSwitcher — renomear o funil aberto", () => {
  const abrir = () => fireEvent.click(screen.getByTestId("funnel-switcher"));

  it("oferece renomear o funil ABERTO, nomeado como o usuário o vê", () => {
    pipelinesRef.value = [
      { id: "p1", slug: "whatsapp", type: "system", name: "Qualificação", icon: "target", color: "#f00", is_active: true },
    ];
    render(<FunnelSwitcher currentKey="pipeline:p1" fallbackLabel="Qualificação" />);

    abrir();

    // O rótulo é o nome canônico escolhido pelo usuário.
    expect(screen.getByTestId("funnel-switcher-rename")).toHaveTextContent(
      'Renomear "Qualificação"',
    );
  });

  it("abre o diálogo de identidade do funil aberto, sem navegar", () => {
    pipelinesRef.value = [
      { id: "p3", slug: "propostas", type: "system", name: "Orçamentos", icon: "target", color: "#f00", is_active: true },
    ];
    render(<FunnelSwitcher currentKey="pipeline:p3" fallbackLabel="Orçamentos" />);

    abrir();
    fireEvent.click(screen.getByTestId("funnel-switcher-rename"));

    const dialogo = screen.getByTestId("identity-dialog");
    expect(dialogo).toHaveAttribute("data-pipeline", "p3");
    // Nome exibido = `pipelines.name`.
    expect(dialogo).toHaveTextContent("Orçamentos");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("sem linha canônica em `pipelines` não há o que renomear — nada é oferecido", () => {
    pipelinesRef.value = [];
    render(<FunnelSwitcher currentKey="pipeline:p1" fallbackLabel="Qualificação" />);

    abrir();

    expect(screen.queryByTestId("funnel-switcher-rename")).toBeNull();
  });
});
