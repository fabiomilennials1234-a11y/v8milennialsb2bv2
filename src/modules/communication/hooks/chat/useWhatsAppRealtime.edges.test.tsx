/**
 * Bordas do merge de UPDATE do Realtime em `whatsapp_messages` (QA, 05/10).
 *
 * Formato real de um UPDATE (wal2json v2 + REPLICA IDENTITY DEFAULT): colunas
 * não-TOAST presentes, `raw_payload` em TOAST inalterado AUSENTE, projeções
 * `uazapi_*` do SELECT nunca presentes. Cobre o que a suíte principal não
 * cobre: eco de INSERT seguido de UPDATE, UPDATE de linha fora do cache,
 * `raw_payload: null`, colunas que o cache não conhece e status fora de ordem.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

let capturedOnEvent: ((payload: unknown) => void) | null = null;

vi.mock("@/shared/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: (opts: { onEvent: (payload: unknown) => void }) => {
    capturedOnEvent = opts.onEvent;
  },
}));

vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { organization_id: "org-1" } }),
}));

import { useWhatsAppMessagesRealtime } from "./useWhatsAppRealtime";
import { chatQueryKeys } from "./shared/queryKeys";
import { mergeRealtimeUpdate } from "./shared/realtimeUpdate";
import { readUazapiMenu } from "@/modules/communication/lib/uazapiMenuDisplay";
import { readUazapiPix } from "@/modules/communication/lib/uazapiPixDisplay";

const ORG = "org-1";
const INST = "inst-1";
const TELEFONE = "5548999990002";

// Linha como o SELECT a deixa no cache: projeções, SEM a chave raw_payload.
const doSelect = {
  id: "row-1",
  message_id: "wamid-1",
  phone_number: TELEFONE,
  instance_id: INST,
  direction: "outgoing",
  status: "sent",
  content: "Escolha um plano",
  timestamp: "2026-10-05T15:00:00Z",
  deleted_at: null as string | null,
  uazapi_menu_title: "Planos",
  uazapi_menu_sections: [{ title: "S", rows: [{ title: "Pro" }] }],
  uazapi_pix_key: "chave@pix",
  uazapi_pix_name: "Loja",
};

const colunasDoUpdate = Object.fromEntries(
  Object.entries(doSelect).filter(([k]) => !k.startsWith("uazapi_")),
);

function setup(seed: unknown[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(chatQueryKeys.messages(ORG, TELEFONE, INST), seed);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  renderHook(() => useWhatsAppMessagesRealtime(TELEFONE, INST), { wrapper });
  return qc;
}

const thread = (qc: QueryClient) =>
  (qc.getQueryData(chatQueryKeys.messages(ORG, TELEFONE, INST)) ?? []) as Array<
    Record<string, unknown>
  >;

const update = (extra: Record<string, unknown>) => ({
  eventType: "UPDATE",
  new: { ...colunasDoUpdate, ...extra },
  old: { id: doSelect.id },
});

describe("mergeRealtimeUpdate — bordas puras", () => {
  it("coluna que o cache não conhece entra na linha", () => {
    const out = mergeRealtimeUpdate(doSelect as Record<string, unknown>, { coluna_nova: "x" });
    expect(out.coluna_nova).toBe("x");
    expect(out.uazapi_menu_title).toBe("Planos");
  });

  it("não muta a linha anterior do cache", () => {
    const prev = { ...doSelect } as Record<string, unknown>;
    mergeRealtimeUpdate(prev, { status: "read", raw_payload: { content: {} } });
    expect(prev).toEqual(doSelect);
  });

  it("raw_payload: null explícito sobrescreve e derruba projeções (sem menu velho)", () => {
    const out = mergeRealtimeUpdate(doSelect as Record<string, unknown>, { raw_payload: null });
    expect(out.raw_payload).toBeNull();
    expect(Object.keys(out).some((k) => k.startsWith("uazapi_"))).toBe(false);
    expect(readUazapiMenu(out)).toBeNull();
    expect(readUazapiPix(out)).toBeNull();
  });

  it("raw_payload novo inline: leitor de pix cai no raw_payload, não na projeção velha", () => {
    const out = mergeRealtimeUpdate(doSelect as Record<string, unknown>, {
      raw_payload: { sendPayload: { pixKey: "nova@pix", pixName: "Outra" } },
    });
    expect(readUazapiPix(out)).toEqual({ key: "nova@pix", name: "Outra", type: "" });
  });
});

describe("useWhatsAppMessagesRealtime — bordas do UPDATE", () => {
  it("UPDATE de linha fora do cache não cria linha parcial", () => {
    const qc = setup([doSelect]);
    capturedOnEvent?.({
      eventType: "UPDATE",
      new: { ...colunasDoUpdate, id: "row-x", message_id: "wamid-x", status: "read" },
      old: { id: "row-x" },
    });
    expect(thread(qc)).toHaveLength(1);
    expect(thread(qc)[0].id).toBe("row-1");
  });

  it("UPDATE com thread nunca carregada não semeia o cache", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    renderHook(() => useWhatsAppMessagesRealtime(TELEFONE, INST), { wrapper });
    capturedOnEvent?.(update({ status: "delivered" }));
    expect(qc.getQueryData(chatQueryKeys.messages(ORG, TELEFONE, INST))).toBeUndefined();
  });

  it("INSERT + eco duplicado + UPDATE sem raw_payload: uma linha, menu preservado", () => {
    const qc = setup([]);
    const raw = { content: { title: "Planos", sections: [{ title: "S", rows: [{ title: "Pro" }] }] } };
    const insert = { eventType: "INSERT", new: { ...colunasDoUpdate, raw_payload: raw } };
    capturedOnEvent?.(insert);
    capturedOnEvent?.(insert);
    capturedOnEvent?.(update({ status: "delivered" }));
    const t = thread(qc);
    expect(t).toHaveLength(1);
    expect(t[0].status).toBe("delivered");
    expect(t[0].raw_payload).toEqual(raw);
    expect(readUazapiMenu(t[0])?.title).toBe("Planos");
  });

  it("UPDATE de deleted_at sem raw_payload aplica a coluna e mantém projeções", () => {
    const qc = setup([doSelect]);
    capturedOnEvent?.(update({ deleted_at: "2026-10-05T16:00:00Z" }));
    const m = thread(qc)[0];
    expect(m.deleted_at).toBe("2026-10-05T16:00:00Z");
    expect(readUazapiPix(m)?.key).toBe("chave@pix");
  });

  it("documenta: status fora de ordem (read → delivered) fica com o último — igual ao replace antigo", () => {
    const qc = setup([doSelect]);
    capturedOnEvent?.(update({ status: "read" }));
    capturedOnEvent?.(update({ status: "delivered" }));
    const m = thread(qc)[0];
    expect(m.status).toBe("delivered");
    expect(m.uazapi_menu_title).toBe("Planos");
  });
});
