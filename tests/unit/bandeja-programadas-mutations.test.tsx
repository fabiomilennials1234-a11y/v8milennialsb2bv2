/**
 * Bandeja B1 — escritas novas sobre `scheduled_user_messages`.
 *
 * Enviar agora / Tentar de novo / Descartar / Editar falha disparam envio real
 * pelo cron, então cada uma é um compare-and-swap no status. O PostgREST
 * devolve 200 quando o CAS não casa nada: a guarda de 0 linha é o que impede o
 * toast de mentir. Dublê de banco com filtro de verdade (`createMockSupabase`).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMockSupabase } from "../helpers/supabase-mock";

const m = vi.hoisted(() => ({
  db: null as ReturnType<typeof createMockSupabase> | null,
  success: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ get supabase() { return m.db!.sb; } }));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org" }),
  useCurrentTeamMember: () => ({ data: { id: "member" } }),
}));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: m.success, error: vi.fn() } }));
vi.mock("@/shared/errors", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  notifyError: m.notify,
}));

import {
  AGENDAMENTO_FORA_DE_JANELA,
  FALHA_FORA_DE_JANELA,
  useDiscardFailedScheduledMessage,
  useRetryFailedScheduledMessage,
  useScheduledMessagesForConversation,
  useSendScheduledMessageNow,
  useUpdateScheduledMessage,
} from "@/modules/communication/hooks/useScheduledMessages";

const DIA = 86_400_000;

function linha(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    organization_id: "org",
    whatsapp_instance_id: "inst",
    phone_number: "5551999999999",
    status: "scheduled",
    scheduled_at: new Date(Date.now() + 3_600_000).toISOString(),
    retry_count: 0,
    error_message: null,
    ...over,
  };
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const W = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { W, invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.db = createMockSupabase();
});

describe("leitura da bandeja", () => {
  it("traz scheduled, sending e failed recente; corta failed velho, sent e cancelled", async () => {
    m.db!.mockTable("scheduled_user_messages", [
      linha({ id: "agendada" }),
      linha({ id: "saindo", status: "sending" }),
      linha({ id: "falha-recente", status: "failed", scheduled_at: new Date(Date.now() - 2 * DIA).toISOString() }),
      linha({ id: "falha-velha", status: "failed", scheduled_at: new Date(Date.now() - 8 * DIA).toISOString() }),
      linha({ id: "enviada", status: "sent" }),
      linha({ id: "cancelada", status: "cancelled" }),
    ]);
    const { W } = wrapper();
    const { result } = renderHook(() => useScheduledMessagesForConversation("5551999999999", "inst"), { wrapper: W });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((r) => r.id).sort()).toEqual(["agendada", "falha-recente", "saindo"]);
  });
});

describe("Enviar agora", () => {
  it("antecipa scheduled_at só se ainda está scheduled e avisa com honestidade", async () => {
    m.db!.mockTable("scheduled_user_messages", [linha()]);
    const { W, invalidate } = wrapper();
    const { result } = renderHook(() => useSendScheduledMessageNow(), { wrapper: W });
    const antes = Date.now();
    await act(async () => { await result.current.mutateAsync("r1"); });
    const [row] = m.db!.getUpdated("scheduled_user_messages");
    expect(row.status).toBe("scheduled");
    expect(new Date(row.scheduled_at as string).getTime()).toBeGreaterThanOrEqual(antes - 1000);
    expect(new Date(row.scheduled_at as string).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(m.success).toHaveBeenCalledWith("Enviando no próximo minuto");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["scheduled-messages"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agenda-events"] });
  });

  it("worker já pegou (sending): zero linha → erro, sem toast de sucesso", async () => {
    m.db!.mockTable("scheduled_user_messages", [linha({ status: "sending" })]);
    const { W } = wrapper();
    const { result } = renderHook(() => useSendScheduledMessageNow(), { wrapper: W });
    await act(async () => {
      await expect(result.current.mutateAsync("r1")).rejects.toThrow(AGENDAMENTO_FORA_DE_JANELA);
    });
    expect(m.success).not.toHaveBeenCalled();
    expect(m.notify).toHaveBeenCalled();
  });
});

describe("Tentar de novo", () => {
  it("devolve a falha à fila agora, com retries zerados e erro limpo", async () => {
    m.db!.mockTable("scheduled_user_messages", [linha({ status: "failed", retry_count: 3, error_message: "disconnected" })]);
    const { W } = wrapper();
    const { result } = renderHook(() => useRetryFailedScheduledMessage(), { wrapper: W });
    await act(async () => { await result.current.mutateAsync("r1"); });
    expect(m.db!.getUpdated("scheduled_user_messages")[0]).toEqual(
      expect.objectContaining({ status: "scheduled", retry_count: 0, error_message: null }),
    );
    expect(m.success).toHaveBeenCalledWith("Reenviando no próximo minuto");
  });

  it("alguém já reenviou: CAS em failed não casa → erro", async () => {
    m.db!.mockTable("scheduled_user_messages", [linha({ status: "scheduled" })]);
    const { W } = wrapper();
    const { result } = renderHook(() => useRetryFailedScheduledMessage(), { wrapper: W });
    await act(async () => {
      await expect(result.current.mutateAsync("r1")).rejects.toThrow(FALHA_FORA_DE_JANELA);
    });
    expect(m.success).not.toHaveBeenCalled();
  });
});

describe("Descartar", () => {
  it("cancela a falha", async () => {
    m.db!.mockTable("scheduled_user_messages", [linha({ status: "failed" })]);
    const { W } = wrapper();
    const { result } = renderHook(() => useDiscardFailedScheduledMessage(), { wrapper: W });
    await act(async () => { await result.current.mutateAsync("r1"); });
    expect(m.db!.getUpdated("scheduled_user_messages")[0]).toEqual(expect.objectContaining({ status: "cancelled" }));
  });

  it("não cancela o que não é mais falha", async () => {
    m.db!.mockTable("scheduled_user_messages", [linha({ status: "sending" })]);
    const { W } = wrapper();
    const { result } = renderHook(() => useDiscardFailedScheduledMessage(), { wrapper: W });
    await act(async () => {
      await expect(result.current.mutateAsync("r1")).rejects.toThrow(FALHA_FORA_DE_JANELA);
    });
    expect(m.db!.getUpdated("scheduled_user_messages")).toEqual([]);
  });
});

describe("Editar falha (modal existente)", () => {
  it("reprograma a falha com texto e horário novos e zera os retries", async () => {
    m.db!.mockTable("scheduled_user_messages", [linha({ status: "failed", retry_count: 3, error_message: "x" })]);
    const { W } = wrapper();
    const { result } = renderHook(() => useUpdateScheduledMessage(), { wrapper: W });
    const quando = new Date(Date.now() + DIA);
    await act(async () => { await result.current.mutateAsync({ id: "r1", messageContent: "novo", scheduledAt: quando, reviverFalha: true }); });
    expect(m.db!.getUpdated("scheduled_user_messages")[0]).toEqual(
      expect.objectContaining({ status: "scheduled", retry_count: 0, error_message: null, message_content: "novo", scheduled_at: quando.toISOString() }),
    );
  });

  it("sem reviverFalha (Agenda) a falha continua fora de janela e nada é gravado", async () => {
    m.db!.mockTable("scheduled_user_messages", [linha({ status: "failed", retry_count: 3 })]);
    const { W } = wrapper();
    const { result } = renderHook(() => useUpdateScheduledMessage(), { wrapper: W });
    await act(async () => {
      await expect(result.current.mutateAsync({ id: "r1", messageContent: "novo" })).rejects.toThrow(AGENDAMENTO_FORA_DE_JANELA);
    });
    expect(m.db!.getUpdated("scheduled_user_messages")).toEqual([]);
  });

  it("linha scheduled no meio dos retries do worker mantém o retry_count", async () => {
    m.db!.mockTable("scheduled_user_messages", [linha({ status: "scheduled", retry_count: 2 })]);
    const { W } = wrapper();
    const { result } = renderHook(() => useUpdateScheduledMessage(), { wrapper: W });
    await act(async () => { await result.current.mutateAsync({ id: "r1", messageContent: "novo" }); });
    expect(m.db!.getUpdated("scheduled_user_messages")[0]).toEqual(expect.objectContaining({ retry_count: 2, message_content: "novo" }));
  });

  it("sending/cancelled continua fora de janela", async () => {
    m.db!.mockTable("scheduled_user_messages", [linha({ status: "sending" })]);
    const { W } = wrapper();
    const { result } = renderHook(() => useUpdateScheduledMessage(), { wrapper: W });
    await act(async () => {
      await expect(result.current.mutateAsync({ id: "r1", messageContent: "novo", reviverFalha: true })).rejects.toThrow(AGENDAMENTO_FORA_DE_JANELA);
    });
  });
});
