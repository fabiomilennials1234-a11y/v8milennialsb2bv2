/**
 * Criar negócio pelo Card do Lead — `inv:H5-18` (SCRUM-123).
 *
 * O botão "Criar negócio" já existia em `LeadCardDeals` desde a PR #1411 e não
 * levava a lugar nenhum: `onNewDeal` subia até `LeadCardPanel` e morria lá,
 * porque ninguém passava a prop. O card listava os negócios da pessoa e era a
 * única superfície de leads sem porta para abrir o próximo — o que, depois da
 * ADR-0023 decisão 3 (negócio nasce por clique humano, o ingest não cria mais),
 * significa lead que entra e não tem por onde virar negócio sem passar pelo
 * modal antigo.
 *
 * O que se cobre aqui é o que quebra em produção, não a aparência:
 *
 *   1. **A costura.** O clique no botão do card tem que chegar na RPC
 *      `abrir_negocio` com o funil, a etapa e o dono certos. Este arquivo monta
 *      `LeadCardPanel` de verdade — card, aba, botão, diálogo, roteamento — e
 *      só troca a camada de dados. Testar o diálogo isolado passaria verde com
 *      o botão desligado, que era exatamente o defeito;
 *   2. **Uma regra só de quais funis aceitam negócio.** `buildNewDealOptions`
 *      nasceu dentro do `CrossPipePanel` (682 linhas) e saiu de lá no mesmo
 *      diff — as duas telas importam o mesmo construtor. Se a lista divergir, é
 *      porque alguém copiou de volta;
 *   3. **Fronteiras que mentem quando erradas**: funil onde o lead já tem
 *      negócio não é opção; Carteira aparece TRAVADA sem venda fechada
 *      (ADR-0023 decisão 8) em vez de sumir; sem permissão nada é criável; e
 *      chave órfã não vira escrita "no funil mais parecido".
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  buildNewDealOptions,
  resolveNewDealTarget,
} from "@/modules/leads/components/lead-detail/modal/pipes/newDealOptions";
import type { PipelineStatus } from "@/modules/leads/hooks/useLeadAllPipelines";
import { MockPipeOpsProvider } from "@/modules/leads/pipe-ops/testing";

// ── Fixtures de funil ───────────────────────────────────────────────────────
// Espelham o que `useLeadAllPipelines` devolve: UMA linha vazia por funil sem
// negócio (é ela que se lê como "dá pra abrir aqui") e uma linha por negócio.

const QUALIFICACAO_COM_NEGOCIO: PipelineStatus = {
  type: "standard",
  pipeType: "whatsapp",
  label: "Qualificação",
  color: "#6366f1",
  pipelineDbId: "pl-q",
  pipeId: "entry-q",
  currentStage: "abordado",
  currentStageLabel: "Abordado",
  stages: [
    { id: "novo_lead", label: "Novo lead", color: "#fff" },
    { id: "abordado", label: "Abordado", color: "#fff" },
  ],
};

const CONFIRMACAO_VAZIA: PipelineStatus = {
  type: "standard",
  pipeType: "confirmacao",
  label: "Confirmação",
  color: "#22c55e",
  pipelineDbId: "pl-c",
  pipeId: null,
  currentStage: null,
  currentStageLabel: null,
  stages: [
    { id: "marcada", label: "Marcada", color: "#fff" },
    { id: "compareceu", label: "Compareceu", color: "#fff" },
  ],
};

const PROPOSTAS_VAZIA: PipelineStatus = {
  type: "standard",
  pipeType: "propostas",
  label: "Propostas",
  color: "#f59e0b",
  pipelineDbId: "pl-p",
  pipeId: null,
  currentStage: null,
  currentStageLabel: null,
  stages: [{ id: "orcamento", label: "Orçamento", color: "#fff" }],
};

const CARTEIRA_VAZIA: PipelineStatus = {
  type: "standard",
  pipeType: "upsell",
  label: "Carteira",
  color: "#3b82f6",
  pipelineDbId: null,
  pipeId: null,
  currentStage: null,
  currentStageLabel: null,
  stages: [{ id: "ativo", label: "Ativo", color: "#fff" }],
};

const CUSTOM_REATIVACAO: PipelineStatus = {
  type: "custom",
  pipelineId: "cp-1",
  pipelineName: "Reativação",
  pipelineColor: "#a855f7",
  pipelineIcon: "flame",
  entryId: null,
  currentStageId: null,
  currentStageName: null,
  stages: [{ id: "cs-1", name: "Triagem", color: "#fff", position: 0 }],
};

const CUSTOM_ASSINATURA: PipelineStatus = {
  type: "custom",
  pipelineId: "cp-2",
  pipelineName: "Assinatura",
  pipelineColor: "#0ea5e9",
  pipelineIcon: "pen",
  entryId: null,
  currentStageId: null,
  currentStageName: null,
  stages: [{ id: "cs-2", name: "Enviada", color: "#fff", position: 0 }],
};

const FUNIS: PipelineStatus[] = [
  QUALIFICACAO_COM_NEGOCIO,
  CONFIRMACAO_VAZIA,
  PROPOSTAS_VAZIA,
  CARTEIRA_VAZIA,
  CUSTOM_REATIVACAO,
];

const PODE = { allowed: true, reason: null };

// ─────────────────────────────────────────────────────────────────────────────
// 1. O construtor de opções, sem montar árvore
// ─────────────────────────────────────────────────────────────────────────────

describe("buildNewDealOptions — funil com negócio não é opção de negócio novo", () => {
  it("oferece só os funis vazios, e a Qualificação com negócio fica de fora", () => {
    const opcoes = buildNewDealOptions(FUNIS, { canAdd: PODE, vendaFechada: false });

    expect(opcoes.map((o) => o.key)).toEqual([
      "sys:confirmacao",
      "sys:propostas",
      "sys:upsell",
      "custom:cp-1",
    ]);
  });

  it("lead sem negócio nenhum abre em qualquer funil do sistema", () => {
    const semNegocio: PipelineStatus[] = [
      { ...QUALIFICACAO_COM_NEGOCIO, pipeId: null, currentStage: null },
      CONFIRMACAO_VAZIA,
      PROPOSTAS_VAZIA,
    ];

    const opcoes = buildNewDealOptions(semNegocio, { canAdd: PODE, vendaFechada: false });

    expect(opcoes.map((o) => o.key)).toEqual([
      "sys:whatsapp",
      "sys:confirmacao",
      "sys:propostas",
    ]);
  });

  it("só Propostas pede valor e só Confirmação pede data — campo sem coluna não aparece", () => {
    const opcoes = buildNewDealOptions(FUNIS, { canAdd: PODE, vendaFechada: false });
    const porChave = Object.fromEntries(opcoes.map((o) => [o.key, o]));

    expect(porChave["sys:propostas"].supportsValue).toBe(true);
    expect(porChave["sys:propostas"].supportsMeeting).toBeFalsy();
    expect(porChave["sys:confirmacao"].supportsMeeting).toBe(true);
    expect(porChave["sys:confirmacao"].supportsValue).toBeFalsy();
    expect(porChave["custom:cp-1"].supportsValue).toBeFalsy();
    expect(porChave["custom:cp-1"].supportsMeeting).toBeFalsy();
  });

  it("funis custom saem em ordem alfabética pt-BR, não na ordem do banco", () => {
    const opcoes = buildNewDealOptions(
      [CUSTOM_REATIVACAO, CUSTOM_ASSINATURA],
      { canAdd: PODE, vendaFechada: false },
    );

    expect(opcoes.map((o) => o.label)).toEqual(["Assinatura", "Reativação"]);
  });
});

describe("buildNewDealOptions — Carteira é consequência de venda, não negócio novo", () => {
  it("aparece TRAVADA e explicando a regra quando não houve venda fechada", () => {
    const opcoes = buildNewDealOptions(FUNIS, { canAdd: PODE, vendaFechada: false });
    const carteira = opcoes.find((o) => o.key === "sys:upsell")!;

    expect(carteira.disabled).toBe(true);
    expect(carteira.disabledReason).toMatch(/venda fechada/i);
  });

  it("destrava quando o lead já tem venda fechada", () => {
    const opcoes = buildNewDealOptions(FUNIS, { canAdd: PODE, vendaFechada: true });

    expect(opcoes.find((o) => o.key === "sys:upsell")!.disabled).toBe(false);
  });

  it("some da lista quando o lead já está na Carteira", () => {
    const opcoes = buildNewDealOptions(
      [...FUNIS.filter((p) => p !== CARTEIRA_VAZIA), { ...CARTEIRA_VAZIA, pipeId: "up-1" }],
      { canAdd: PODE, vendaFechada: true },
    );

    expect(opcoes.some((o) => o.key === "sys:upsell")).toBe(false);
  });
});

describe("buildNewDealOptions — sem permissão nada é criável", () => {
  it("trava TODAS as opções e carrega o motivo do gate, não um texto genérico", () => {
    const opcoes = buildNewDealOptions(FUNIS, {
      canAdd: { allowed: false, reason: "Perfil membro não abre negócio" },
      vendaFechada: true,
    });

    expect(opcoes.length).toBeGreaterThan(0);
    expect(opcoes.every((o) => o.disabled)).toBe(true);
    expect(opcoes.map((o) => o.disabledReason)).toContain("Perfil membro não abre negócio");
  });

  it("cai em 'Sem permissão' quando o gate nega sem dizer por quê", () => {
    const opcoes = buildNewDealOptions(FUNIS, {
      canAdd: { allowed: false },
      vendaFechada: false,
    });

    expect(opcoes[0].disabledReason).toBe("Sem permissão");
  });
});

describe("resolveNewDealTarget — chave que não casa NÃO vira escrita", () => {
  it("roteia funil do sistema para a linha vazia daquele funil", () => {
    const alvo = resolveNewDealTarget("sys:confirmacao", FUNIS);

    expect(alvo).toEqual({ kind: "standard", pipe: CONFIRMACAO_VAZIA });
  });

  it("roteia funil custom pelo id do pipeline", () => {
    const alvo = resolveNewDealTarget("custom:cp-1", FUNIS);

    expect(alvo).toEqual({ kind: "custom", pipe: CUSTOM_REATIVACAO });
  });

  it("devolve null quando o funil ganhou negócio embaixo do modal aberto", () => {
    // A lista mudou entre abrir e submeter: Confirmação já não é opção.
    const depois = FUNIS.map((p) =>
      p === CONFIRMACAO_VAZIA ? { ...CONFIRMACAO_VAZIA, pipeId: "entry-c" } : p,
    );

    expect(resolveNewDealTarget("sys:confirmacao", depois)).toBeNull();
  });

  it("devolve null para chave desconhecida em vez de escolher o mais parecido", () => {
    expect(resolveNewDealTarget("custom:cp-999", FUNIS)).toBeNull();
    expect(resolveNewDealTarget("sys:inventado", FUNIS)).toBeNull();
    expect(resolveNewDealTarget("confirmacao", FUNIS)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. A costura: botão do card → diálogo → RPC
// ─────────────────────────────────────────────────────────────────────────────

const leadSheet = {
  isOpen: true,
  leadId: "lead-1" as string | null,
  defaultExpandedPipeEntryId: null,
  openLead: vi.fn(),
  close: vi.fn(),
};
vi.mock("@/modules/leads/components/lead-detail/hooks/useLeadSheet", () => ({
  useLeadSheet: () => leadSheet,
  LeadPanelProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/modules/leads/components/deal-detail/deal-sheet-context", () => ({
  useDealSheet: () => ({ isOpen: false, entryId: null, leadId: null, openDeal: vi.fn(), close: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/modules/identity", () => ({
  useResponsibleMembers: () => [{ id: "tm-1", name: "Ana" }],
  useCurrentTeamMember: () => ({ data: { id: "tm-1", organization_id: "org-1" } }),
  isVirtualTeamMember: (id: string) => String(id).startsWith("master-virtual-"),
  // `LeadCardPanel` lê `role` para decidir se oferece CRIAR etiqueta nova.
  useOrganization: () => ({ organizationId: "org-1", teamMemberId: "tm-1", role: "admin", isReady: true }),
}));

const pipelinesMock = vi.fn(() => ({ data: FUNIS as PipelineStatus[], isLoading: false }));
const abrirNegocio = vi.fn().mockResolvedValue({});
/**
 * A guarda de tenant do caminho CUSTOM, como espião.
 *
 * Acrescentado na triagem (2026-08-06): mutei o código de produção removendo a
 * chamada de `assertMemberInOrg` do ramo custom de `useAbrirNegocio` e NENHUM
 * caso caiu — a suíte cobria a escrita, não a guarda. Como a guarda é
 * multi-tenant (impede escolher dono de outra organização), a ausência de
 * cobertura era o buraco mais caro do arquivo.
 */
