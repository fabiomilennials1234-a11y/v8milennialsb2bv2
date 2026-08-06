/**
 * `AddMeetingModal` — agendar reunião pelo funil WhatsApp MOVE o negócio.
 *
 * Este é o caminho de **81 organizações** (funil WhatsApp → Confirmação) e era o
 * recorte mais torto dos três: quem criava o card de destino era este modal,
 * ANTES de a origem ser tocada. O resultado é o mesmo gêmeo dos outros: a linha
 * de origem ficava no WhatsApp e uma linha nova nascia na Confirmação — o mesmo
 * negócio em dois funis (801 leads em prod, medido 2026-08-03).
 *
 * O religamento (commit feeb60b4) trocou o `createPipeConfirmacao` por dois
 * props opcionais, e é exatamente essa fiação que esta suíte protege:
 *
 *   `beforeSubmit`     → a PÁGINA leva o card de origem à etapa de sucesso. É
 *                        essa TRANSIÇÃO que emite `meeting_booked`; a
 *                        permanência não emite nada. Se rodar depois do move, ou
 *                        não rodar, as orgs param de contar reunião marcada sem
 *                        nenhum erro em tela.
 *   `moveFromEntryId`  → o modal move ESSA linha em vez de criar outra.
 *
 * E o UPDATE que vem DEPOIS do move não é redundância: `findOrCreatePipelineEntry`,
 * quando ACHA uma linha, devolve-a sem atualizar metadata nem etapa — mover e
 * confiar no create deixaria a reunião **sem data**.
 *
 * Sem os props, nada pode mudar: o outro chamador é a própria tela de
 * Confirmação, onde "Nova Reunião" é criação avulsa e não transição. Um teste
 * cobre esse lado também, porque "consertar" o modal para sempre mover quebraria
 * a criação avulsa em silêncio.
 *
 * O helper `moverNegocio` em si tem suíte própria (`tests/unit/mover-negocio.test.ts`);
 * aqui o que está sob prova é a TELA chamando o helper, com os parâmetros certos
 * e na ordem certa.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { toast } from "sonner";

// ── jsdom não tem o que o Radix Popper usa para posicionar o calendário ──────
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false;
}
if (!Element.prototype.releasePointerCapture) {
  (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};
}

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const updateLeadAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("@/modules/leads", () => ({
  useLeads: () => ({
    data: [
      {
        id: "lead-1",
        name: "Ana",
        company: "Acme",
        email: "ana@acme.com",
        phone: null,
        pre_sale_responsible_id: null,
      },
    ],
    isLoading: false,
  }),
  useUpdateLead: () => ({ mutateAsync: updateLeadAsync, isPending: false }),
}));

vi.mock("@/modules/identity", () => ({
  useResponsibleMembers: () => [{ id: "tm-3", name: "Bruno" }],
  useAuth: () => ({ session: null }),
}));

const createConfirmacaoAsync = vi.fn().mockResolvedValue({
  id: "conf-novo",
  lead_id: "lead-1",
  organization_id: "org-1",
});
const updateConfirmacaoAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("@/modules/pipelines/hooks/legacy/usePipeConfirmacao", () => ({
  useCreatePipeConfirmacao: () => ({ mutateAsync: createConfirmacaoAsync, isPending: false }),
  useUpdatePipeConfirmacao: () => ({ mutateAsync: updateConfirmacaoAsync, isPending: false }),
}));

let confirmacaoPipelineId: string | null = "pipe-confirmacao";
vi.mock("@/modules/pipelines/hooks/model/usePipelineEntries", () => ({
  usePipelineId: () => ({ data: confirmacaoPipelineId, isLoading: false }),
}));

const moverNegocio = vi.fn().mockResolvedValue(undefined);
vi.mock("@/modules/pipelines/lib/moverNegocio", () => ({
  moverNegocio: (...args: unknown[]) => moverNegocio(...args),
}));

vi.mock("@/shared/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => vi.fn(),
}));

vi.mock("@/modules/integrations/hooks/useGoogleCalendar", () => ({
  useGoogleCalendarStatus: () => ({ data: { connected: false } }),
}));
vi.mock("@/modules/integrations/hooks/useGoogleCalendarSharing", () => ({
  useCalendarSharing: () => ({ data: { incoming: [] } }),
}));

vi.mock("@/modules/platform", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { AddMeetingModal } from "@/modules/pipelines/components/legacy/confirmacao/AddMeetingModal";

/** Escolhe um dia qualquer no calendário — o modal exige data para submeter. */
async function escolherData() {
  fireEvent.click(screen.getByRole("button", { name: /selecionar/i }));
  await waitFor(() => {
    expect(document.querySelectorAll('button[name="day"]').length).toBeGreaterThan(0);
  });
  const dias = Array.from(
    document.querySelectorAll<HTMLButtonElement>('button[name="day"]'),
  ).filter((b) => !b.disabled && !b.className.includes("day-outside"));
  fireEvent.click(dias[Math.min(10, dias.length - 1)]);
}

