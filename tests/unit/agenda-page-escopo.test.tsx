/**
 * Página /agenda — a tela "Agenda" que o botão da lateral abre.
 *
 * Prova o que o pedido exige de ponta a ponta, sem banco:
 *   - cabeçalho "Agenda" + descrição + "Nova atividade" na área principal;
 *   - abas de estado e filtros;
 *   - usuário comum vê SÓ os próprios compromissos;
 *   - admin vê os de todo mundo, com o responsável identificável.
 *
 * `CreateMeetingDialog` entra dublado: ele arrasta `useLeads` e o form inteiro,
 * que não é o que esta tela precisa provar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// V5: o cabeçalho é o `PageHeader`, que chama `useNavigate` (botão de voltar).
// Na aplicação a tela sempre vive dentro do roteador — na rota `/agenda` e no
// `AgendaPanel` montado pela lateral —, então o teste monta o mesmo contexto.
import { MemoryRouter } from "react-router-dom";

import type { AgendaEvent } from "@/modules/engagement/hooks/useAgendaEvents";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const TEAM_MEMBER_ID = "22222222-2222-2222-2222-222222222222";
const OUTRO_MEMBER_ID = "33333333-3333-3333-3333-333333333333";

const identity = {
  userId: USER_ID,
  teamMemberId: TEAM_MEMBER_ID,
  isAdmin: false,
  isReady: true,
};

/**
 * `agenda.view_all` nasce LIGADA no catálogo: a agenda é da operação, e ver só
 * o que é seu é a exceção que um admin escolhe. O default daqui espelha o do
 * banco de propósito — se um dia divergirem, é este teste que grita.
 */
const permissao = { podeVerTodos: true, carregando: false };

vi.mock("@/modules/identity", () => ({
  useAuth: () => ({ session: { user: { id: USER_ID }, access_token: "t" } }),
  useIdentity: () => identity,
  useCanDo: (chave: string) =>
    chave === "agenda.view_all"
      ? { allowed: permissao.podeVerTodos, reason: "", isLoading: permissao.carregando }
      : { allowed: true, reason: "", isLoading: false },
  useTeamMembers: () => ({
    data: [
      { id: TEAM_MEMBER_ID, user_id: USER_ID, name: "Eu Mesmo", is_active: true },
      {
        id: OUTRO_MEMBER_ID,
        user_id: "44444444-4444-4444-4444-444444444444",
        name: "Ana Souza",
        is_active: true,
      },
    ],
  }),
}));

const agendaEvents: AgendaEvent[] = [];

vi.mock("@/modules/leads/hooks/useLeadResponsibles", () => ({
  useLeadResponsibles: () => ({ data: null, isLoading: false, isError: false }),
}));

