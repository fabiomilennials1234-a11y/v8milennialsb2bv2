/**
 * Agenda layout helpers and constants.
 *
 * Pure functions extracted from the original Agenda.tsx monolith.
 * No React imports — these are reusable across all calendar views.
 */

import {
  differenceInMinutes,
  startOfWeek,
  startOfMonth,
  addDays,
  getHours,
  getMinutes,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import type { AgendaEvent as RpcAgendaEvent } from "@/modules/engagement/hooks/useAgendaEvents";
import type { CalendarEvent } from "@/modules/integrations/hooks/useGoogleCalendar";

// ─── Constants ────────────────────────────────────────────────────────────────

export const HOUR_HEIGHT = 64; // px per hour in time grid
export const HOURS = Array.from({ length: 24 }, (_, i) => i);
export const DAY_NAMES_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/**
 * Cabeçalho por extenso da grade mensal. Convive com `DAY_NAMES_SHORT`: a grade
 * mostra o nome inteiro quando há largura e cai no curto no celular, em vez de
 * truncar "Segunda-feira" no meio.
 */
export const DAY_NAMES_FULL = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];

/** Source → colour mapping for the unified agenda. */
export const SOURCE_COLORS: Record<string, string> = {
  meeting: "hsl(47, 100%, 50%)",      // gold (primary brand)
  follow_up: "#10B981",                // emerald
  scheduled_message: "#3B82F6",        // blue
  pipe_confirmacao: "#8B5CF6",         // violet
  // Source 5 (funil mergeado). Mesmo ouro de `meeting` DE PROPÓSITO: é o que a
  // tela já mostra hoje, porque a chave faltava e caía no fallback da linha
  // 371. Escrever explícito não muda pixel nenhum — só tira a cor do acaso.
  meeting_event: "hsl(47, 100%, 50%)",
  google: "#4285F4",                   // Google blue (overlay)
};

/**
 * Human-readable source labels (pt-BR).
 *
 * 🚨 `meeting_event` faltava aqui, e a falta era VISÍVEL: os três lugares que
 * leem este mapa caem em `?? event.source` (`EventDetailPopover.tsx:229`,
 * `TimeGridEvent.tsx:61`, `DayAgendaView.tsx:58`), então a Agenda vinha
 * imprimindo o identificador cru **"meeting_event"** para o usuário desde que a
 * Source 5 entrou no PROD à mão, em 30/07/2026. O fallback não deixou barulho
 * nenhum — nem erro, nem tipo vermelho, porque `normalizeAgendaEvents` casta
 * `e.source as EventSource` sem checar.
 */
export const SOURCE_LABELS: Record<string, string> = {
  meeting: "Reunião",
  follow_up: "Follow-up",
  scheduled_message: "Mensagem Agendada",
  // SCRUM-641: sem nome de funil cravado — o rótulo diz o QUE o evento é.
  pipe_confirmacao: "Reunião do funil",
  meeting_event: "Reunião do funil",
  google: "Google Calendar",
};

/** Visões do calendário. Mora aqui, e não no componente, porque a página e a
 *  barra antiga precisam do mesmo vocabulário sem depender uma da outra. */
export type ViewType = "day" | "week" | "month";

// ─── Event-type filter (by event_type, not source) ─────────────────────────────

export type EventTypeKey = "meeting" | "call" | "follow_up" | "task" | "other";

/** Filterable event types, in display order. */
export const EVENT_TYPE_KEYS: EventTypeKey[] = [
  "meeting",
  "call",
  "follow_up",
  "task",
  "other",
];

export const EVENT_TYPE_LABELS: Record<EventTypeKey, string> = {
  meeting: "Reunião",
  call: "Ligação",
  follow_up: "Follow-up",
  task: "Tarefa",
  other: "Outro",
};

export const EVENT_TYPE_COLORS: Record<EventTypeKey, string> = {
  meeting: "hsl(47, 100%, 50%)", // gold (brand)
  call: "#3B82F6", // blue
  follow_up: "#10B981", // emerald
  task: "#8B5CF6", // violet
  other: "#8a857a", // mute
};

