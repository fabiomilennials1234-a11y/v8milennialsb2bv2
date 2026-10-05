/**
 * Integração: reconexão do canal → reconciliação da thread, pelo teto.
 *
 * Monta o par real do /chat — `useWhatsAppMessagesRealtime` (assina o
 * `joinCount` do store) + `useWhatsAppMessages` (a thread) — e conta chamadas
 * de `whatsapp_thread_manifest`, a RPC que cada refetch da thread paga.
 *
 *   - 1º join: nada (o cache acabou de nascer);
 *   - rejoin: 1 manifest a mais;
 *   - rajada de 5 rejoins: ≤ 2 manifests a mais (throttle de 15 s).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { rpcMock, teamMemberMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  teamMemberMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    from: () => {
      throw new Error("from() não deveria ser chamado: manifest vazio");
    },
  },
}));

vi.mock("@/modules/identity", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCurrentTeamMember: () => teamMemberMock(),
}));

// Transporte fora: o status do canal é dirigido pelo teste, direto no store.
vi.mock("@/shared/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: () => ({ state: "joined", diagnostics: [] }),
}));

vi.mock("@/modules/communication/lib/chipInstanceIds", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveChipInstanceIds: async (_org: string, instanceId: string) => [instanceId],
}));

import { useWhatsAppMessages } from "@/modules/communication/hooks/chat/useWhatsAppMessages";
import { useWhatsAppMessagesRealtime } from "@/modules/communication/hooks/chat/useWhatsAppRealtime";
import { setChannelState } from "@/lib/realtimeStatusStore";
import { whatsAppRealtimeStatusKey } from "@/shared/realtime/useRealtimeChannelStatus";
import { CHAT_RECONCILE_MIN_INTERVAL_MS } from "@/modules/communication/hooks/chat/chatReconcile";

const PHONE = "5511999990000";
const INST = "inst-1";
let seq = 0;

function manifests() {
  return rpcMock.mock.calls.filter(([nome]) => nome === "whatsapp_thread_manifest").length;
}

function montar(org: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  renderHook(
    () => {
      useWhatsAppMessagesRealtime(PHONE, INST);
      return useWhatsAppMessages(PHONE, INST);
    },
    { wrapper },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({
    data: { fingerprint: "fp", unchanged: false, manifest: [] },
    error: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reconexão → reconciliação da thread", () => {
  it("1º join não reconcilia; rejoin reconcilia 1×", async () => {
    const org = `org-rejoin-${++seq}`;
    teamMemberMock.mockReturnValue({ data: { organization_id: org } });
    const key = whatsAppRealtimeStatusKey(org);

    montar(org);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(manifests()).toBe(1); // fetch inicial

    await act(async () => {
      setChannelState(key, "joining");
      setChannelState(key, "joined"); // joinCount = 1
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(manifests()).toBe(1);

    await act(async () => {
      setChannelState(key, "joined"); // rejoin "joined"→"joined", joinCount = 2
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(manifests()).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_RECONCILE_MIN_INTERVAL_MS * 2);
    });
    expect(manifests()).toBe(2); // sem fuga: houve um pedido só
  });

  it("rajada de 5 rejoins → ≤ 2 manifests a mais", async () => {
    const org = `org-rejoin-${++seq}`;
    teamMemberMock.mockReturnValue({ data: { organization_id: org } });
    const key = whatsAppRealtimeStatusKey(org);

    montar(org);
    await act(async () => {
      setChannelState(key, "joined"); // 1º join
      await vi.advanceTimersByTimeAsync(0);
    });
    const antes = manifests();

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        setChannelState(key, "joined");
        await vi.advanceTimersByTimeAsync(500);
      });
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_RECONCILE_MIN_INTERVAL_MS * 2);
    });
    const extras = manifests() - antes;
    expect(extras).toBeGreaterThanOrEqual(1);
    expect(extras).toBeLessThanOrEqual(2);
  });
});