async function submeter() {
  fireEvent.click(screen.getByRole("button", { name: /adicionar reunião/i }));
}

function montar(props: Record<string, unknown> = {}) {
  return render(
    <AddMeetingModal
      open
      onOpenChange={() => {}}
      prefilledLeadId="lead-1"
      prefilledResponsibleId="tm-3"
      {...(props as never)}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  confirmacaoPipelineId = "pipe-confirmacao";
  createConfirmacaoAsync.mockResolvedValue({
    id: "conf-novo",
    lead_id: "lead-1",
    organization_id: "org-1",
  });
  updateConfirmacaoAsync.mockResolvedValue(undefined);
  moverNegocio.mockResolvedValue(undefined);
  updateLeadAsync.mockResolvedValue(undefined);
});

describe("AddMeetingModal com moveFromEntryId — o negócio troca de funil, não se duplica", () => {
  it("move a MESMA linha para a Confirmação em vez de inserir card novo", async () => {
    montar({ moveFromEntryId: "wa-42", beforeSubmit: vi.fn().mockResolvedValue(undefined) });
    await escolherData();
    await submeter();

    await waitFor(() => expect(moverNegocio).toHaveBeenCalledTimes(1));
    expect(moverNegocio).toHaveBeenCalledWith({
      entryId: "wa-42",
      targetPipelineId: "pipe-confirmacao",
      targetStageKey: "reuniao_marcada",
      stageOrigem: null,
      assignedTo: "tm-3",
    });
    // O INSERT era a origem do gêmeo. Nenhuma linha nova pode nascer aqui.
    expect(createConfirmacaoAsync).not.toHaveBeenCalled();
  });

  it("roda o beforeSubmit ANTES do move — é ele que produz meeting_booked", async () => {
    const beforeSubmit = vi.fn().mockResolvedValue(undefined);
    montar({ moveFromEntryId: "wa-42", beforeSubmit });
    await escolherData();
    await submeter();

    await waitFor(() => expect(moverNegocio).toHaveBeenCalled());
    expect(beforeSubmit).toHaveBeenCalledTimes(1);
    expect(beforeSubmit.mock.invocationCallOrder[0]).toBeLessThan(
      moverNegocio.mock.invocationCallOrder[0],
    );
  });

  it("beforeSubmit que falha impede QUALQUER escrita no destino", async () => {
    const beforeSubmit = vi.fn().mockRejectedValue(new Error("sem permissão de mover"));
    montar({ moveFromEntryId: "wa-42", beforeSubmit });
    await escolherData();
    await submeter();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(moverNegocio).not.toHaveBeenCalled();
    expect(createConfirmacaoAsync).not.toHaveBeenCalled();
    expect(updateConfirmacaoAsync).not.toHaveBeenCalled();
  });

  it("grava a data da reunião DEPOIS do move, na linha que acabou de chegar", async () => {
    montar({ moveFromEntryId: "wa-42", beforeSubmit: vi.fn().mockResolvedValue(undefined) });
    await escolherData();
    await submeter();

    await waitFor(() => expect(updateConfirmacaoAsync).toHaveBeenCalled());
    const payload = updateConfirmacaoAsync.mock.calls[0][0] as {
      id: string;
      meeting_date: string;
      pre_sale_responsible_id: string | null;
      leadId: string;
    };
    // Mesma linha que foi movida — nada de id novo.
    expect(payload.id).toBe("wa-42");
    // Sem este UPDATE a reunião pousaria sem data: `findOrCreatePipelineEntry`
    // devolve a linha encontrada sem tocar em metadata nem etapa.
    expect(payload.meeting_date).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(payload.pre_sale_responsible_id).toBe("tm-3");
    expect(payload.leadId).toBe("lead-1");
    expect(updateConfirmacaoAsync.mock.invocationCallOrder[0]).toBeGreaterThan(
      moverNegocio.mock.invocationCallOrder[0],
    );
  });

  it("org sem funil de Confirmação: não move, não cria, e o erro aparece", async () => {
    confirmacaoPipelineId = null;
    montar({ moveFromEntryId: "wa-42", beforeSubmit: vi.fn().mockResolvedValue(undefined) });
    await escolherData();
    await submeter();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(moverNegocio).not.toHaveBeenCalled();
    expect(createConfirmacaoAsync).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("AddMeetingModal sem moveFromEntryId — 'Nova Reunião' avulsa continua CRIANDO", () => {
  it("cria o card de Confirmação e não move nada", async () => {
    montar();
    await escolherData();
    await submeter();

    await waitFor(() => expect(createConfirmacaoAsync).toHaveBeenCalledTimes(1));
    expect(moverNegocio).not.toHaveBeenCalled();
    expect(createConfirmacaoAsync.mock.calls[0][0]).toMatchObject({
      lead_id: "lead-1",
      status: "reuniao_marcada",
      pre_sale_responsible_id: "tm-3",
    });
  });

  it("sem o prop, o beforeSubmit inexistente não bloqueia a criação", async () => {
    montar();
    await escolherData();
    await submeter();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });
});