// `vi.hoisted` porque o factory de `vi.mock` é içado acima das declarações:
// referenciar um `const` normal daqui estoura "Cannot access before
// initialization" e a suíte inteira deixa de carregar.
const { guardaDeTenant } = vi.hoisted(() => ({
  guardaDeTenant: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/leads/hooks/useLeadAllPipelines", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    useLeadAllPipelines: (...args: unknown[]) => pipelinesMock(...(args as [])),
    useAddLeadToStandardPipe: () => ({ mutateAsync: abrirNegocio, isPending: false }),
    useRemoveLeadFromStandardPipe: () => ({ mutateAsync: vi.fn(), isPending: false }),
    assertMemberInOrg: guardaDeTenant,
  };
});

const gate = { allowed: true, reason: null as string | null, isLoading: false };
vi.mock("@/modules/leads/components/lead-detail/hooks/useLeadActionGates", () => ({
  useLeadActionGates: () => ({ canAddToPipe: gate }),
}));

vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));

// Dados do card. O card em si é o de produção — é ele que carrega o botão.
const dadosDoCard = {
  id: "lead-1",
  nome: "Distética Suplementos",
  empresa: "Distética Comércio Ltda",
  telefone: null,
  email: null,
  uf: null,
  origem: "meta_ads",
  criadoEm: "2026-07-01T12:00:00.000Z",
  relacao: "lead",
  prova: null,
  situacao: null,
  dono: null,
  copilotAtivo: false,
  tags: [],
  metricas: {
    acumulado: 0,
    ticketMedio: 0,
    pedidos: 0,
    cicloDias: null,
    ultimaCompraDias: null,
    idadeDias: 30,
    semContatoDias: null,
  },
  negocios: [],
  nota: "",
  campos: [],
  historico: [],
};
vi.mock("@/modules/leads/components/lead-card/useLeadCardData", () => ({
  useLeadCardData: () => ({ data: dadosDoCard, isLoading: false, visibility: "exists" }),
}));

