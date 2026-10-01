import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const diagnosisState: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };
const mutation = { mutate: vi.fn(), isPending: false };

vi.mock("../../hooks/useTicketDiagnosis", () => ({
  useTicketDiagnosis: () => diagnosisState,
  useSaveTicketDiagnosis: () => mutation,
  useRecordDiagnosisExecution: () => mutation,
}));

import { TicketDiagnosisPanel } from "./TicketDiagnosisPanel";

const TICKET = "5d1a1102-cccc-0000-0000-000000001102";

const diagnosis = {
  ticket_id: TICKET,
  kind: "fix",
  complexity: "alta",
  summary: "Mover etapa em funil personalizado não dispara o evento.",
  root_cause: "SET stage_id sem stage_key.",
  customer_reply: "Achamos a causa e já estamos corrigindo.",
  recommended_model: "opus",
  recommended_effort: "high",
  resolution_prompt: "# Chamado\nprompt de resolução completo",
  keystones: [{ label: "teste do hook passa", verify: "npx vitest run useMoveCard" }],
  estimated_cost_usd: 2.5,
  template_version: 1,
  source: "claude_code",
  diagnosed_by: null,
  executed_at: null,
  execution_outcome: null,
  actual_cost_usd: null,
  created_at: "2026-10-01T12:00:00Z",
  updated_at: "2026-10-01T12:00:00Z",
};

describe("TicketDiagnosisPanel", () => {
  beforeEach(() => {
    diagnosisState.data = null;
    mutation.mutate.mockReset();
  });

  it("sem diagnóstico, entrega o comando da etapa 2 com o id do Chamado", () => {
    render(<TicketDiagnosisPanel ticketId={TICKET} onUseReply={vi.fn()} />);
    expect(screen.getByText(`/chamado-diagnosticar ${TICKET}`)).toBeInTheDocument();
  });

  it("com diagnóstico, mostra o resumo, a rota e os keystones", () => {
    diagnosisState.data = diagnosis;
    render(<TicketDiagnosisPanel ticketId={TICKET} onUseReply={vi.fn()} />);
    expect(screen.getByText(diagnosis.summary)).toBeInTheDocument();
    expect(screen.getByText("Opus")).toBeInTheDocument();
    expect(screen.getByText("teste do hook passa")).toBeInTheDocument();
    expect(screen.queryByText(/da matriz/)).not.toBeInTheDocument(); // alta → opus/high
  });

  it("'Usar resposta sugerida' leva o texto ao campo de resposta", () => {
    diagnosisState.data = diagnosis;
    const onUseReply = vi.fn();
    render(<TicketDiagnosisPanel ticketId={TICKET} onUseReply={onUseReply} />);
    fireEvent.click(screen.getByRole("button", { name: /Usar resposta sugerida/ }));
    expect(onUseReply).toHaveBeenCalledWith(diagnosis.customer_reply);
  });

  it("sinaliza rota fora da matriz", () => {
    diagnosisState.data = { ...diagnosis, complexity: "trivial" };
    render(<TicketDiagnosisPanel ticketId={TICKET} onUseReply={vi.fn()} />);
    expect(screen.getByText("acima da matriz")).toBeInTheDocument();
  });

  it("o formulário manual recusa fix sem root cause antes de ir ao banco", () => {
    render(<TicketDiagnosisPanel ticketId={TICKET} onUseReply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /registre o diagnóstico à mão/ }));
    fireEvent.click(screen.getByRole("button", { name: /Salvar diagnóstico/ }));
    expect(screen.getByText("Fix sem root cause é palpite — descreva a causa.")).toBeInTheDocument();
    expect(mutation.mutate).not.toHaveBeenCalled();
  });
});