vi.mock("@/modules/engagement/hooks/useAgendaEvents", () => ({
  useAgendaEvents: () => ({
    data: agendaEvents,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

const updateMeeting = vi.fn().mockResolvedValue({});

// 🚨 Este mock é EXAUSTIVO: substitui o módulo inteiro, então todo hook de
// `useMeetings` que a página passar a consumir tem que aparecer aqui — senão
// ele chega como `undefined` e a página quebra na montagem, culpando a branch
// errada. `useMeeting` entrou junto com o diálogo de edição.
vi.mock("@/modules/engagement/hooks/useMeetings", () => ({
  useDeleteMeeting: () => ({ mutateAsync: vi.fn() }),
  useUpdateMeeting: () => ({ mutateAsync: updateMeeting }),
  useMeeting: () => ({ data: null, isLoading: false, isError: false }),
}));

const participacoes = new Set<string>();

vi.mock("@/modules/engagement/hooks/useMyAgendaOwnership", () => ({
  useMyAgendaOwnership: () => ({ data: participacoes }),
}));

vi.mock("@/modules/integrations/hooks/useGoogleCalendar", () => ({
  useCalendarEvents: () => ({ data: undefined, isLoading: false, refetch: vi.fn() }),
  useGoogleCalendarStatus: () => ({ data: { connected: false } }),
}));

vi.mock("@/modules/integrations/hooks/useGoogleCalendarSharing", () => ({
  useCalendarSharing: () => ({ data: { incoming: [] } }),
}));

vi.mock(
  "@/modules/engagement/components/agenda/CreateMeetingDialog",
  () => ({ CreateMeetingDialog: () => null }),
);

vi.mock(
  "@/modules/engagement/components/agenda/EditMeetingDialog",
  () => ({ EditMeetingDialog: () => null }),
);

// Import depois dos mocks — a página resolve os hooks no topo do módulo.
const { default: Agenda } = await import("@/modules/engagement/pages/Agenda");

/** Um evento da RPC, no formato cru que `normalizeAgendaEvents` recebe. */
function rpcEvent(over: Partial<AgendaEvent> = {}): AgendaEvent {
  const start = new Date(2026, 7, 3, 16, 0);
  return {
    id: "e1",
    source: "meeting",
    title: "Reunião minha",
    description: null,
    start_at: start.toISOString(),
    end_at: new Date(2026, 7, 3, 17, 0).toISOString(),
    all_day: false,
    event_type: "meeting",
    status: "scheduled",
    lead_id: null,
    lead_name: null,
    lead_company: null,
    created_by: USER_ID,
    creator_name: "Eu Mesmo",
    location: null,
    meet_link: null,
    color: null,
    google_event_id: null,
    ...over,
  };
}

beforeEach(() => {
  agendaEvents.length = 0;
  participacoes.clear();
  updateMeeting.mockClear();
  identity.isAdmin = false;
  identity.isReady = true;
  permissao.podeVerTodos = true;
  permissao.carregando = false;
  vi.setSystemTime(new Date(2026, 7, 24, 9, 0));
});


/**
 * V5 (CTO, 02/10): a Agenda abre na SEMANA. Os casos de "quem vê o quê" foram
 * escritos sobre a grade do MÊS, onde todos os eventos da fixture aparecem —
 * o que eles provam é visibilidade, não a visão padrão. Por isso montam a tela
 * e trocam para o Mês; o caso da visão padrão está em "Agenda — moldura".
 */
async function renderAgendaNoMes() {
  const r = render(<Agenda />, { wrapper: MemoryRouter });
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Mês" }));
  // A troca de visão anima (AnimatePresence "wait"): o Mês monta depois.
  await screen.findByText("Segunda-feira");
  return r;
}

/** O número de um KPI pelo rótulo (o contador de atividades virou KPI). */
function kpi(rotulo: string) {
  const tile = screen.getByText(rotulo).parentElement!.parentElement!;
  return within(tile);
}

describe("Agenda — moldura da tela", () => {
  it("é uma página do sistema: título, descrição e ação no topo", async () => {
    await renderAgendaNoMes();
    expect(
      screen.getByRole("heading", { level: 1, name: "Agenda" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Crie, edite e gerencie/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Nova atividade/ }),
    ).toBeInTheDocument();
  });

  it("traz as abas de estado e a navegação do mês", async () => {
    await renderAgendaNoMes();
    expect(screen.getByRole("tab", { name: "Pendentes" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Todas atividades" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Finalizadas" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /agosto de 2026/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Período anterior")).toBeInTheDocument();
    expect(screen.getByLabelText("Próximo período")).toBeInTheDocument();
  });

  it("abre na SEMANA (decisão do CTO, 02/10) e oferece Semana · Mês · Dia", () => {
    render(<Agenda />, { wrapper: MemoryRouter });
    expect(screen.getByRole("tab", { name: "Semana" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Mês" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Dia" })).toBeInTheDocument();
    // A grade do mês (cabeçalho por extenso) NÃO é a primeira coisa.
    expect(screen.queryByText("Segunda-feira")).toBeNull();
  });

  it("no Mês, mostra a grade do mês", async () => {
    await renderAgendaNoMes();
    expect(screen.getByText("Segunda-feira")).toBeInTheDocument();
  });
});

describe("Agenda — quem vê o quê", () => {
  it("por padrão a agenda é da OPERAÇÃO: usuário comum vê o do colega também", async () => {
    agendaEvents.push(
      rpcEvent({ id: "meu", title: "Reunião minha", created_by: USER_ID }),
      rpcEvent({
        id: "dela",
        title: "Reunião da Ana",
        created_by: OUTRO_MEMBER_ID,
        creator_name: "Ana Souza",
      }),
    );

    await renderAgendaNoMes();

    expect(screen.getByText(/Reunião minha/)).toBeInTheDocument();
    expect(screen.getByText(/Reunião da Ana/)).toBeInTheDocument();
    expect(kpi("Compromissos no mês").getByText("2")).toBeInTheDocument();
  });

  it("sem a permissão `agenda.view_all`, vê o seu e NÃO vê o do colega", async () => {
    permissao.podeVerTodos = false;
    agendaEvents.push(
      rpcEvent({ id: "meu", title: "Reunião minha", created_by: USER_ID }),
      rpcEvent({
        id: "dela",
        title: "Reunião da Ana",
        created_by: OUTRO_MEMBER_ID,
        creator_name: "Ana Souza",
      }),
    );

    await renderAgendaNoMes();

    expect(screen.getByText(/Reunião minha/)).toBeInTheDocument();
    expect(screen.queryByText(/Reunião da Ana/)).not.toBeInTheDocument();
    expect(kpi("Compromissos no mês").getByText("1")).toBeInTheDocument();
  });

  it("recortado, enxerga o próprio follow-up, que vem com id de TEAM_MEMBER", async () => {
    permissao.podeVerTodos = false;
    agendaEvents.push(
      rpcEvent({
        id: "fu",
        source: "follow_up",
        event_type: "follow_up",
        title: "Ligar amanhã",
        created_by: TEAM_MEMBER_ID,
      }),
    );

    await renderAgendaNoMes();
    expect(screen.getByText(/Ligar amanhã/)).toBeInTheDocument();
  });

  it("recortado, follow-up SEM responsável não some — é o que a pessoa acabou de criar", async () => {
    permissao.podeVerTodos = false;
    agendaEvents.push(
      rpcEvent({
        id: "fu-sem-dono",
        source: "follow_up",
        event_type: "follow_up",
        title: "Retornar ligação",
        created_by: null,
        creator_name: null,
      }),
    );

    await renderAgendaNoMes();
    expect(screen.getByText(/Retornar ligação/)).toBeInTheDocument();
  });

  it("recortado, reunião marcada POR um colega COM o usuário aparece na agenda dele", async () => {
    permissao.podeVerTodos = false;
    agendaEvents.push(
      rpcEvent({
        id: "conv-1",
        title: "Reunião com a Ana",
        created_by: OUTRO_MEMBER_ID,
        creator_name: "Ana Souza",
      }),
    );

    // Sem a participação registrada, o convite não é dele.
    const { unmount } = await renderAgendaNoMes();
    expect(screen.queryByText(/Reunião com a Ana/)).not.toBeInTheDocument();
    unmount();

    participacoes.add("conv-1");
    await renderAgendaNoMes();
    expect(screen.getByText(/Reunião com a Ana/)).toBeInTheDocument();
  });

  it("quem vê a operação inteira recebe o filtro de atendente", async () => {
    await renderAgendaNoMes();
    expect(screen.getByLabelText("Filtrar por atendente")).toBeInTheDocument();
    expect(screen.getByLabelText("Filtrar por tipo")).toBeInTheDocument();
  });

  it("quem está recortado NÃO recebe o filtro de atendente", async () => {
    permissao.podeVerTodos = false;
    await renderAgendaNoMes();
    expect(screen.queryByLabelText("Filtrar por atendente")).toBeNull();
    // O filtro de tipo continua para todos.
    expect(screen.getByLabelText("Filtrar por tipo")).toBeInTheDocument();
  });

  it("admin atravessa mesmo com a permissão desligada — o cargo não perde a operação", async () => {
    // `get-member-permissions` ainda não lê `organization_feature_defaults`:
    // um default de org desligado chegaria aqui como `false` para o admin
    // também. O banco dá `true` para admin antes de qualquer camada; a tela
    // precisa concordar.
    identity.isAdmin = true;
    permissao.podeVerTodos = false;
    agendaEvents.push(
      rpcEvent({ id: "meu", title: "Reunião minha", created_by: USER_ID }),
      rpcEvent({
        id: "dela",
        title: "Reunião da Ana",
        created_by: OUTRO_MEMBER_ID,
        creator_name: "Ana Souza",
      }),
    );

    await renderAgendaNoMes();

    expect(screen.getByText(/Reunião minha/)).toBeInTheDocument();
    expect(screen.getByText(/Reunião da Ana/)).toBeInTheDocument();
    expect(screen.getByText("AS")).toBeInTheDocument(); // iniciais da Ana
    expect(kpi("Compromissos no mês").getByText("2")).toBeInTheDocument();
  });

  it("enquanto a identidade não resolve, vale a regra restrita", async () => {
    identity.isAdmin = true;
    identity.isReady = false; // ainda carregando
    agendaEvents.push(
      rpcEvent({
        id: "dela",
        title: "Reunião da Ana",
        created_by: OUTRO_MEMBER_ID,
      }),
    );

    await renderAgendaNoMes();
    expect(screen.queryByText(/Reunião da Ana/)).not.toBeInTheDocument();
  });

  it("enquanto a PERMISSÃO não resolve, vale a regra restrita", async () => {
    permissao.carregando = true;
    agendaEvents.push(
      rpcEvent({
        id: "dela",
        title: "Reunião da Ana",
        created_by: OUTRO_MEMBER_ID,
      }),
    );

    await renderAgendaNoMes();
    expect(screen.queryByText(/Reunião da Ana/)).not.toBeInTheDocument();
  });
});

describe("Agenda — registrar o resultado do compromisso", () => {
  /** Abre o popover do evento clicando na pílula da grade. */
  async function abrirEvento(titulo: RegExp) {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: titulo }));
    return user;
  }

  it("a contagem do período separa compareceu, não compareceu e sem registro", async () => {
    agendaEvents.push(
      rpcEvent({ id: "a", title: "Veio", status: "completed" }),
      rpcEvent({ id: "b", title: "Faltou", status: "no_show" }),
      rpcEvent({ id: "c", title: "Aberta", status: "scheduled" }),
    );

    await renderAgendaNoMes();

    // V5: a contagem virou KPI — "Reuniões realizadas" e "Aguardando desfecho".
    expect(kpi("Reuniões realizadas").getByText("1")).toBeInTheDocument();
    expect(kpi("Reuniões realizadas").getByText(/de 2 com desfecho · 1 não compareceram/)).toBeInTheDocument();
    expect(kpi("Aguardando desfecho").getByText("1")).toBeInTheDocument();
  });

  it("sem nada registrável, o KPI diz que não há desfecho — não inventa zero com contexto", async () => {
    agendaEvents.push(
      rpcEvent({ id: "fu", source: "follow_up", event_type: "follow_up", title: "Ligar" }),
    );
    await renderAgendaNoMes();
    expect(kpi("Reuniões realizadas").getByText("Nenhum desfecho registrado")).toBeInTheDocument();
    expect(kpi("Aguardando desfecho").getByText("Tudo registrado")).toBeInTheDocument();
  });

  it("registrar 'Compareceu' grava completed na linha certa", async () => {
    agendaEvents.push(rpcEvent({ id: "abc-1", title: "Reunião X" }));
    await renderAgendaNoMes();

    await abrirEvento(/Reunião X/);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Compareceu" }));

    expect(updateMeeting).toHaveBeenCalledWith({ id: "abc-1", status: "completed" });
  });

  it("registrar 'Não compareceu' grava no_show", async () => {
    agendaEvents.push(rpcEvent({ id: "abc-2", title: "Reunião Y" }));
    await renderAgendaNoMes();

    await abrirEvento(/Reunião Y/);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Não compareceu" }));

    expect(updateMeeting).toHaveBeenCalledWith({ id: "abc-2", status: "no_show" });
  });

  it("clicar no que já está marcado volta para scheduled", async () => {
    agendaEvents.push(
      rpcEvent({ id: "abc-3", title: "Reunião Z", status: "completed" }),
    );
    await renderAgendaNoMes();

    await abrirEvento(/Reunião Z/);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Compareceu" }));

    expect(updateMeeting).toHaveBeenCalledWith({ id: "abc-3", status: "scheduled" });
  });

  it("o controle NÃO aparece em item que veio de outra tela", async () => {
    agendaEvents.push(
      rpcEvent({
        id: "fu-1",
        source: "follow_up",
        event_type: "follow_up",
        title: "Ligar amanhã",
      }),
    );
    await renderAgendaNoMes();

    await abrirEvento(/Ligar amanhã/);
    expect(screen.queryByRole("button", { name: "Compareceu" })).toBeNull();
  });

  /**
   * Este caso monta a Agenda inteira CINCO vezes — uma por `event_type` — e o
   * teto padrão do vitest é 5s para o `it()` todo, não por volta. Sozinho o
   * arquivo cabia; na suíte em paralelo, não. É custo de wall clock declarado,
   * não defeito mascarado: o que se afirma aqui (um `event_type` por volta,
   * mesma implementação) é assertivo e independente de tempo.
   *
   * Mesma classe do teto que a #1810 subiu na fronteira `React.lazy` do painel.
   */
  const TETO_CINCO_MONTAGENS = 30_000;

  /**
   * Presença é exclusiva de `event_type=meeting` desde a #2109 (reuniões
   * canônicas, 14/09 — `podeRegistrarResultado` em agenda-helpers.ts e a nota
   * do engagement/CLAUDE.md). Este caso nasceu em 24/08, quando QUALQUER tipo
   * da tabela `meetings` registrava resultado, e passou a falhar na main com a
   * #2109 sem que ninguém o atualizasse. Ele agora afirma a regra vigente nas
   * duas pontas: reunião registra; ligação, follow-up, tarefa e "outro" — mesmo
   * vindo da tabela `meetings` — não oferecem o controle.
   */
  it("presença é só de reunião: os outros quatro tipos não oferecem o controle", async () => {
    for (const tipo of ["meeting", "call", "follow_up", "task", "other"]) {
      agendaEvents.length = 0;
      updateMeeting.mockClear();
      agendaEvents.push(
        rpcEvent({ id: `id-${tipo}`, title: `Item ${tipo}`, event_type: tipo }),
      );
      const { unmount } = await renderAgendaNoMes();

      await abrirEvento(new RegExp(`Item ${tipo}`));
      // Controle positivo: o detalhe ABRIU — a ausência do botão abaixo não
      // pode ser só a ausência do popover.
      expect(await screen.findByRole("button", { name: "Fechar detalhes" }), tipo).toBeInTheDocument();

      if (tipo === "meeting") {
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "Compareceu" }));
        expect(updateMeeting, tipo).toHaveBeenCalledWith({
          id: `id-${tipo}`,
          status: "completed",
        });
      } else {
        expect(screen.queryByRole("button", { name: "Compareceu" }), tipo).toBeNull();
        expect(updateMeeting, tipo).not.toHaveBeenCalled();
      }
      unmount();
    }
  }, TETO_CINCO_MONTAGENS);
});
