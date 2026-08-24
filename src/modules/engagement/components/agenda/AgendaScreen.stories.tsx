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
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AgendaFilterBar, ALL_OPTION } from "./AgendaFilterBar";
import { MonthView } from "./MonthView";
import type {
  AgendaStatusFilter,
  EventTypeKey,
  UnifiedEvent,
} from "./agenda-helpers";
import { EVENT_TYPE_KEYS, SOURCE_COLORS } from "./agenda-helpers";

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
  ev(11, 18, "Retorno do cliente", { creatorName: "Ana Souza" }),
  ev(20, 10, "Demonstração", { status: "completed" }),
  ev(27, 11, "Follow-up de proposta", {
    source: "follow_up",
    eventType: "follow_up",
    color: SOURCE_COLORS.follow_up,
    status: "completed",
  }),
];

/** Recria a composição da página dentro do contêiner do `<main>`. */
function TelaAtividades({
  eventos,
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

  return (
    // Espelha `MainLayout.tsx` — padding e teto de largura da área principal.
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex h-screen w-full max-w-[1600px] flex-col px-4 py-5 sm:px-6 sm:py-6 lg:px-10 lg:py-8 xl:px-12">
        <div className="flex min-h-0 flex-1 flex-col gap-5">
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
              onEventClick={() => {}}
              onSlotClick={() => {}}
              showOwner={admin}
            />
          </div>
        </div>
      </div>
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
