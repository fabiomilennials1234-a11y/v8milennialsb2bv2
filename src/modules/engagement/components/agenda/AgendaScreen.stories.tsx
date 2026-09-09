/**
 * A tela "Atividades" montada como ela aparece dentro da área principal.
 *
 * Existe para revisar o visual sem banco: a página real (`pages/Agenda.tsx`)
 * puxa quatro fontes por RPC, e a Agenda é área frágil de fuso horário — não
 * dá para conferir contraste e densidade esperando dado de produção.
 *
 * As histórias reproduzem a mesma composição da página: cabeçalho, abas,
 * filtros, navegação de mês e grade. Se a página mudar de forma, esta história
 * precisa mudar junto — ela não importa a página, imita a montagem dela.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Plus, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AgendaFilterBar, ALL_OPTION } from "./AgendaFilterBar";
import { AgendaOutcomeToggle } from "./AgendaOutcomeToggle";
import { EventDetailPopover, type PopoverState } from "./EventDetailPopover";
import { MonthView } from "./MonthView";
import type {
  AgendaStatusFilter,
  AttendanceOutcome,
  EventTypeKey,
  UnifiedEvent,
} from "./agenda-helpers";
import {
  EVENT_TYPE_KEYS,
  SOURCE_COLORS,
  STATUS_SEM_RESULTADO,
  resumirComparecimento,
  statusDoResultado,
} from "./agenda-helpers";

// Agosto de 2026 — o mês da referência visual.
const MES = new Date(2026, 7, 24);

function ev(
  dia: number,
  hora: number,
  title: string,
  over: Partial<UnifiedEvent> = {},
): UnifiedEvent {
  const start = new Date(2026, 7, dia, hora, 0);
  return {
    id: `${title}-${dia}-${hora}`,
    title,
    start,
    end: new Date(2026, 7, dia, hora + 1, 0),
    allDay: false,
    source: "meeting",
    color: SOURCE_COLORS.meeting,
    description: null,
    location: null,
    meetLink: null,
    leadId: null,
    leadName: null,
    leadCompany: null,
    creatorName: "Ana Souza",
    createdBy: "tm-ana",
    status: "scheduled",
    eventType: "meeting",
    googleEventId: null,
    googleHtmlLink: null,
    googleCalendarOwnerId: null,
    googleCalendarOwnerName: null,
    googleCalendarColor: null,
    ...over,
  };
}

const EVENTOS: UnifiedEvent[] = [
  ev(3, 16, "Reunião"),
  ev(4, 17, "Teste", { creatorName: "Bruno Lima", createdBy: "tm-bruno" }),
  ev(11, 9, "Ligar para o lead", {
    source: "follow_up",
    eventType: "follow_up",
    color: SOURCE_COLORS.follow_up,
  }),
  ev(11, 14, "Enviar proposta", {
    source: "scheduled_message",
    eventType: "task",
    color: SOURCE_COLORS.scheduled_message,
  }),
  ev(11, 16, "Confirmar D-3", {
    source: "pipe_confirmacao",
    color: SOURCE_COLORS.pipe_confirmacao,
    status: "confirmar_d3",
  }),
  // Source 5 — o funil mergeado. A combinação exata que a RPC devolve:
  // `source: "meeting_event"` com `eventType: "meeting"`. Está aqui porque era
  // a única das cinco fontes SEM representação na story, e foi justamente ela
  // que imprimiu o identificador cru "meeting_event" na tela por um mês.
  // Também é o caso que prova, no olho, que o par de botões de comparecimento
  // NÃO aparece nela: `podeRegistrarResultado` olha `source`, não `eventType`.
  ev(11, 20, "Reunião vinda do funil", {
    source: "meeting_event",
    eventType: "meeting",
    color: SOURCE_COLORS.meeting_event,
    status: "scheduled",
  }),
  ev(11, 18, "Retorno do cliente", { creatorName: "Ana Souza" }),
  ev(20, 10, "Demonstração", { status: "completed" }),
  ev(21, 15, "Call de alinhamento", { status: "no_show" }),
  ev(27, 11, "Follow-up de proposta", {
    source: "follow_up",
    eventType: "follow_up",
    color: SOURCE_COLORS.follow_up,
    status: "completed",
  }),
];

/**
 * A página que fica ATRÁS do painel. Não é enfeite: o ponto da tela é que ela
 * continue legível, então a história precisa provar isso.
 */
