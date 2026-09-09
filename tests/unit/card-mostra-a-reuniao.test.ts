/**
 * A reunião marcada na Agenda tem de aparecer no card do funil (S6).
 *
 * ── O QUE ESTAVA QUEBRADO (medido em prod, 03/09) ──────────────────────────
 * Marcar reunião na Agenda gravava `meetings`, o espelho projeta a data em
 * `pipeline_entries.metadata.meeting_date` — e o card continuava mudo, atrás
 * de TRÊS portões independentes:
 *
 *   1. `transformToCard` nunca preenchia `LeadCardData.date`. Nenhum board do
 *      repo preenchia: `parsedDate` era sempre nulo em todo funil;
 *   2. a variante `custom` — a de TODO funil da página unificada — tinha
 *      `showDate: false`, então a linha nem era renderizada;
 *   3. o único lugar que desenhava reunião (`MergedFunnelCardActions`) exigia
 *      a flag `merged_opportunity_funnel` (2 orgs em prod) E um slug de uma
 *      lista de quatro. A etapa do caso concreto se chama "Reunião Marcada",
 *      slug `reuniao_marcada`, `stage_role = 'open'`: reprovava nos dois.
 *
 * ── O QUE ESTE ARQUIVO PRENDE ─────────────────────────────────────────────
 *   A data aparece porque EXISTE data — não porque a etapa se chama X, não
 *   porque a org tem flag Y. E a não-regressão que paga por isso: funil custom
 *   sem reunião não pode ganhar o convite "Sem data" (seria um convite a
 *   marcar reunião em card de funil de qualquer assunto), as variantes de
 *   sistema não mudam, e a org do funil mergeado não pode ver a mesma reunião
 *   duas vezes no mesmo card.
 *
 * Sem JSX de propósito: o arquivo é `.ts` (esbuild só compila JSX em `.tsx`).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const h = React.createElement;

// ── O board é montado de verdade; só os vizinhos entram como marcador ───────
const cardsRenderizados = vi.hoisted(
  () => [] as Array<Record<string, unknown>>,
);

vi.mock("@/modules/pipelines/components/kanban/DraggableKanbanBoard", () => ({
  DraggableKanbanBoard: ({
    columns,
    renderCard,
  }: {
    columns: Array<{ id: string; items: unknown[] }>;
    renderCard: (item: unknown) => React.ReactNode;
  }) =>
    h(
      "div",
      { "data-testid": "board" },
      columns.flatMap((c) => c.items.map((i, n) => h("div", { key: `${c.id}-${n}` }, renderCard(i)))),
    ),
}));

vi.mock("@/modules/leads", () => ({
  // Captura o shape que `transformToCard` produziu — é o contrato sob teste.
  LeadCard: (props: { lead: Record<string, unknown> }) => {
    cardsRenderizados.push(props.lead);
    return h("div", { "data-testid": "card" }, String(props.lead.name));
  },
}));

vi.mock("@/modules/pipelines/components/kanban/ExportStageDialog", () => ({
  ExportStageDialog: () => null,
}));
vi.mock("@/modules/pipelines/components/kanban/StageWorkflowsBadge", () => ({
  StageWorkflowsBadge: () => null,
}));
// A flag do funil mergeado começa DESLIGADA — é o estado de ~98% das orgs, e
// é a prova de que a data no card não depende dela. As 2 orgs que a têm são
// exercitadas no último bloco.
const orgFeatures = vi.hoisted(() => ({ mergeado: false }));
vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => ({ hasFeature: () => orgFeatures.mergeado }),
}));
vi.mock("@/modules/pipelines/hooks/model/useMergedFunnelActions", () => ({
  useMarkLost: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/modules/pipelines/components/kanban/MeetingConfirmationButton", () => ({
  MeetingConfirmationButton: () => h("button", null, "Confirmar reunião"),
}));
vi.mock("@/modules/pipelines/components/kanban/SetMeetingDateModal", () => ({
  SetMeetingDateModal: () => null,
}));
vi.mock("@/modules/pipelines/components/kanban/LossReasonDialog", () => ({
  LossReasonDialog: () => null,
}));
vi.mock("@/modules/workflows/hooks/useStageWorkflows", () => ({
  useCustomPipeStageWorkflows: () => ({ data: [] }),
  useCustomPipeWorkflowCounts: () => ({ data: {} }),
}));
vi.mock("@/modules/identity", () => ({ useCanDo: () => ({ allowed: true }) }));
vi.mock("@/shared/hooks/useBulkSelection", () => ({
  useBulkSelection: () => ({
    isSelected: () => false,
    toggle: vi.fn(),
    clear: vi.fn(),
    selected: [],
    count: 0,
  }),
}));
vi.mock("@/modules/leads/components/bulk-actions/BulkActionBar", () => ({
  BulkActionBar: () => null,
}));
vi.mock("@/modules/engagement/hooks/useAcoesDoDia", () => ({
  useCreateAcaoDoDia: () => ({ mutate: vi.fn(), isPending: false }),
}));

// ── Vizinhos do card compacto que escrevem no banco ────────────────────────
vi.mock("@/modules/leads/components/leads/card/LeadCardQualificationPopover", () => ({
  LeadCardQualificationPopover: () => null,
}));
vi.mock("@/modules/leads/components/leads/card/LeadCardChecklistPopover", () => ({
  LeadCardChecklistPopover: ({ children }: { children?: React.ReactNode }) =>
    h("div", null, children),
}));
vi.mock("@/modules/leads/components/etiquetas/LeadEtiquetasPopover", () => ({
  LeadEtiquetasPopover: () => null,
}));

const { FunilKanban } = await import("@/modules/pipelines/components/funis/FunilKanban");
const { LeadCardCompact } = await import(
  "@/modules/leads/components/leads/card/LeadCardCompact"
);
const { ehEtapaDeReuniao } = await import("@/modules/pipelines/lib/etapa-de-reuniao");
const { MergedFunnelCardActions } = await import(
  "@/modules/pipelines/components/kanban/MergedFunnelCardActions"
);

const PIPELINE_ID = "3587d29c-f8fb-4484-99b0-f3773dee75eb";
const REUNIAO = "2026-09-07T14:00:00.000Z";

/** A etapa do caso concreto: nome bonito, slug fora da lista, papel `open`. */
function etapa(over: Record<string, unknown> = {}) {
  return {
    id: "st-1",
    organization_id: "org-1",
    pipeline_id: PIPELINE_ID,
    stage_key: "reuniao_marcada",
    name: "Reunião Marcada",
    color: null,
    position: 0,
    is_active: true,
    is_final_positive: false,
    is_final_negative: false,
    stage_role: "open",
    target_pipeline_id: null,
    target_stage_id: null,
    target_pipe_type: null,
    target_stage_key: null,
    checklist_template_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function entrada(over: Record<string, unknown> = {}) {
  return {
    id: "486974ad-0a62-4210-9780-605165734aca",
    lead_id: "25559b77-4603-4177-84de-95cd8248c2d0",
    stage_key: "reuniao_marcada",
    notes: null,
    created_at: "2026-09-01T00:00:00Z",
    metadata: null,
    lead: { id: "lead-1", name: "Evandro", company: null, phone: null, email: null },
    ...over,
  };
}

function montarBoard(entradas: Array<Record<string, unknown>>, etapas = [etapa()]) {
  cardsRenderizados.length = 0;
  render(
    h(FunilKanban as never, {
      pipelineId: PIPELINE_ID,
      stages: etapas as never,
      stageData: {
        [etapas[0].stage_key as string]: {
          items: entradas,
          totalCount: entradas.length,
          hasMore: false,
          isFetchingMore: false,
        },
      } as never,
      onMove: vi.fn(),
    }),
  );
  return cardsRenderizados[0];
}

beforeEach(() => {
  cardsRenderizados.length = 0;
});

describe("O board do funil leva a reunião ao card", () => {
  it("a data espelhada no metadata vira a data do card", () => {
    const card = montarBoard([entrada({ metadata: { meeting_date: REUNIAO } })]);

    // `date` é a linha de compromisso do card — o campo que NENHUM board
    // preenchia. Sem ele, `parsedDate` é nulo e não há o que desenhar.
    expect(card.date).toBe(REUNIAO);
    expect(card.meetingDate).toBe(REUNIAO);
  });

  it("entrada sem reunião não inventa data", () => {
    const card = montarBoard([entrada()]);

    expect(card.date).toBeNull();
  });

  it("a coluna achatada por get_pipeline_page vale tanto quanto o metadata", () => {
    const card = montarBoard([entrada({ meeting_date: REUNIAO })]);

    expect(card.date).toBe(REUNIAO);
  });

  it("o card carrega o funil e o PAPEL da etapa, resolvidos no cliente", () => {
    const card = montarBoard(
      [entrada({ stage_key: "agendado" })],
      [etapa({ stage_key: "agendado", stage_role: "meeting_booked" })],
    );

    // `pipelineId` semeia o diálogo de reunião aberto pelo card (é o par
    // funil+lead que resolve o negócio); `stageRole` é o que aposenta a lista
    // de slugs chumbados — e nenhum dos dois mudou a assinatura da RPC.
    expect(card.pipelineId).toBe(PIPELINE_ID);
    expect(card.stageRole).toBe("meeting_booked");
  });

  it("etapa sem papel governado chega como null, não como 'open' inventado", () => {
    const card = montarBoard([entrada()], [etapa({ stage_role: null })]);

    expect(card.stageRole).toBeNull();
  });
});

// ── A regra de EXIBIÇÃO da linha de data ───────────────────────────────────

type ConfigDoCard = React.ComponentProps<typeof LeadCardCompact>["config"];

const CONFIG_CUSTOM: ConfigDoCard = {
  showContact: true,
  showValue: false,
  showDate: true,
  showProducts: false,
  showMeetLink: false,
  showNotes: true,
  showDateEmpty: false,
};

function montarCard(over: Record<string, unknown> = {}) {
  render(
    h(LeadCardCompact as never, {
      lead: { id: "e-1", name: "Evandro" },
      config: CONFIG_CUSTOM,
      origin: { bg: "", text: "", label: "WhatsApp" },
      urgency: null,
      dateIndicator: null,
      parsedDate: null,
      menuItems: null,
      ...over,
    }),
  );
}

describe("A data aparece porque existe data", () => {
  it("funil custom COM reunião desenha o compromisso", () => {
    montarCard({ parsedDate: new Date(2026, 8, 7, 11, 0) });

    expect(screen.getByText(/07\/09 · 11:00/)).toBeInTheDocument();
  });

  it("funil custom SEM reunião não ganha o convite 'Sem data'", () => {
    montarCard();

    // A não-regressão que paga pelo `showDate: true` da variante custom: o
    // convite azul num funil de assunto nenhum seria pedir para marcar uma
    // reunião que aquele funil nunca terá.
    expect(screen.queryByText("Sem data")).toBeNull();
  });

  it("variante de sistema mantém o convite 'Sem data' de hoje", () => {
    montarCard({ config: { ...CONFIG_CUSTOM, showDateEmpty: true } });

    expect(screen.getByText("Sem data")).toBeInTheDocument();
  });

  it("config sem a chave nova se comporta como antes (convite ligado)", () => {
    const { showDateEmpty: _omitida, ...semAChave } = CONFIG_CUSTOM;
    montarCard({ config: semAChave });

    expect(screen.getByText("Sem data")).toBeInTheDocument();
  });

  it("org que desligou a data continua sem linha nenhuma", () => {
    montarCard({
      config: { ...CONFIG_CUSTOM, showDate: false },
      parsedDate: new Date(2026, 8, 7, 11, 0),
    });

    expect(screen.queryByText(/07\/09/)).toBeNull();
    expect(screen.queryByText("Sem data")).toBeNull();
  });
});

// ── O portão dos BOTÕES do funil mergeado ──────────────────────────────────

describe("O portão de etapa do funil mergeado é união, nunca substituição", () => {
  it("os slugs de hoje continuam valendo — ninguém perde botão", () => {
    for (const slug of ["agendado", "remarcar", "compareceu", "nao_compareceu"]) {
      expect(ehEtapaDeReuniao(slug, null, null)).toBe(true);
    }
  });

  it("o PAPEL da etapa passa a valer, com slug próprio", () => {
    expect(ehEtapaDeReuniao("reuniao_marcada", "meeting_booked", null)).toBe(true);
  });

  it("haver reunião marcada basta", () => {
    expect(ehEtapaDeReuniao("reuniao_marcada", "open", REUNIAO)).toBe(true);
  });

  it("etapa sem reunião, sem papel e fora da lista fica de fora", () => {
    expect(ehEtapaDeReuniao("proposta_enviada", "open", null)).toBe(false);
    expect(ehEtapaDeReuniao(null, null, null)).toBe(false);
  });
});

// ── As 2 orgs do funil mergeado: nem botão a menos, nem data em dobro ──────

describe("A org do funil mergeado não vê a reunião duas vezes", () => {
  function montarAcoes(over: Record<string, unknown> = {}) {
    orgFeatures.mergeado = true;
    render(
      h(MergedFunnelCardActions as never, {
        entryId: "e-1",
        stageKey: "agendado",
        stageRole: null,
        meetingDate: REUNIAO,
        confirmationStatus: "pendente",
        onMoveStage: vi.fn(),
        ...over,
      }),
    );
  }

  it("mantém o botão de confirmação da etapa 'agendado'", () => {
    montarAcoes();

    expect(screen.getByText("Confirmar reunião")).toBeInTheDocument();
  });

  it("não desenha mais o foco de data — quem desenha é o card", () => {
    montarAcoes();

    // O componente imprimia "seg, 07/09 · 11:00" ao lado do botão. Com a data
    // virando linha do próprio card, manter isto aqui mostraria a MESMA
    // reunião duas vezes no mesmo cartão.
    expect(screen.queryByText(/07\/09/)).toBeNull();
    expect(screen.queryByText(/\d{2}:\d{2}/)).toBeNull();
  });

  it("etapa de reunião sem controle não deixa moldura vazia no card", () => {
    montarAcoes({ stageKey: "compareceu" });

    expect(screen.queryByText("Confirmar reunião")).toBeNull();
    expect(document.body.textContent).toBe("");
  });
});
