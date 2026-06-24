/**
 * ScheduleMessageModal — feedback de validação separado por razão.
 *
 * Regressão do bug "não consigo agendar pra mais de 1 semana": o modal juntava
 * conteúdo + data-futura num único `isValid` e mostrava UM erro que culpava sempre
 * a data — mesmo quando o real motivo era textarea vazia. Não existe teto de prazo:
 * uma data 30 dias à frente é perfeitamente válida.
 *
 * Trava o comportamento correto + os achados da review adversarial:
 *  (a) data futura sem conteúdo   → dica de conteúdo, NUNCA erro de data
 *  (b) data no passado            → erro de data mantido
 *  (c) mensagem + data futura      → válido, sem erros/dicas (fluxo real do usuário)
 *  (d) edição a 30 dias no futuro  → válido (mata o mito do "teto de 1 semana")
 *  (e) sem data, sem conteúdo      → nenhum aviso prematuro
 *  (f) edição só-mídia (sem texto) → re-save liberado, sem dica de conteúdo
 *  (g) só-mídia no create          → válido pela mídia (branch `|| mediaFile`)
 *  (h) mensagem só de espaços      → tratada como vazia (branch `.trim()`)
 *  (i) data >7d via Calendar       → fluxo create real (onSelect), sem teto
 *  (j) mensagem sem data           → dica de data (célula antes silenciosa)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mocks ──────────────────────────────────────────────────────────────────
// Único acoplamento do modal: os hooks de mutation. Stubados — nenhum teste
// dispara submit; só exercemos a lógica de validação/feedback.
vi.mock("@/modules/communication/hooks/useScheduledMessages", () => ({
  useCreateScheduledMessage: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
  useUpdateScheduledMessage: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
}));

import { ScheduleMessageModal } from "@/modules/communication/components/chat/ScheduleMessageModal";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const DATE_ERROR = /A data precisa ser no futuro/i;
const CONTENT_HINT = "Escreva uma mensagem ou anexe um arquivo para agendar.";
const DATE_HINT = "Escolha uma data e hora para agendar.";

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  leadId: "lead-1",
  leadName: "João",
  phoneNumber: "5511999990000",
};

function renderModal(props: Partial<React.ComponentProps<typeof ScheduleMessageModal>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ScheduleMessageModal {...baseProps} {...props} />
    </QueryClientProvider>,
  );
}

const typeMessage = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText("Escreva a mensagem..."), { target: { value } });

const clickQuickDate = (label: string) =>
  fireEvent.click(screen.getByRole("button", { name: label }));

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("ScheduleMessageModal — validação por razão", () => {
  beforeEach(() => {
    baseProps.onOpenChange.mockClear();
  });

  it("(a) data futura sem conteúdo → dica de conteúdo + Agendar desabilitado, sem erro de data", () => {
    renderModal();
    clickQuickDate("1 semana");

    expect(screen.getByText(CONTENT_HINT)).toBeInTheDocument();
    expect(screen.queryByText(DATE_ERROR)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agendar" })).toBeDisabled();
  });

  it("(b) data no passado → mantém erro de data (mesmo com conteúdo)", () => {
    // Edição com data já passada — a única forma de chegar a uma data passada,
    // já que o Calendar e os botões rápidos só oferecem datas futuras.
    renderModal({
      editingId: "sched-1",
      editingContent: "Mensagem qualquer",
      editingScheduledAt: new Date(2020, 0, 1, 9, 0, 0),
    });

    expect(screen.getByText(DATE_ERROR)).toBeInTheDocument();
    expect(screen.queryByText(CONTENT_HINT)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  it("(c) mensagem + data futura → válido: Agendar habilitado, sem erro nem dica", () => {
    renderModal();
    typeMessage("Olá! Tudo bem?");
    clickQuickDate("1 semana");

    expect(screen.getByRole("button", { name: "Agendar" })).toBeEnabled();
    expect(screen.queryByText(DATE_ERROR)).not.toBeInTheDocument();
    expect(screen.queryByText(CONTENT_HINT)).not.toBeInTheDocument();
  });

  it("(d) edição a 30 dias no futuro → válido (não existe teto de 1 semana)", () => {
    const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    renderModal({
      editingId: "sched-1",
      editingContent: "Lembrete daqui a um mês",
      editingScheduledAt: in30Days,
    });

    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
    expect(screen.queryByText(DATE_ERROR)).not.toBeInTheDocument();
    expect(screen.queryByText(CONTENT_HINT)).not.toBeInTheDocument();
  });

  it("(e) sem data, sem conteúdo → nenhum aviso prematuro", () => {
    renderModal();

    expect(screen.queryByText(DATE_ERROR)).not.toBeInTheDocument();
    expect(screen.queryByText(CONTENT_HINT)).not.toBeInTheDocument();
    expect(screen.queryByText(DATE_HINT)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agendar" })).toBeDisabled();
  });

  it("(f) edição de agendamento só-mídia (texto vazio) → Salvar liberado, sem dica de conteúdo", () => {
    // Banner reabre um agendamento só-mídia como editingContent="" e NÃO devolve o
    // File; anexar fica desabilitado em edição. Gatear por conteúdo travaria o re-save
    // de um agendamento perfeitamente válido. Texto vazio em edição = "sem alteração".
    const in5Days = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    renderModal({
      editingId: "sched-1",
      editingContent: "",
      editingScheduledAt: in5Days,
    });

    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
    expect(screen.queryByText(CONTENT_HINT)).not.toBeInTheDocument();
    expect(screen.queryByText(DATE_ERROR)).not.toBeInTheDocument();
  });

  it("(g) só-mídia no create (sem texto) → válido pela mídia, sem dica de conteúdo", () => {
    const mediaFile = new File(["binário"], "foto.jpg", { type: "image/jpeg" });
    renderModal({ initialMediaFile: mediaFile });
    clickQuickDate("1 semana");

    expect(screen.getByRole("button", { name: "Agendar" })).toBeEnabled();
    expect(screen.queryByText(CONTENT_HINT)).not.toBeInTheDocument();
    expect(screen.queryByText(DATE_ERROR)).not.toBeInTheDocument();
  });

  it("(h) mensagem só de espaços → tratada como vazia (dica de conteúdo, Agendar desabilitado)", () => {
    renderModal();
    typeMessage("    ");
    clickQuickDate("1 semana");

    expect(screen.getByText(CONTENT_HINT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agendar" })).toBeDisabled();
    expect(screen.queryByText(DATE_ERROR)).not.toBeInTheDocument();
  });

  it("(i) create: data >7d escolhida no Calendar → válido, sem erro de data (fluxo real do usuário)", () => {
    renderModal();
    typeMessage("Mensagem pra daqui a semanas");

    // Abre o popover do calendário e avança 2 meses → qualquer dia clicado fica
    // >7d à frente (mata o mito do "teto de 1 semana" pelo caminho real onSelect).
    fireEvent.click(screen.getByRole("button", { name: "Escolher data" }));
    const nextMonth = screen.getByRole("button", { name: /next month/i });
    fireEvent.click(nextMonth);
    fireEvent.click(nextMonth);

    // Dia 15 do mês exibido é sempre in-month (único; nunca um "outside day").
    fireEvent.click(screen.getByText("15"));

    expect(screen.queryByText(DATE_ERROR)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agendar" })).toBeEnabled();
  });

  it("(j) mensagem sem data → dica de data (célula antes silenciosa), sem erro de data", () => {
    renderModal();
    typeMessage("Texto pronto, falta a data");

    expect(screen.getByText(DATE_HINT)).toBeInTheDocument();
    expect(screen.queryByText(DATE_ERROR)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agendar" })).toBeDisabled();
  });
});