/**
 * Collapse any event_type (across all sources) into one of the five filterable
 * buckets. Unknown types and Google overlay events fall under "other".
 */
export function normalizeEventType(t: string | null | undefined): EventTypeKey {
  if (t === "meeting" || t === "call" || t === "follow_up" || t === "task") {
    return t;
  }
  return "other";
}

// ─── Estado do compromisso (pendente × finalizado) ────────────────────────────

/** Abas de estado da tela — mesmo vocabulário que a operação usa. */
export type AgendaStatusFilter = "pending" | "all" | "done";

/**
 * Status terminais das CINCO fontes da agenda. Cada uma fala um dialeto:
 * `meetings` usa o enum `MeetingStatus`, `follow_ups` vira `completed` na
 * própria RPC, `scheduled_user_messages` usa o ciclo de envio,
 * `pipe_confirmacao` grava a chave da etapa do kanban (`compareceu`/`perdido`)
 * e `meeting_events` (Source 5, funil mergeado) devolve `completed`/`scheduled`.
 *
 * A Source 5 não precisou de entrada nova aqui porque REUSA `completed`, que
 * já estava na lista por causa de `meetings` — é por isso que ela entrou em
 * produção em 30/07 sem quebrar a aba "Pendentes". Não é sorte que se possa
 * repetir: uma sexta fonte com vocabulário próprio precisa ser adicionada.
 *
 * O que não estiver aqui conta como pendente — desconhecido nunca some da aba
 * "Pendentes", que é a que a pessoa abre para trabalhar.
 */
const FINISHED_STATUSES = new Set([
  // meetings
  "completed",
  "cancelled",
  "canceled",
  "no_show",
  // scheduled_user_messages
  "sent",
  "failed",
  // pipe_confirmacao (stage_key)
  "compareceu",
  "perdido",
]);

/** Um compromisso está finalizado quando o status é terminal. */
export function isFinishedEvent(event: UnifiedEvent): boolean {
  return FINISHED_STATUSES.has((event.status ?? "").toLowerCase());
}

/** Aplica a aba de estado sobre a lista já normalizada. */
export function matchesStatusFilter(
  event: UnifiedEvent,
  filter: AgendaStatusFilter,
): boolean {
  if (filter === "all") return true;
  const done = isFinishedEvent(event);
  return filter === "done" ? done : !done;
}

// ─── Escopo de visibilidade (comum × admin) ───────────────────────────────────

/**
 * `created_by` na RPC `get_agenda_events` **não é uma chave só**: para
 * `meetings` vem de `auth.users.id` (o JOIN em prod é `tm.user_id =
 * m.created_by`), e para `follow_ups`, `scheduled_user_messages`,
 * `pipe_confirmacao` e `meeting_events` vem de `team_members.id`. Por isso a
 * comparação é contra um CONJUNTO de identidades do usuário — comparar contra
 * uma só casaria zero linha em QUATRO das cinco fontes.
 */
export function buildOwnerIdentity(
  userId: string | null,
  teamMemberId: string | null,
): Set<string> {
  return new Set([userId, teamMemberId].filter((v): v is string => !!v));
}

/**
 * O evento é visível para quem tem estas identidades.
 *
 * Três portas, e cada uma existe por um motivo medido:
 *
 * 1. **Google** entra sempre — é o calendário que a própria pessoa conectou,
 *    mais os que colegas compartilharam com ela de propósito. Recortar ali
 *    apagaria uma funcionalidade que já tem consentimento explícito.
 * 2. **Sem dono** (`created_by` nulo) entra sempre. Parece o contrário do
 *    seguro, e não é: `follow_ups.assigned_to` é nulável e a própria UI grava
 *    follow-up sem responsável; em `pipe_confirmacao` o dono é
 *    `COALESCE(closer_id, sdr_id)`, nulo em boa parte da base. Esconder o
 *    ownerless apagaria da agenda da pessoa o compromisso que ELA criou —
 *    perda de trabalho, não ganho de privacidade. Compromisso de ninguém
 *    também não é "de outra pessoa".
 * 3. **Dono batendo** com alguma das identidades — ver `buildOwnerIdentity`.
 *
 * `extraIds` carrega o que não vem em `created_by`: hoje, as reuniões em que a
 * pessoa é participante convidada.
 */
