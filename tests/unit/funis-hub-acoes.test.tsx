/**
 * Renomear e excluir funil deixaram de ser configuração enterrada.
 *
 * As duas capacidades já existiam e funcionavam — só moravam na ÚLTIMA aba de
 * Configurações (sétima de sete no funil de fábrica, quarta de quatro no
 * personalizado). A lista de funis, o lugar onde qualquer um procura, só
 * listava e navegava.
 *
 * O que este arquivo trava:
 *   1. **todo cartão do hub tem o menu** — de fábrica ou personalizado, ativo
 *      ou encerrado. É a afordância que faltava;
 *   2. **"Excluir" respeita `pipeline.custom_delete`** e SOME quando a
 *      permissão não está dada (mesma escolha da Zona de Perigo — item
 *      destrutivo desabilitado só ensina que ele não serve);
 *   3. **o menu abre os diálogos CERTOS** — o de identidade e o
 *      `DeletePipelineDialog`, com o funil correto. Nada de lógica nova;
 *   4. **clicar no menu não navega** — o cartão inteiro era um `<button>`, e
 *      abrir o menu dentro dele mandaria a pessoa para o quadro.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Dados do hub ────────────────────────────────────────────────────────────
const SYS = [
  { pipe_type: "whatsapp", display_name: "Oportunidades", is_visible: true },
];
const PERMANENTES = [
  { id: "c1", name: "Pós-venda", slug: "pos-venda", color: "#22c55e", status: "active" },
];
const TEMPORARIOS = [
  { id: "t1", name: "Black Friday", slug: "bf", color: "#f59e0b", status: "ended" },
];
const PIPELINES = [
  {
    id: "p-sys",
    slug: "whatsapp",
    type: "system",
    name: "Qualificação",
    icon: "target",
    color: "#3b82f6",
    is_active: true,
  },
  {
    id: "c1",
    slug: "pos-venda",
    type: "custom",
    name: "Pós-venda",
    icon: "kanban",
    color: "#22c55e",
    is_active: true,
  },
  {
    id: "t1",
    slug: "bf",
    type: "custom",
    name: "Black Friday",
    icon: "kanban",
    color: "#f59e0b",
    is_active: true,
  },
];

vi.mock("@/modules/pipelines/hooks/config/usePipelineDisplayConfig", () => ({
  usePipelineDisplayConfig: () => ({ data: SYS, isLoading: false }),
}));
vi.mock("@/modules/pipelines/hooks/custom/useCustomPipelines", () => ({
  usePermanentCustomFunnels: () => ({ data: PERMANENTES, isLoading: false }),
  useTemporaryFunnels: () => ({ data: TEMPORARIOS, isLoading: false }),
}));
vi.mock("@/modules/pipelines/hooks/model/usePipelines", () => ({
  usePipelines: () => ({ data: PIPELINES, isLoading: false }),
}));
vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => ({ hasFeature: () => false }),
}));
vi.mock("@/lib/analytics", () => ({ trackModuleVisit: vi.fn() }));

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

// ── Portão de permissão (o alvo do teste 2) ─────────────────────────────────
let podeExcluir = true;
const updateSettings = vi.fn();
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
  useFeaturePermission: (chave: string) => ({
    allowed: chave === "pipeline.custom_delete" ? podeExcluir : true,
  }),
  useOrganizationSettings: () => ({
    settings: { default_pipeline_id: null },
    updateSettings,
    isAdmin: true,
    isLoading: false,
    isUpdating: false,
  }),
}));

// ── Vizinhos pesados dos diálogos reutilizados ──────────────────────────────
vi.mock("@/modules/pipelines/components/funis/CreateFunilOuCampanhaModal", () => ({
  CreateFunilOuCampanhaModal: () => null,
}));
vi.mock("@/modules/pipelines/components/custom/CreatePipelineModal", () => ({
  PIPELINE_COLORS: ["#3b82f6"],
  PIPELINE_ICONS: [],
}));
const updateIdentity = vi.fn();
vi.mock("@/modules/pipelines/hooks/config/usePipelineIdentity", () => ({
  useUpdatePipelineIdentity: () => ({ mutateAsync: updateIdentity, isPending: false }),
}));
const excluir = vi.fn();
vi.mock("@/modules/pipelines/hooks/config/usePipelineDelete", () => ({
  usePipelineDeleteImpact: () => ({ data: { etapas: 3, cards: 12, leads: 9 } }),
  useDeletePipelineById: () => ({ mutateAsync: excluir, isPending: false }),
}));

import FunisHub from "@/modules/pipelines/pages/FunisHub";

const abrirMenuDe = async (usuario: ReturnType<typeof userEvent.setup>, nome: string) => {
  await usuario.click(screen.getByRole("button", { name: `Ações do funil ${nome}` }));
};

beforeEach(() => {
  vi.clearAllMocks();
  podeExcluir = true;
});

describe("Hub de funis — renomear e excluir no cartão", () => {
  it("todo funil listado tem menu de ações, de fábrica ou personalizado", () => {
    render(<FunisHub />);

    // O nome do funil de sistema é o do registro (display_name vence).
    expect(
      screen.getByRole("button", { name: "Ações do funil Oportunidades" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ações do funil Pós-venda" })).toBeTruthy();
    expect(screen.getAllByTestId("funnel-actions-menu")).toHaveLength(2);
  });

  it("funil encerrado também tem o menu — encerrado é estado, não espécie", async () => {
    const usuario = userEvent.setup();
    render(<FunisHub />);

    await usuario.click(screen.getByText(/1 funil encerrado/i));

    expect(screen.getByRole("button", { name: "Ações do funil Black Friday" })).toBeTruthy();
  });

  it("sem `pipeline.custom_delete`, o item Excluir não existe — Renomear fica", async () => {
    podeExcluir = false;
    const usuario = userEvent.setup();
    render(<FunisHub />);

    await abrirMenuDe(usuario, "Pós-venda");

    expect(await screen.findByTestId("funnel-actions-renomear")).toBeTruthy();
    expect(screen.queryByTestId("funnel-actions-excluir")).toBeNull();
  });

  it("Renomear abre a MESMA seção de identidade, com o nome que o usuário vê", async () => {
    const usuario = userEvent.setup();
    render(<FunisHub />);

    await abrirMenuDe(usuario, "Oportunidades");
    await usuario.click(await screen.findByTestId("funnel-actions-renomear"));

    // O campo nasce com o display_name do registro, não com o `pipelines.name`
    // de fábrica ("Qualificação") — a precedência de `usePipelineIdentity`.
    const campo = (await screen.findByLabelText("Nome do Funil")) as HTMLInputElement;
    expect(campo.value).toBe("Oportunidades");
    expect(screen.getByText(/renomear funil/i)).toBeTruthy();
  });

  it("Excluir abre o diálogo definitivo, com o impacto medido do funil escolhido", async () => {
    const usuario = userEvent.setup();
    render(<FunisHub />);

    await abrirMenuDe(usuario, "Pós-venda");
    await usuario.click(await screen.findByTestId("funnel-actions-excluir"));

    expect(await screen.findByText(/Excluir Funil "Pós-venda"\?/)).toBeTruthy();
    expect(screen.getByText(/3 etapa\(s\)/)).toBeTruthy();
  });

  it("mexer no menu não navega para o quadro", async () => {
    const usuario = userEvent.setup();
    render(<FunisHub />);

    await abrirMenuDe(usuario, "Pós-venda");
    await usuario.click(await screen.findByTestId("funnel-actions-renomear"));

    expect(navigate).not.toHaveBeenCalled();
  });

  it("o cartão continua navegando quando clicado fora do menu", async () => {
    const usuario = userEvent.setup();
    render(<FunisHub />);

    await usuario.click(screen.getByText("Pós-venda"));

    expect(navigate).toHaveBeenCalledWith("/funil/pos-venda");
  });
});
