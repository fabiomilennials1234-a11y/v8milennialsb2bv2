/**
 * `mergeRealtimeUpdate` na clássica — contrato da função pura (a08bf2381).
 *
 * UPDATE do Realtime não traz coluna TOAST inalterada (`raw_payload`): a chave
 * vem AUSENTE. Trocar a linha por `payload.new` apagava menu/botões/pix.
 */
import { describe, it, expect } from "vitest";
import { mergeRealtimeUpdate } from "@/modules/communication/hooks/chat/shared/realtimeUpdate";

const RAW = { content: { title: "Planos" } };
const linha = {
  id: "m-1",
  status: "sent",
  pinned_at: "2026-10-05T15:01:00Z" as string | null,
  raw_payload: RAW as unknown,
  uazapi_menu_title: "Planos" as string | undefined,
};

describe("mergeRealtimeUpdate", () => {
  it("chave ausente mantém o valor do cache", () => {
    const m = mergeRealtimeUpdate(linha, { id: "m-1", status: "delivered" });
    expect(m.status).toBe("delivered");
    expect(m.raw_payload).toBe(RAW);
    expect(m.uazapi_menu_title).toBe("Planos");
  });

  it("undefined explícito não apaga", () => {
    expect(mergeRealtimeUpdate(linha, { raw_payload: undefined }).raw_payload).toBe(RAW);
  });

  it("null explícito sobrescreve (mudança real)", () => {
    expect(mergeRealtimeUpdate(linha, { pinned_at: null }).pinned_at).toBeNull();
  });

  it("raw_payload novo descarta as projeções uazapi_* velhas", () => {
    const novo = { content: { title: "Novos" } };
    const m = mergeRealtimeUpdate(linha, { raw_payload: novo });
    expect(m.raw_payload).toBe(novo);
    expect("uazapi_menu_title" in m).toBe(false);
  });

  it("não muta a linha do cache", () => {
    mergeRealtimeUpdate(linha, { status: "read", raw_payload: {} });
    expect(linha.status).toBe("sent");
    expect(linha.uazapi_menu_title).toBe("Planos");
  });
});