export function isOwnedBy(
  event: UnifiedEvent,
  ownerIds: Set<string>,
  extraIds?: Set<string>,
): boolean {
  if (event.source === "google") return true;
  if (!event.createdBy) return true;
  if (ownerIds.has(event.createdBy)) return true;
  return !!extraIds?.has(rawEventId(event));
}

/**
 * O id da linha de origem, sem o prefixo de fonte que `normalizeAgendaEvents`
 * adiciona para evitar colisão entre tabelas (`meeting-<uuid>`).
 *
 * O corte é pelo comprimento da fonte, não pelo primeiro hífen: um uuid é
 * cheio de hífen, e um `source` novo com hífen no nome quebraria a busca sem
 * fazer barulho.
 */
export function rawEventId(event: UnifiedEvent): string {
  const prefixo = `${event.source}-`;
  return event.id.startsWith(prefixo) ? event.id.slice(prefixo.length) : event.id;
}

// ─── Geometria do popover de detalhe ─────────────────────────────────────────

/** Folga entre o popover e as bordas direita/esquerda/inferior da janela. */
export const POPOVER_MARGEM = 16;

/** Folga do topo. Menor que a de baixo — a faixa de cima é mais disputada. */
export const POPOVER_TOPO = 8;

/** Deslocamento do popover em relação ao ponto clicado. */
const POPOVER_OFFSET_X = 14;
const POPOVER_OFFSET_Y = 16;

export interface CaixaDoPopover {
  /** Coordenadas do clique, em espaço de viewport (`clientX`/`clientY`). */
  x: number;
  y: number;
  /** Tamanho REAL do card já renderizado. */
  largura: number;
  altura: number;
  vw: number;
  vh: number;
}

/**
 * Onde o popover pousa para caber inteiro na janela.
 *
 * 🚨 Esta função é chamada TODA VEZ que o card muda de tamanho, não só quando
 * o clique muda de lugar — e essa é a regra que o defeito original violava.
 * O bloco de confirmação da exclusão cresce o card ~72px DEPOIS que ele já foi
 * grudado no rodapé por `top = vh - altura - MARGEM`; sem recalcular, os
 * botões Cancelar/Excluir nascem abaixo da borda da janela. Como o card é
 * `position: fixed`, não existe rolagem que os alcance: a lixeira vira um
 * botão que não faz nada.
 *
 * O grude é nas quatro bordas, não só na de baixo: um clique colado na
 * esquerda com um card largo produzia `left` negativo pelo mesmo motivo.
 */
export function posicionarPopover({
  x,
  y,
  largura,
  altura,
  vw,
  vh,
}: CaixaDoPopover): { left: number; top: number } {
  let left = x + POPOVER_OFFSET_X;
  // Não coube à direita: espelha para o outro lado do cursor.
  if (left + largura > vw - POPOVER_MARGEM) left = x - largura - POPOVER_OFFSET_X;
  if (left < POPOVER_MARGEM) left = POPOVER_MARGEM;

  let top = y - POPOVER_OFFSET_Y;
  if (top + altura > vh - POPOVER_MARGEM) top = vh - altura - POPOVER_MARGEM;
  if (top < POPOVER_TOPO) top = POPOVER_TOPO;

  return { left, top };
}

/**
 * Teto de altura do card. Card mais alto que a janela não tem posição boa —
 * passa a rolar por dentro em vez de vazar pela borda.
 */
export const POPOVER_ALTURA_MAXIMA = `calc(100vh - ${POPOVER_TOPO + POPOVER_MARGEM}px)`;

/** Iniciais do responsável — identifica o dono sem gastar a largura da pílula. */
export function initialsOf(name: string | null | undefined): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Google Calendar event colorId → hex. */
export const GOOGLE_EVENT_COLORS: Record<string, string> = {
  "1": "#7986CB",
  "2": "#33B679",
  "3": "#8E24AA",
  "4": "#E67C73",
  "5": "#F6BF26",
  "6": "#F4511E",
  "7": "#039BE5",
  "8": "#3F51B5",
  "9": "#0B8043",
  "10": "#D50000",
  "11": "#616161",
};

