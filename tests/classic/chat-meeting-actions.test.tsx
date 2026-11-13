import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LeadAgendaStrip } from "@/modules/communication/components/chat/LeadAgendaStrip";

const state = vi.hoisted(() => ({ meetings: [] as Record<string, unknown>[], pending: false, mutate: vi.fn(), query: vi.fn() }));
vi.mock("@/modules/engagement", () => ({
  useMeetings: (filters: unknown) => { state.query(filters); return { data: state.meetings }; },
  useUpdateMeeting: () => ({ mutate: state.mutate, isPending: state.pending }),
  EditMeetingDialog: ({ meetingId, onOpenChange }: { meetingId: string; onOpenChange: (open: boolean) => void }) =>
    <div role="dialog" aria-label="Editar evento">{meetingId}<button onClick={() => onOpenChange(false)}>Fechar editor</button></div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.pending = false;
  state.meetings = [{ id: "meeting-1", title: "Visita Nayara", start_at: "2030-11-13T14:00:00Z", end_at: "2030-11-13T15:00:00Z", event_type: "meeting", status: "scheduled" }];
});
function expand() { fireEvent.click(screen.getByRole("button", { expanded: false })); }
function cancel() { fireEvent.click(screen.getByRole("button", { name: "Cancelar reunião Visita Nayara" })); }

describe("ações de reuniões no chat", () => {
  it("consulta apenas o lead e abre o editor da reunião selecionada sem gravar", () => {
    render(<LeadAgendaStrip leadId="lead-1" />);
    expect(state.query).toHaveBeenCalledWith({ leadId: "lead-1" });
    expand();
    fireEvent.click(screen.getByRole("button", { name: "Editar reunião Visita Nayara" }));
    expect(screen.getByRole("dialog", { name: "Editar evento" })).toHaveTextContent("meeting-1");
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it("manter reunião fecha a confirmação sem alterar o agendamento", () => {
    render(<LeadAgendaStrip leadId="lead-1" />); expand(); cancel();
    fireEvent.click(screen.getByRole("button", { name: "Manter reunião" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it("só cancela após confirmar, alterando apenas status e preservando o registro", () => {
    state.mutate.mockImplementation((_input, options) => options.onSuccess());
    render(<LeadAgendaStrip leadId="lead-1" />); expand(); cancel();
    expect(state.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(state.mutate).toHaveBeenCalledWith({ id: "meeting-1", status: "cancelled" }, expect.any(Object));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
  it("mantém confirmação se a gravação falhar e impede cliques durante a gravação", () => {
    state.mutate.mockImplementation(() => {});
    const view = render(<LeadAgendaStrip leadId="lead-1" />); expand(); cancel();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    state.pending = true; view.rerender(<LeadAgendaStrip leadId="lead-1" />);
    expect(screen.getByRole("button", { name: "Cancelando…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Manter reunião" })).toBeDisabled();
  });
  it("trocar de conversa descarta confirmação e editor do lead anterior", () => {
    const view = render(<LeadAgendaStrip leadId="lead-1" />); expand(); cancel();
    view.rerender(<LeadAgendaStrip leadId="lead-2" />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expand(); fireEvent.click(screen.getByRole("button", { name: "Editar reunião Visita Nayara" }));
    view.rerender(<LeadAgendaStrip leadId="lead-3" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it("reunião cancelada deixa de aparecer após a atualização da consulta", () => {
    const view = render(<LeadAgendaStrip leadId="lead-1" />); expand();
    state.meetings = [{ ...state.meetings[0], status: "cancelled" }];
    view.rerender(<LeadAgendaStrip leadId="lead-1" />);
    expect(screen.queryByText("Visita Nayara")).not.toBeInTheDocument();
  });
});
