/**
 * Redesenho da aba de Funis — navegação entre funis e alternador de visão.
 *
 * Fecha a parte de navegação de `inv:H8-32`. `FunnelSwitcher`, `funnel-nav` e
 * `FunnelViewsMenu` entraram pelas PRs #1315/#1316 e nenhum arquivo de teste
 * os referenciava.
 *
 * O que se cobre é o que quebra a operação de quem trabalha o board o dia
 * inteiro, não o desenho:
 *
 *   1. **a Carteira ficou fora da navegação por decisão** (D6: é faceta do
 *      lead, não funil de negócio). Um `upsell` reaparecendo na lista desfaz
 *      a decisão por tabela de rota, calado;
 *   2. **funil sem rota não vira item** — `pipe_type` fora do mapa de caminhos
 *      e funil custom sem `slug` produziriam link morto;
 *   3. **escolher troca; abrir não** — navegar sem querer no meio de um
 *      arrasto custa caro. E escolher o funil já aberto não navega;
 *   4. **o menu de Visões é o único caminho de volta do Analytics** — o
 *      gatilho carrega o ícone da visão ativa, senão quem está em Analytics
 *      não sabe por que o board sumiu.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, fireEvent } from "@testing-library/react";
import { Kanban, List, BarChart3 } from "lucide-react";

// ── Dependências do useFunnelOptions ────────────────────────────────────────
const featuresRef = { value: new Set<string>() };
vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => ({ hasFeature: (f: string) => featuresRef.value.has(f) }),
}));

const displayRef: { value: unknown[]; loading: boolean } = { value: [], loading: false };
vi.mock("@/modules/pipelines/hooks/config/usePipelineDisplayConfig", () => ({
  usePipelineDisplayConfig: () => ({ data: displayRef.value, isLoading: displayRef.loading }),
}));

const permanentRef: { value: unknown[]; loading: boolean } = { value: [], loading: false };
const temporaryRef: { value: unknown[]; loading: boolean } = { value: [], loading: false };
vi.mock("@/modules/pipelines/hooks/custom/useCustomPipelines", () => ({
  usePermanentCustomFunnels: () => ({ data: permanentRef.value, isLoading: permanentRef.loading }),
  useTemporaryFunnels: () => ({ data: temporaryRef.value, isLoading: temporaryRef.loading }),
}));

// Registro único `pipelines` — de onde saem cor/ícone reais (SCRUM-637).
const pipelinesRef: { value: unknown[] } = { value: [] };
vi.mock("@/modules/pipelines/hooks/model/usePipelines", () => ({
  usePipelines: () => ({ data: pipelinesRef.value, isLoading: false }),
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
  { pipe_type: "whatsapp", display_name: "Qualificação", is_visible: true },
  { pipe_type: "confirmacao", display_name: "Confirmação", is_visible: true },
  { pipe_type: "propostas", display_name: "Orçamentos", is_visible: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  featuresRef.value = new Set();
  displayRef.value = SYS;
  displayRef.loading = false;
  permanentRef.value = [];
  permanentRef.loading = false;
  temporaryRef.value = [];
  temporaryRef.loading = false;
  pipelinesRef.value = [];
});

describe("useFunnelOptions — o que entra na navegação", () => {
  it("lista os funis do sistema com chave estável e rota", () => {
    const { result } = renderHook(() => useFunnelOptions());

    expect(result.current.options.map((o) => o.key)).toEqual([
      "sys:whatsapp",
      "sys:confirmacao",
      "sys:propostas",
    ]);
    expect(result.current.options[0].path).toBe("/funil/whatsapp");
    expect(result.current.options[0].group).toBe("estrutural");
  });

  it("a cor vem do registro `pipelines` — funil de sistema personalizado reflete (SCRUM-637)", () => {
    pipelinesRef.value = [
      { id: "p1", slug: "whatsapp", color: "#ff0000", icon: "target", is_active: true },
    ];

    const { result } = renderHook(() => useFunnelOptions());

    expect(result.current.options[0].color).toBe("#ff0000");
    // Sem linha no registro (org ainda carregando), cai no fallback neutro —
    // nunca mais na tabela hardcoded por espécie.
    expect(result.current.options[1].color).toBe("#64748b");
  });

  it("mantém a Carteira FORA — upsell é faceta do lead, não funil (D6)", () => {
    displayRef.value = [...SYS, { pipe_type: "upsell", display_name: "Carteira", is_visible: true }];

    const { result } = renderHook(() => useFunnelOptions());

    expect(result.current.options.some((o) => o.key === "sys:upsell")).toBe(false);
    expect(result.current.options.some((o) => o.path === "/upsell")).toBe(false);
  });

  it("esconde Confirmação quando o funil mergeado está ligado (ADR-0004)", () => {
    featuresRef.value = new Set(["merged_opportunity_funnel"]);

    const { result } = renderHook(() => useFunnelOptions());

    expect(result.current.options.some((o) => o.key === "sys:confirmacao")).toBe(false);
    expect(result.current.options).toHaveLength(2);
  });

  it("respeita is_visible", () => {
    displayRef.value = [{ ...SYS[0], is_visible: false }, SYS[2]];

    const { result } = renderHook(() => useFunnelOptions());

    expect(result.current.options.map((o) => o.key)).toEqual(["sys:propostas"]);
  });

  it("ignora pipe_type sem rota conhecida em vez de oferecer link morto", () => {
    displayRef.value = [{ pipe_type: "inventado", display_name: "Inventado", is_visible: true }];

    const { result } = renderHook(() => useFunnelOptions());

    expect(result.current.options).toHaveLength(0);
  });

  it("funil custom sem slug não vira item — não há rota para ele", () => {
    permanentRef.value = [
      { id: "c1", name: "Pós-venda", slug: null, color: "#fff" },
      { id: "c2", name: "Parcerias", slug: "parcerias", color: "#0f0" },
    ];

    const { result } = renderHook(() => useFunnelOptions());

    const custom = result.current.options.filter((o) => o.group === "custom");
    expect(custom).toHaveLength(1);
    // SCRUM-632: custom navega pela rota única.
    expect(custom[0]).toMatchObject({ key: "custom:c2", path: "/funil/parcerias" });
  });

  it("marca como encerrado o funil com prazo vencido", () => {
    temporaryRef.value = [
      { id: "t1", name: "Black Friday", slug: "bf", color: null, status: "ended" },
      { id: "t2", name: "Junho", slug: "junho", color: null, status: "active" },
    ];

    const { result } = renderHook(() => useFunnelOptions());

    const prazo = result.current.options.filter((o) => o.group === "prazo");
    expect(prazo.map((o) => o.ended)).toEqual([true, false]);
    expect(prazo[0].color).toBe("#64748b"); // cor nula cai no neutro
  });

  it("isLoading agrega as três fontes", () => {
    temporaryRef.loading = true;

    const { result } = renderHook(() => useFunnelOptions());

    expect(result.current.isLoading).toBe(true);
  });
});

describe("FunnelSwitcher — escolher troca, abrir não", () => {
  const abrir = () => fireEvent.click(screen.getByTestId("funnel-switcher"));

  it("não navega ao abrir a lista", () => {
    render(<FunnelSwitcher currentKey="sys:whatsapp" fallbackLabel="Qualificação" />);

    abrir();

    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("funnel-switcher")).toHaveAttribute("aria-expanded", "true");
  });

  it("navega para o funil escolhido", () => {
    render(<FunnelSwitcher currentKey="sys:whatsapp" fallbackLabel="Qualificação" />);

    abrir();
    fireEvent.click(screen.getByTestId("funnel-switcher-option-sys:propostas"));

    expect(navigate).toHaveBeenCalledWith("/funil/propostas");
  });

  it("escolher o funil já aberto não navega", () => {
    render(<FunnelSwitcher currentKey="sys:whatsapp" fallbackLabel="Qualificação" />);

    abrir();
    fireEvent.click(screen.getByTestId("funnel-switcher-option-sys:whatsapp"));

    expect(navigate).not.toHaveBeenCalled();
  });

  it("marca o funil aberto como selecionado", () => {
    render(<FunnelSwitcher currentKey="sys:propostas" fallbackLabel="Orçamentos" />);

    abrir();

    expect(screen.getByTestId("funnel-switcher-option-sys:propostas")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("funnel-switcher-option-sys:whatsapp")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("empurra funil encerrado para o fim do próprio grupo", () => {
    temporaryRef.value = [
      { id: "t1", name: "Black Friday", slug: "bf", color: null, status: "ended" },
      { id: "t2", name: "Junho", slug: "junho", color: null, status: "active" },
    ];
    render(<FunnelSwitcher currentKey="sys:whatsapp" fallbackLabel="Qualificação" />);

    abrir();
    const ids = screen
      .getAllByRole("option")
      .map((e) => e.getAttribute("data-testid"));

    expect(ids.indexOf("funnel-switcher-option-custom:t2")).toBeLessThan(
      ids.indexOf("funnel-switcher-option-custom:t1"),
    );
    expect(screen.getByText("encerrado")).toBeInTheDocument();
  });

  it("usa o nome da página enquanto a lista carrega", () => {
    displayRef.value = [];
    displayRef.loading = true;
    render(<FunnelSwitcher currentKey="sys:whatsapp" fallbackLabel="Qualificação" />);

    expect(screen.getByTestId("funnel-switcher")).toHaveTextContent("Qualificação");
    abrir();
    expect(screen.getByText(/carregando funis/i)).toBeInTheDocument();
  });

  it("diz que não há funil em vez de abrir lista vazia", () => {
    displayRef.value = [];
    render(<FunnelSwitcher currentKey="sys:whatsapp" fallbackLabel="Qualificação" />);

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
      { id: "p1", slug: "whatsapp", type: "system", name: "Qualificação", icon: "target", color: "#f00" },
    ];
    render(<FunnelSwitcher currentKey="sys:whatsapp" fallbackLabel="Qualificação" />);

    abrir();

    // O rótulo é o display_name do registro, não o `pipelines.name` cru.
    expect(screen.getByTestId("funnel-switcher-rename")).toHaveTextContent(
      'Renomear "Qualificação"',
    );
  });

  it("abre o diálogo de identidade do funil aberto, sem navegar", () => {
    pipelinesRef.value = [
      { id: "p3", slug: "propostas", type: "system", name: "Propostas", icon: "target", color: "#f00" },
    ];
    render(<FunnelSwitcher currentKey="sys:propostas" fallbackLabel="Orçamentos" />);

    abrir();
    fireEvent.click(screen.getByTestId("funnel-switcher-rename"));

    const dialogo = screen.getByTestId("identity-dialog");
    expect(dialogo).toHaveAttribute("data-pipeline", "p3");
    // Nome exibido = display_name do registro, não o canônico "Propostas".
    expect(dialogo).toHaveTextContent("Orçamentos");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("sem linha canônica em `pipelines` não há o que renomear — nada é oferecido", () => {
    pipelinesRef.value = [];
    render(<FunnelSwitcher currentKey="sys:whatsapp" fallbackLabel="Qualificação" />);

    abrir();

    expect(screen.queryByTestId("funnel-switcher-rename")).toBeNull();
  });
});