// ─── Unified event type ───────────────────────────────────────────────────────

/**
 * As fontes que `get_agenda_events` devolve, mais o overlay do Google.
 *
 * ⚠️ `meeting_event` (Source 5, o funil mergeado) esteve FORA desta união por
 * quase um mês, enquanto já saía do banco: `normalizeAgendaEvents` faz
 * `e.source as EventSource`, um cast cego, então o compilador nunca teve como
 * reclamar. A união fechada aqui é o que faz um `switch` exaustivo e os mapas
 * `SOURCE_*` cobrirem a fonte nova — deixá-la de fora não dava erro, dava
 * fallback silencioso.
 */
export type EventSource =
  | "meeting"
  | "follow_up"
  | "scheduled_message"
  | "pipe_confirmacao"
  | "meeting_event"
  | "google";

export interface UnifiedEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  source: EventSource;
  color: string;
  // Extra fields carried through for the popover
  description: string | null;
  location: string | null;
  meetLink: string | null;
  leadId: string | null;
  leadName: string | null;
  leadCompany: string | null;
  creatorName: string | null;
  /**
   * Dono do compromisso. Chave heterogênea por fonte — ver
   * `buildOwnerIdentity`. Nulo em evento sem responsável e no overlay Google.
   */
  createdBy: string | null;
  status: string;
  eventType: string;
  googleEventId: string | null;
  /** Original Google Calendar event fields for overlay events */
  googleHtmlLink: string | null;
  /** Owner of a shared Google calendar (only for google source) */
  googleCalendarOwnerId: string | null;
  googleCalendarOwnerName: string | null;
  googleCalendarColor: string | null;
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

export function getEventTop(event: UnifiedEvent, dayStart: Date): number {
  const minutes = differenceInMinutes(event.start, dayStart);
  return (minutes / 60) * HOUR_HEIGHT;
}

export function getEventHeight(event: UnifiedEvent): number {
  const duration = Math.max(differenceInMinutes(event.end, event.start), 30);
  return (duration / 60) * HOUR_HEIGHT;
}

/**
 * Greedy interval-graph colouring for side-by-side overlap layout.
 *
 * Events that don't overlap get full width; overlapping events share width
 * equally. Returns a map of eventId -> { left, width } as fractions (0-1).
 */
export function computeEventLayout(
  events: UnifiedEvent[],
): Map<string, { left: number; width: number }> {
  const result = new Map<string, { left: number; width: number }>();
  if (events.length === 0) return result;

  const sorted = [...events].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );

  // Group into transitive overlap clusters
  const clusters: UnifiedEvent[][] = [];
  let cluster: UnifiedEvent[] = [];
  let clusterMaxEnd = new Date(0);

  for (const event of sorted) {
    if (cluster.length === 0 || event.start < clusterMaxEnd) {
      cluster.push(event);
      if (event.end > clusterMaxEnd) clusterMaxEnd = event.end;
    } else {
      clusters.push(cluster);
      cluster = [event];
      clusterMaxEnd = event.end;
    }
  }
  if (cluster.length > 0) clusters.push(cluster);

  // Greedy column allocation within each cluster
  for (const clusterEvents of clusters) {
    const colEnds: Date[] = [];
    const eventCols = new Map<string, number>();

    for (const event of clusterEvents) {
      let placed = false;
      for (let i = 0; i < colEnds.length; i++) {
        if (colEnds[i] <= event.start) {
          colEnds[i] = event.end;
          eventCols.set(event.id, i);
          placed = true;
          break;
        }
      }
      if (!placed) {
        eventCols.set(event.id, colEnds.length);
        colEnds.push(event.end);
      }
    }

    const totalCols = colEnds.length;
    for (const event of clusterEvents) {
      const col = eventCols.get(event.id)!;
      result.set(event.id, { left: col / totalCols, width: 1 / totalCols });
    }
  }

  return result;
}

export function getNowTop(): number {
  const now = new Date();
  return ((getHours(now) * 60 + getMinutes(now)) / 60) * HOUR_HEIGHT;
}

