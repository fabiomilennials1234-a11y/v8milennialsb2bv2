/**
 * Editar/cancelar mensagem agendada só vale enquanto ela AINDA está agendada.
 *
 * `scheduled` não é um estado estável. O cron roda a cada minuto e a primeira
 * coisa que `process-scheduled-user-messages` faz é virar a linha para
 * `sending` — um compare-and-swap. As duas mutations daqui carregam o mesmo
 * `.eq("status","scheduled")` para não pisar no que o worker já pegou.
 *
 * O problema é o que o PostgREST responde quando esse filtro não casa NADA:
 * **200, sem erro**. Antes desta guarda, `{ error: null }` era lido como
 * sucesso, o toast dizia "Agendamento cancelado" e a mensagem saía assim mesmo
 * — a tela mentia sobre o que estava gravado. O worker documenta a mesma
 * armadilha no próprio lock (`if (!locked?.length) continue`); a UI é que não
 * tinha aprendido.
 *
 * Estes testes travam as duas metades: 1 linha afetada = sucesso, 0 linha
 * afetada = erro visível.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

/** O que o `.select("id")` final devolve — é a variável do teste. */
let linhasAfetadas: Array<{ id: string }> = [];
let erroDoBanco: { message: string } | null = null;

const chain: Record<string, ReturnType<typeof vi.fn>> = {};
["update", "eq"].forEach((m) => {
  chain[m] = vi.fn().mockReturnValue(chain);
});
chain.select = vi.fn(() =>
  Promise.resolve({ data: erroDoBanco ? null : linhasAfetadas, error: erroDoBanco }),
);

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => chain },
}));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
  useCurrentTeamMember: () => ({ data: { id: "member-1" } }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock("@/shared/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => vi.fn(),
}));

import {
  useCancelScheduledMessage,
  useUpdateScheduledMessage,
  AGENDAMENTO_FORA_DE_JANELA,
} from "@/modules/communication/hooks/useScheduledMessages";

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  linhasAfetadas = [];
  erroDoBanco = null;
});

describe("useCancelScheduledMessage — janela de cancelamento", () => {
  it("cancela quando a linha ainda estava agendada", async () => {
    linhasAfetadas = [{ id: "sched-1" }];
    const { result } = renderHook(() => useCancelScheduledMessage(), {
      wrapper: createWrapper(),
    });

    result.current.mutate("sched-1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(toastSuccess).toHaveBeenCalledWith("Agendamento cancelado");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("FALHA quando o worker já pegou a linha — 0 linha afetada não é sucesso", async () => {
    // Exatamente o retorno do PostgREST para um UPDATE cujo filtro não casou:
    // lista vazia, `error: null`. Era isto que passava por "cancelado".
    linhasAfetadas = [];
    const { result } = renderHook(() => useCancelScheduledMessage(), {
      wrapper: createWrapper(),
    });

    result.current.mutate("sched-1");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(AGENDAMENTO_FORA_DE_JANELA);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(AGENDAMENTO_FORA_DE_JANELA);
  });
});

describe("useUpdateScheduledMessage — janela de edição", () => {
  it("grava conteúdo e horário quando a linha ainda estava agendada", async () => {
    linhasAfetadas = [{ id: "sched-1" }];
    const quando = new Date("2026-09-10T12:30:00.000Z");
    const { result } = renderHook(() => useUpdateScheduledMessage(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({
      id: "sched-1",
      messageContent: "texto novo",
      scheduledAt: quando,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(chain.update).toHaveBeenCalledWith({
      message_content: "texto novo",
      scheduled_at: quando.toISOString(),
    });
    expect(toastSuccess).toHaveBeenCalledWith("Agendamento atualizado");
  });

  it("FALHA quando o worker já pegou a linha", async () => {
    linhasAfetadas = [];
    const { result } = renderHook(() => useUpdateScheduledMessage(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: "sched-1", scheduledAt: new Date("2026-09-10T12:30:00.000Z") });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(AGENDAMENTO_FORA_DE_JANELA);
    expect(toastError).toHaveBeenCalledWith(AGENDAMENTO_FORA_DE_JANELA);
  });

  it("sem nada para gravar não vai à rede — e não acusa janela fechada", async () => {
    // `update({})` voltaria zero linha e cairia na guarda, culpando o worker por
    // um "você não alterou nada".
    linhasAfetadas = [];
    const { result } = renderHook(() => useUpdateScheduledMessage(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: "sched-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(chain.update).not.toHaveBeenCalled();
  });

  it("propaga erro real do banco sem trocá-lo pela mensagem de janela", async () => {
    erroDoBanco = { message: "permission denied for table scheduled_user_messages" };
    const { result } = renderHook(() => useUpdateScheduledMessage(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: "sched-1", scheduledAt: new Date("2026-09-10T12:30:00.000Z") });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("permission denied");
  });
});