function PaginaDeBaixo() {
  return (
    <div className="min-w-0 flex-1 px-6 py-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-1 text-muted-foreground">
        Visão geral do seu desempenho e atividades
      </p>
      <div className="mt-6 grid grid-cols-2 gap-4">
        {[
          { rotulo: "Total criados", valor: "R$ 0,00", nota: "21 negócios" },
          { rotulo: "Total ganhos", valor: "R$ 0,00", nota: "0 negócios" },
        ].map((c) => (
          <div key={c.rotulo} className="stat-card">
            <p className="stat-card-label">{c.rotulo}</p>
            <p className="stat-card-value">{c.valor}</p>
            <p className="mt-1 text-xs text-muted-foreground">{c.nota}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-semibold">Dados diários</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Visualização por valor dos negócios
        </p>
        <div className="mt-4 h-40 rounded bg-muted/40" />
      </div>
    </div>
  );
}

/** Recria a composição da tela dentro do painel sobreposto. */
function TelaAtividades({
  eventos: iniciais,
  admin,
}: {
  eventos: UnifiedEvent[];
  admin: boolean;
}) {
  const [status, setStatus] = useState<AgendaStatusFilter>("all");
  const [owner, setOwner] = useState<string>(ALL_OPTION);
  const [tipos, setTipos] = useState<Set<EventTypeKey>>(
    () => new Set(EVENT_TYPE_KEYS),
  );
  const toggleTipo = (t: EventTypeKey) =>
    setTipos((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  /**
   * O par de botões vive DENTRO do `EventDetailPopover`, e a história montava o
   * `MonthView` com `onEventClick={() => {}}` — um stub vazio. Resultado: o
   * popover nunca abria e o controle desta feature era **inalcançável pela
   * tela**, aparecendo só na história isolada `Resultado`. Quem abrisse
   * "Tela de Atividades" para conferir concluiria, com razão, que o botão não
   * existe.
   *
   * Com a efêmera de QA morta e a PR ainda fora da `main`, esta história é o
   * único lugar onde dá para VER a feature funcionando — então ela precisa
   * fechar o ciclo inteiro: clicar abre, gravar muda o estado, e a contagem do
   * topo se move junto, porque é derivada da mesma lista.
   */
  const [eventos, setEventos] = useState(iniciais);
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const gravarResultado = async (
    alvo: UnifiedEvent,
    resultado: AttendanceOutcome | null,
  ) => {
    const proximo = resultado
      ? statusDoResultado(resultado)
      : STATUS_SEM_RESULTADO;
    setEventos((prev) =>
      prev.map((e) => (e.id === alvo.id ? { ...e, status: proximo } : e)),
    );
    setPopover((p) =>
      p && p.event.id === alvo.id
        ? { ...p, event: { ...p.event, status: proximo } }
        : p,
    );
  };

  // Mesma derivação da página real (`AgendaAtividades`): a contagem sai da
  // lista, não de um número escrito à mão.
  const parcial = resumirComparecimento(eventos);
  const resumo = {
    ...parcial,
    total: parcial.compareceu + parcial.naoCompareceu + parcial.semRegistro,
  };

  return (
    // Espelha o painel sobreposto: lateral + página de baixo à mostra na
    // esquerda, e a Agenda ocupando a direita.
    <div className="relative flex h-screen bg-background">
      <div className="w-[68px] shrink-0 border-r border-sidebar-border bg-sidebar" />
      <PaginaDeBaixo />
      <div className="absolute inset-y-0 right-0 flex w-[65%] min-w-[680px] max-w-[1280px] flex-col border-l border-border bg-card shadow-2xl">
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5 lg:px-6 lg:py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold">Atividades</h1>
              <p className="mt-1 text-muted-foreground">
                {admin
                  ? "Crie, edite e gerencie as atividades da equipe."
                  : "Crie, edite e gerencie suas atividades."}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" size="icon" aria-label="Atualizar agenda">
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Nova atividade
              </Button>
            </div>
          </div>

          <AgendaFilterBar
            status={status}
            onStatusChange={setStatus}
            owner={owner}
            onOwnerChange={setOwner}
            ownerOptions={
              admin
                ? [
                    { value: "tm-ana", label: "Ana Souza" },
                    { value: "tm-bruno", label: "Bruno Lima" },
                  ]
                : []
            }
            activeTypes={tipos}
            onToggleType={toggleTipo}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1">
              <h2 className="truncate text-sm font-semibold uppercase tracking-wide text-foreground">
                agosto de 2026
              </h2>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Período anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Próximo período"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs">
                Hoje
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs tabular-nums text-muted-foreground">
                {eventos.length} atividades
              </span>
              {/* DERIVADO, nunca cravado. A versão anterior escrevia 1 / 1 /
                  `eventos.length - 2` na mão: no mês cheio dava 7 onde a
                  contagem real dá 3 (só a fonte `meeting` conta), e na história
                  "Vazio" imprimia literalmente "-2 sem registro". Uma prova
                  visual que mente sobre o número é pior que prova nenhuma —
                  chamar a mesma função da tela é o que faz a história valer. */}
              {resumo.total > 0 && (
                <div
                  className="flex items-center gap-2.5 text-xs tabular-nums"
                  aria-label="Comparecimento no período"
                >
                  <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                    <Check className="h-3 w-3 shrink-0" strokeWidth={3} aria-hidden="true" />
                    {resumo.compareceu}
                    <span className="sr-only">compareceram</span>
                  </span>
                  <span className="flex items-center gap-1 text-red-700 dark:text-red-300">
                    <X className="h-3 w-3 shrink-0" strokeWidth={3} aria-hidden="true" />
                    {resumo.naoCompareceu}
                    <span className="sr-only">não compareceram</span>
                  </span>
                  {resumo.semRegistro > 0 && (
                    <span className="text-muted-foreground">
                      {resumo.semRegistro} sem registro
                    </span>
                  )}
                </div>
              )}
              <div className="flex gap-1 rounded-full border border-border bg-sunken p-1">
                <button
                  type="button"
                  className="rounded-full border border-border bg-card px-3 py-1 text-[12px] font-semibold text-foreground shadow-sm"
                >
                  Mês
                </button>
                <button
                  type="button"
                  className="rounded-full px-3 py-1 text-[12px] font-medium text-foreground/80"
                >
                  Dia
                </button>
              </div>
            </div>
          </div>

          <div className="flex min-h-[520px] flex-1 flex-col">
            <MonthView
              date={MES}
              events={eventos}
              onEventClick={(e, evento) =>
                setPopover({ event: evento, x: e.clientX, y: e.clientY })
              }
              onSlotClick={() => {}}
              showOwner={admin}
            />
          </div>
        </div>
      </div>

      {/* Clicar numa pílula abre isto — é aqui que o par Compareceu / Não
          compareceu aparece. `onSetOutcome` presente é o que o liga: ausente,
          `podeRegistrar` é falso e o controle some (o caso do follow-up). */}
      {popover && (
        <EventDetailPopover
          state={popover}
          onClose={() => setPopover(null)}
          onDeleteMeeting={async () => {}}
          onDeleteGoogleEvent={async () => {}}
          onSetOutcome={gravarResultado}
        />
      )}
    </div>
  );
}

const meta: Meta<typeof TelaAtividades> = {
  title: "Agenda/Tela de Atividades",
  component: TelaAtividades,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Usuário comum: só os próprios compromissos, sem filtro de atendente. */
export const UsuarioComum: Story = {
  args: { eventos: EVENTOS.slice(0, 4), admin: false },
};

/** Admin: agenda da equipe, com iniciais do responsável e filtro de atendente. */
export const Admin: Story = {
  args: { eventos: EVENTOS, admin: true },
};

/** Mês sem nenhum compromisso. */
export const Vazio: Story = {
  args: { eventos: [], admin: false },
};

/** O par de botões nos três estados — sem registro, compareceu, não compareceu. */
export const Resultado: Story = {
  render: () => (
    <div className="min-h-screen bg-background p-8">
      {/* `w-72` é a largura real do `EventDetailPopover`, onde o par vive. */}
      <div className="flex flex-wrap gap-6">
        {([null, "compareceu", "nao_compareceu"] as const).map((v) => (
          <div key={String(v)} className="w-72 rounded-xl border border-border bg-card p-3">
            <p className="mb-2 text-[11px] text-muted-foreground">
              {v === null ? "sem registro" : v}
            </p>
            <AgendaOutcomeToggle value={v} onChange={() => {}} />
          </div>
        ))}
      </div>
    </div>
  ),
};