export function getWeekDays(date: Date): Date[] {
  const start = startOfWeek(date, { locale: ptBR });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function getMonthGrid(date: Date): Date[] {
  const gridStart = startOfWeek(startOfMonth(date), { locale: ptBR });
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

// ─── Data normalizers ─────────────────────────────────────────────────────────

/** Convert RPC AgendaEvent[] into our unified shape. */
export function normalizeAgendaEvents(events: RpcAgendaEvent[]): UnifiedEvent[] {
  return events.map((e) => {
    const source = e.source as EventSource;
    const color = e.color ?? SOURCE_COLORS[source] ?? SOURCE_COLORS.meeting;
    const startDate = new Date(e.start_at);
    const endDate = e.end_at
      ? new Date(e.end_at)
      : new Date(startDate.getTime() + 30 * 60_000); // default 30min

    return {
      id: `${source}-${e.id}`,
      title: e.title,
      start: startDate,
      end: endDate,
      allDay: e.all_day,
      source,
      color,
      description: e.description,
      location: e.location,
      meetLink: e.meet_link,
      leadId: e.lead_id,
      leadName: e.lead_name,
      leadCompany: e.lead_company,
      creatorName: e.creator_name,
      createdBy: e.created_by,
      status: e.status,
      eventType: e.event_type,
      googleEventId: e.google_event_id,
      googleHtmlLink: null,
      googleCalendarOwnerId: null,
      googleCalendarOwnerName: null,
      googleCalendarColor: null,
    };
  });
}

/** Convert Google Calendar overlay events into our unified shape. */
export function normalizeGoogleEvents(
  events: unknown[],
  ownerCalendars: Array<{ id: string; name: string; color: string }>,
  ownUserId: string,
): UnifiedEvent[] {
  type RawEvent = Record<string, unknown> & { calendar_owner_id?: string };
  return (events as RawEvent[])
    .filter((e) => {
      const status = typeof e.status === "string" ? e.status : "";
      return status !== "cancelled";
    })
    .map((e) => {
      const ownerId = (e.calendar_owner_id ?? ownUserId) as string;
      const calInfo = ownerCalendars.find((c) => c.id === ownerId);

      // Normalize date fields (Google API objects vs cached strings)
      type DateField = { dateTime?: string; date?: string } | string | undefined;
      const toStr = (f: DateField): string => {
        if (!f) return "";
        if (typeof f === "string") return f;
        return f.dateTime ?? f.date ?? "";
      };

      const startStr = toStr(e.start as DateField);
      const endStr = toStr(e.end as DateField) || startStr;
      const isAllDay = !!(
        typeof e.start === "object" &&
        e.start &&
        "date" in e.start &&
        !("dateTime" in e.start)
      );

      const googleColorId = e.colorId as string | undefined;
      const googleColor = googleColorId ? GOOGLE_EVENT_COLORS[googleColorId] : null;
      const color = googleColor ?? calInfo?.color ?? SOURCE_COLORS.google;

      const meetLink =
        (e.meet_link as string | null) ??
        (e.hangoutLink as string | null) ??
        null;

      return {
        id: `google-${e.id as string}`,
        title: (e.summary as string) ?? "(sem titulo)",
        start: new Date(startStr),
        end: new Date(endStr),
        allDay: isAllDay,
        source: "google" as EventSource,
        color,
        description: (e.description as string | null) ?? null,
        location: (e.location as string | null) ?? null,
        meetLink,
        leadId: (e.lead_id as string | null) ?? null,
        leadName: null,
        leadCompany: null,
        creatorName: calInfo?.name ?? null,
        createdBy: null,
        status: (e.status as string) ?? "confirmed",
        eventType: "google",
        googleEventId: (e.id as string) ?? null,
        googleHtmlLink:
          (e.htmlLink as string | null) ??
          (e.html_link as string | null) ??
          null,
        googleCalendarOwnerId: ownerId,
        googleCalendarOwnerName: calInfo?.name ?? null,
        googleCalendarColor: calInfo?.color ?? null,
      };
    });
}

// ─── Painel sobreposto da Agenda ──────────────────────────────────────────────

/**
 * Faixa mínima da página de baixo que fica à mostra, em px. É o que separa
 * "consultar a agenda" de "sair da página": abaixo disso a camada vira uma
 * troca de tela disfarçada.
 */
const MIN_FAIXA_VISIVEL = 72;

/** Proporção da referência do DataCrazy: painel na direita, página na esquerda. */
const PROPORCAO_PAINEL = 0.65;

/** Acima disto o painel para de crescer — calendário não ganha com 2000px. */
const LARGURA_MAXIMA_PAINEL = 1280;

/**
 * Piso de sanidade. A lateral só é montada a partir de 768px, então o teto real
 * nunca chega perto disto; existe para nunca renderizar painel de 0px.
 */
const LARGURA_MINIMA_PAINEL = 360;

/**
 * Largura do painel da Agenda, em px.
 *
 * Em CSS isto seria `width: min(65%, 1280px)` com
 * `max-width: calc(100vw - <lateral> - 72px)`, e foi assim que nasceu. Virou
 * número por uma razão medida: o jsdom **não parseia `min()`** (a propriedade
 * some inteira) e **reescreve `calc(100vw - 248px - 72px)` como
 * `calc(100vw - 72px + 248px)`** — com o sinal trocado. Cálculo que o teste não
 * consegue ler é cálculo que ninguém protege, e este carrega a promessa da
 * tela: a página de baixo nunca some.
 */
export function larguraDoPainel(
  viewportWidth: number,
  sidebarWidth: number,
): number {
  const teto = viewportWidth - sidebarWidth - MIN_FAIXA_VISIVEL;
  const desejada = Math.min(viewportWidth * PROPORCAO_PAINEL, LARGURA_MAXIMA_PAINEL);
  return Math.round(Math.max(Math.min(desejada, teto), LARGURA_MINIMA_PAINEL));
}

// ─── Resultado do compromisso (compareceu × não compareceu) ───────────────────

/**
 * O resultado registrado. `null` é "ainda não registrado" — e é estado de
 * primeira classe: o pedido diz que compromisso sem resultado não conta nem de
 * um lado nem do outro.
 */
export type AttendanceOutcome = "compareceu" | "nao_compareceu";

/**
 * `meetings.status` já modelava isto antes de existir botão para gravá-lo. O
 * CHECK da tabela é `scheduled | completed | cancelled | no_show` (baseline,
 * `meetings_status_check`), então:
 *
 *   compareceu      → `completed`
 *   não compareceu  → `no_show`
 *   sem registro    → `scheduled`
 *
 * Nenhuma coluna nova, nenhuma migration. Reaproveitar o que já existe era o
 * pedido, e aqui a estrutura existente já era exatamente a certa.
 */
const STATUS_POR_RESULTADO: Record<AttendanceOutcome, string> = {
  compareceu: "completed",
  nao_compareceu: "no_show",
};

/** Status gravado quando a pessoa DESMARCA o resultado — volta a "sem registro". */
export const STATUS_SEM_RESULTADO = "scheduled";

export function statusDoResultado(resultado: AttendanceOutcome): string {
  return STATUS_POR_RESULTADO[resultado];
}

/**
 * Onde os botões aparecem.
 *
 * Só na fonte `meeting` — que NÃO quer dizer "só reunião". Os cinco tipos do
 * botão "Nova atividade" (reunião, ligação, follow-up, tarefa, outro) são todos
 * linhas de `meetings`, distinguidas por `event_type` (CHECK
 * `meetings_event_type_check`). Uma implementação só cobre os cinco, que é o
 * que o pedido exige.
 *
 * As outras QUATRO fontes da agenda são LEITURA de telas alheias: `follow_ups`
 * pertence a Follow-ups, `pipe_confirmacao` é etapa de kanban (marcar
 * comparecimento ali moveria o card), mensagem agendada não comparece a nada, e
 * `meeting_events` (Source 5, `source = 'meeting_event'`) é o funil mergeado —
 * tabela IMUTÁVEL de eventos, onde não existe UPDATE de status para gravar.
 *
 * ⚠️ Este parágrafo dizia "três" e estava certo em 24/08 pelo repo e errado pelo
 * PROD: a Source 5 já estava viva em produção desde 30/07 e só foi versionada em
 * `20270831000020`. A guarda que vale é o `=== "meeting"` da linha abaixo, que
 * exclui `meeting_event` por construção; a prosa é que precisou correr atrás.
 */
/**
 * Reunião cancelada — o QUARTO valor do `meetings_status_check`, que a UI nunca
 * mostrou e ninguém nunca escreveu.
 *
 * Varri o repo inteiro à procura de um escritor e não existe: os três únicos
 * caminhos de escrita em `meetings` são `useCreateMeeting` (nunca manda
 * `status`, cai no DEFAULT `scheduled`), `useUpdateMeeting` (um só chamador de
 * produção, o handler desta tela, que emite `completed`/`no_show`/`scheduled`)
 * e `useDeleteMeeting` (DELETE duro, não soft-cancel). O webhook do Google
 * Calendar TRATA evento cancelado, mas escreve em `google_calendar_events_cache`
 * — nunca em `meetings`. Zero `UPDATE meetings` em todas as migrations,
 * inclusive as 840 arquivadas.
 *
 * Então por que a guarda existe? Porque o dia em que alguém ligar o
 * cancelamento, o custo de não ter isto aqui é SILENCIOSO e em dois passos:
 * `outcomeOf` devolveria `null` para a cancelada, o par de botões apareceria
 * dizendo "Sem registro", e marcar-e-desmarcar gravaria `scheduled` — a reunião
 * cancelada RESSUSCITA na aba "Pendentes". Uma linha aqui custa menos que esse
 * bug.
 */
const CANCELLED_STATUSES = new Set(["cancelled", "canceled"]);

export function isCancelledEvent(event: UnifiedEvent): boolean {
  return CANCELLED_STATUSES.has((event.status ?? "").toLowerCase());
}

export function podeRegistrarResultado(event: UnifiedEvent): boolean {
  return event.source === "meeting" && !isCancelledEvent(event);
}

/**
 * Lê o resultado de um evento. `null` = ainda não registrado.
 *
 * 🚨 O recorte por fonte não é zelo, é correção. `completed` significa coisas
 * DIFERENTES em fontes diferentes: em `meetings` é o comparecimento que esta
 * tela grava, mas em `follow_ups` a RPC fabrica `completed` a partir de
 * `completed_at` — ou seja, "o follow-up foi concluído", que não é
 * "compareceu". Sem esta guarda, todo follow-up concluído ganhava ✓ verde de
 * comparecimento na grade. Encontrado olhando a tela, não o código.
 */
export function outcomeOf(event: UnifiedEvent): AttendanceOutcome | null {
  if (!podeRegistrarResultado(event)) return null;
  const status = (event.status ?? "").toLowerCase();
  if (status === "completed") return "compareceu";
  if (status === "no_show") return "nao_compareceu";
  return null;
}


export interface ResumoComparecimento {
  compareceu: number;
  naoCompareceu: number;
  semRegistro: number;
}

/**
 * Conta o resultado sobre uma lista já recortada (período, escopo, filtros).
 *
 * Conta só o que PODE ter resultado: incluir follow-up e confirmação inflaria
 * "sem registro" com item que nunca vai poder ser registrado ali, e o número
 * viraria ruído. Cada evento cai em exatamente um balde — sem contagem dupla,
 * e trocar o resultado apenas move de balde, porque a contagem é derivada do
 * estado atual e não acumulada.
 */
export function resumirComparecimento(
  events: UnifiedEvent[],
): ResumoComparecimento {
  const resumo: ResumoComparecimento = {
    compareceu: 0,
    naoCompareceu: 0,
    semRegistro: 0,
  };
  for (const e of events) {
    if (!podeRegistrarResultado(e)) continue;
    const r = outcomeOf(e);
    if (r === "compareceu") resumo.compareceu += 1;
    else if (r === "nao_compareceu") resumo.naoCompareceu += 1;
    else resumo.semRegistro += 1;
  }
  return resumo;
}