vi.mock("@/modules/leads/hooks/useLeads", () => ({
  useUpdateLead: () => ({ mutateAsync: vi.fn(), mutate: vi.fn() }),
  useToggleLeadAI: () => ({ mutate: vi.fn() }),
  useDeleteLead: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/modules/leads/hooks/useLeadCustomFields", () => ({
  useSaveCustomFieldValue: () => ({ mutateAsync: vi.fn() }),
}));
/* A faixa de etiquetas do card lê banco e org. O mock de `@/modules/identity`
   acima é parcial (só `useOrganization` não está nele), então `useTags` cairia
   direto no buraco — mocke a folha, não o barril. */
vi.mock("@/modules/leads/hooks/lead/useLeadTagsAttached", () => ({
  useLeadTagsAttached: () => ({ data: [], isLoading: false }),
  useAddLeadTag: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveLeadTag: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/modules/leads/hooks/useTags", () => ({
  useTags: () => ({ data: [], isLoading: false }),
  useCreateTag: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { LeadCardPanel } from "@/modules/leads/components/lead-card/LeadCardPanel";

const propostaVendida = { data: null as { status: string } | null, isLoading: false };

function montarCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MockPipeOpsProvider
        port={{
          usePipePropostaByLeadId: (() => propostaVendida) as never,
          useAddLeadToCustomPipe: () =>
            ({ mutateAsync: criarCustom, isPending: false }) as never,
        }}
      >
        <LeadCardPanel />
      </MockPipeOpsProvider>
    </QueryClientProvider>,
  );
}

const criarCustom = vi.fn().mockResolvedValue({});

/** Abre a aba Negócios e clica no "Criar negócio" que o card desenha. */
function clicarCriarNegocio() {
  fireEvent.click(screen.getByRole("button", { name: /negócios/i }));
  fireEvent.click(screen.getByRole("button", { name: /criar negócio/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  leadSheet.leadId = "lead-1";
  leadSheet.isOpen = true;
  gate.allowed = true;
  gate.reason = null;
  propostaVendida.data = null;
  pipelinesMock.mockReturnValue({ data: FUNIS, isLoading: false });
});

/**
 * Timeout explícito nos dois blocos que MONTAM o card.
 *
 * Medido em 2026-08-07: os 13 casos de render deste arquivo levam ~3,5s cada
 * nesta máquina (jsdom + `LeadCardPanel` inteiro + o Dialog do Radix), contra
 * ~1,1s de um teste de render comparável já no repo
 * (`pipe-whatsapp-agendar-move.test.tsx`). Com o default de 5s do Vitest os 13
 * estouram **por tempo, não por asserção** — com `--testTimeout=30000` os 26
 * passam. Os 13 casos de função pura (blocos de cima) rodam em milissegundos e
 * não precisam disto.
 *
 * Ou seja: o arquivo passava na máquina de quem escreveu e reprovava em
 * qualquer máquina ~4x mais lenta. Teste que depende da velocidade do runner
 * não é sinal — é moeda. O número abaixo é ~6x a medição, folga suficiente para
 * runner lento e ainda curto o bastante para um travamento de verdade (promise
 * que nunca resolve, `waitFor` sem alvo) continuar reprovando em vez de
 * pendurar a suíte.
 */
const TIMEOUT_RENDER_MS = 20_000;

describe("Card do Lead — o botão 'Criar negócio' abre a porta única", { timeout: TIMEOUT_RENDER_MS }, () => {
  it("o clique no card abre o diálogo de novo negócio", () => {
    montarCard();

    expect(screen.queryByTestId("new-deal-dialog")).toBeNull();
    clicarCriarNegocio();

    expect(screen.getByTestId("new-deal-dialog")).toBeInTheDocument();
  });

  it("oferece os funis vazios do lead — a mesma lista que a seção Negócios monta", () => {
    montarCard();
    clicarCriarNegocio();

    expect(screen.getByTestId("new-deal-option-sys:confirmacao")).toBeInTheDocument();
    expect(screen.getByTestId("new-deal-option-sys:propostas")).toBeInTheDocument();
    expect(screen.getByTestId("new-deal-option-custom:cp-1")).toBeInTheDocument();
    // Qualificação já tem negócio; Carteira está travada e vira chip, não opção.
    expect(screen.queryByTestId("new-deal-option-sys:whatsapp")).toBeNull();
    expect(screen.queryByTestId("new-deal-option-sys:upsell")).toBeNull();
  });

  it("submeter chega na RPC de abrir negócio com funil, etapa e dono", async () => {
    montarCard();
    clicarCriarNegocio();

    fireEvent.click(screen.getByTestId("new-deal-submit"));

    await waitFor(() =>
      expect(abrirNegocio).toHaveBeenCalledWith({
        leadId: "lead-1",
        pipeType: "confirmacao",
        stageId: "marcada",
        ownerId: "tm-1",
        saleValue: null,
        meetingDate: null,
        notes: null,
      }),
    );
  });

  it("escolher outro funil troca o alvo da escrita, não só o destaque", async () => {
    montarCard();
    clicarCriarNegocio();

    fireEvent.click(screen.getByTestId("new-deal-option-sys:propostas"));
    fireEvent.click(screen.getByTestId("new-deal-submit"));

    await waitFor(() =>
      expect(abrirNegocio).toHaveBeenCalledWith(
        expect.objectContaining({ pipeType: "propostas", stageId: "orcamento" }),
      ),
    );
  });

  it("funil custom não vai pela RPC do sistema — escreve em custom_pipe_entries", async () => {
    montarCard();
    clicarCriarNegocio();

    fireEvent.click(screen.getByTestId("new-deal-option-custom:cp-1"));
    fireEvent.click(screen.getByTestId("new-deal-submit"));

    await waitFor(() =>
      expect(criarCustom).toHaveBeenCalledWith(
        expect.objectContaining({
          lead_id: "lead-1",
          pipeline_id: "cp-1",
          stage_id: "cs-1",
        }),
      ),
    );
    expect(abrirNegocio).not.toHaveBeenCalled();
  });

  it("funil custom com dono escolhido CHECA a organização do dono antes de escrever", async () => {
    montarCard();
    clicarCriarNegocio();

    fireEvent.click(screen.getByTestId("new-deal-option-custom:cp-1"));
    fireEvent.click(screen.getByTestId("new-deal-submit"));

    await waitFor(() => expect(criarCustom).toHaveBeenCalled());
    // A guarda roda ANTES da escrita: dono de outra org não pode chegar ao
    // INSERT. Sem esta asserção, remover a chamada do ramo custom não reprova
    // nada — medido na triagem.
    expect(guardaDeTenant).toHaveBeenCalled();
    expect(guardaDeTenant.mock.invocationCallOrder[0]).toBeLessThan(
      criarCustom.mock.invocationCallOrder[0],
    );
  });

  it("dono de outra organização NÃO vira card no funil custom", async () => {
    guardaDeTenant.mockRejectedValueOnce(new Error("Responsável não pertence a esta organização"));
    montarCard();
    clicarCriarNegocio();

    fireEvent.click(screen.getByTestId("new-deal-option-custom:cp-1"));
    fireEvent.click(screen.getByTestId("new-deal-submit"));

    await waitFor(() => expect(guardaDeTenant).toHaveBeenCalled());
    expect(criarCustom).not.toHaveBeenCalled();
  });

  it("a observação digitada vai junto — é o contexto de quem pegar o negócio", async () => {
    montarCard();
    clicarCriarNegocio();

    fireEvent.change(screen.getByTestId("new-deal-notes"), {
      target: { value: "  Cliente pediu retorno na terça  " },
    });
    fireEvent.click(screen.getByTestId("new-deal-submit"));

    await waitFor(() =>
      expect(abrirNegocio).toHaveBeenCalledWith(
        expect.objectContaining({ notes: "Cliente pediu retorno na terça" }),
      ),
    );
  });

  it("o diálogo fecha depois de criar", async () => {
    montarCard();
    clicarCriarNegocio();

    fireEvent.click(screen.getByTestId("new-deal-submit"));

    await waitFor(() => expect(screen.queryByTestId("new-deal-dialog")).toBeNull());
  });

  it("erro na escrita mantém o diálogo aberto — o rascunho não se perde", async () => {
    abrirNegocio.mockRejectedValueOnce(new Error("RLS: negado"));
    montarCard();
    clicarCriarNegocio();

    fireEvent.change(screen.getByTestId("new-deal-notes"), {
      target: { value: "não posso perder isto" },
    });
    fireEvent.click(screen.getByTestId("new-deal-submit"));

    await waitFor(() => expect(abrirNegocio).toHaveBeenCalled());
    expect(screen.getByTestId("new-deal-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("new-deal-notes")).toHaveValue("não posso perder isto");
  });
});

describe("Card do Lead — o que o diálogo recusa", { timeout: TIMEOUT_RENDER_MS }, () => {
  it("sem permissão o diálogo abre, mas não há o que criar", () => {
    gate.allowed = false;
    gate.reason = "Perfil membro não abre negócio";
    montarCard();
    clicarCriarNegocio();

    expect(screen.getByTestId("new-deal-dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("new-deal-option-sys:confirmacao")).toBeNull();
    expect(screen.getByTestId("new-deal-submit")).toBeDisabled();
  });

  it("lead com negócio em todos os funis vê a explicação, não um diálogo vazio", () => {
    pipelinesMock.mockReturnValue({
      data: [
        QUALIFICACAO_COM_NEGOCIO,
        { ...CONFIRMACAO_VAZIA, pipeId: "entry-c" },
        { ...PROPOSTAS_VAZIA, pipeId: "entry-p" },
        { ...CARTEIRA_VAZIA, pipeId: "up-1" },
      ],
      isLoading: false,
    });
    montarCard();
    clicarCriarNegocio();

    expect(screen.getByTestId("new-deal-sem-funil")).toBeInTheDocument();
    expect(screen.getByTestId("new-deal-submit")).toBeDisabled();
  });

  it("Carteira destravada pela venda fechada passa a ser opção escolhível", () => {
    propostaVendida.data = { status: "vendido" };
    montarCard();
    clicarCriarNegocio();

    expect(screen.getByTestId("new-deal-option-sys:upsell")).toBeInTheDocument();
  });
});
