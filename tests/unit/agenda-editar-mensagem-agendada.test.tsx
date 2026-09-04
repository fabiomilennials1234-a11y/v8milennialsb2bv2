/**
 * A Agenda deixa editar a MENSAGEM AGENDADA — texto e hora do envio.
 *
 * Antes, o lápis do popover só aparecia para `source === "meeting"`: as outras
 * quatro fontes são projeções de tabelas diferentes e o formulário de reunião
 * não grava nada nelas. A mensagem agendada, porém, TEM um formulário próprio
 * (o mesmo do chat, em modo edição) — faltava a porta.
 *
 * O recorte que este arquivo trava é o `status`. A Agenda mostra
 * `scheduled` **e** `sending`, e `sending` significa que o worker já travou a
 * linha: editar dali seria um UPDATE que casa zero linha e volta 200 (ver
 * `agendamento-janela-de-edicao.test.ts`). O lápis não pode aparecer.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EventDetailPopover } from "@/modules/engagement/components/agenda/EventDetailPopover";
import type { UnifiedEvent } from "@/modules/engagement/components/agenda/agenda-helpers";

const BASE: UnifiedEvent = {
  id: "scheduled_message-2f1c9a54-0000-4000-8000-000000000001",
  title: "Bom dia! Passando para saber...",
  start: new Date(2026, 8, 10, 9, 0),
  end: new Date(2026, 8, 10, 9, 5),
  allDay: false,
  source: "scheduled_message",
  color: "#8B5CF6",
  description: "Bom dia! Passando para saber se você conseguiu ver a proposta.",
  location: null,
  meetLink: null,
  leadId: "lead-1",
  leadName: "Joana Prado",
  leadCompany: "Prado Embalagens",
  creatorName: "Ana Souza",
  createdBy: "member-ana",
  status: "scheduled",
  eventType: "task",
  googleEventId: null,
  googleHtmlLink: null,
  googleCalendarOwnerId: null,
  googleCalendarOwnerName: null,
  googleCalendarColor: null,
};

function montar(event: UnifiedEvent, onEditScheduledMessage?: (e: UnifiedEvent) => void) {
  return render(
    <EventDetailPopover
      state={{ event, x: 100, y: 100 }}
      onClose={() => {}}
      onDeleteMeeting={async () => {}}
      onDeleteGoogleEvent={async () => {}}
      onEditScheduledMessage={onEditScheduledMessage}
    />,
  );
}

const LAPIS = "Editar mensagem agendada";

describe("EventDetailPopover — editar mensagem agendada", () => {
  it("oferece o lápis para mensagem ainda agendada", () => {
    montar(BASE, vi.fn());
    expect(screen.getByLabelText(LAPIS)).toBeInTheDocument();
  });

  it("entrega o EVENTO ao callback — é dele que saem texto e horário atuais", async () => {
    const aoEditar = vi.fn();
    const user = userEvent.setup();
    montar(BASE, aoEditar);

    await user.click(screen.getByLabelText(LAPIS));

    expect(aoEditar).toHaveBeenCalledTimes(1);
    const recebido = aoEditar.mock.calls[0][0] as UnifiedEvent;
    expect(recebido.id).toBe(BASE.id);
    expect(recebido.description).toBe(BASE.description);
    expect(recebido.start).toEqual(BASE.start);
  });

  it("NÃO oferece o lápis quando o envio já começou (status 'sending')", () => {
    // O worker já fez o compare-and-swap. Editar aqui não gravaria nada — e o
    // PostgREST responderia 200, então a tela mentiria.
    montar({ ...BASE, status: "sending" }, vi.fn());
    expect(screen.queryByLabelText(LAPIS)).not.toBeInTheDocument();
  });

  it("NÃO oferece o lápis sem callback — a tela não promete o que não faz", () => {
    montar(BASE, undefined);
    expect(screen.queryByLabelText(LAPIS)).not.toBeInTheDocument();
  });

  it("não confunde as fontes: follow-up não ganha o lápis de mensagem", () => {
    montar({ ...BASE, source: "follow_up" }, vi.fn());
    expect(screen.queryByLabelText(LAPIS)).not.toBeInTheDocument();
  });

  it("reunião continua com o SEU lápis, não com o de mensagem", () => {
    render(
      <EventDetailPopover
        state={{ event: { ...BASE, source: "meeting" }, x: 100, y: 100 }}
        onClose={() => {}}
        onDeleteMeeting={async () => {}}
        onDeleteGoogleEvent={async () => {}}
        onEditMeeting={vi.fn()}
        onEditScheduledMessage={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Editar evento")).toBeInTheDocument();
    expect(screen.queryByLabelText(LAPIS)).not.toBeInTheDocument();
  });
});
