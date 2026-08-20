/**
 * O bug que este arquivo tranca: a lista mostrava a conversa com última
 * mensagem e a thread abria escrito "Comece a conversa / Primeira interação".
 * Duas fontes diferentes (`whatsapp_conversation_summary` via RPC DEFINER vs
 * `whatsapp_messages` via SELECT direto), então a divergência é alcançável — e
 * a tela não pode responder a ela com uma afirmação falsa.
 */
import { describe, expect, it } from "vitest";
import { resolveThreadState } from "@/modules/communication/lib/resolveThreadState";

const base = {
  isLoading: false,
  isError: false,
  messageCount: 0,
  failedCount: 0,
  callCount: 0,
  lastMessageTime: null as string | null,
};

describe("resolveThreadState", () => {
  it("carregando vence tudo — nem erro nem contradição aparecem antes da hora", () => {
    expect(
      resolveThreadState({
        ...base,
        isLoading: true,
        isError: true,
        lastMessageTime: "2026-08-19T13:52:00Z",
      }),
    ).toBe("loading");
  });

  it("query falhou → erro, e não 'conversa nova' (isError não era lido)", () => {
    expect(resolveThreadState({ ...base, isError: true })).toBe("error");
  });

  it("thread vazia + lista com última mensagem → contradição, nunca 'conversa nova'", () => {
    expect(
      resolveThreadState({ ...base, lastMessageTime: "2026-08-19T13:52:00Z" }),
    ).toBe("inconsistent");
  });

  it("thread vazia e lista sem última mensagem → conversa nova de verdade", () => {
    expect(resolveThreadState(base)).toBe("list");
  });

  it("deep-link de lead sem contato na lista continua caindo no estado vazio legítimo", () => {
    expect(resolveThreadState({ ...base, lastMessageTime: undefined })).toBe(
      "list",
    );
  });

  it("mensagem lida → lista, mesmo com a lista afirmando última mensagem", () => {
    expect(
      resolveThreadState({
        ...base,
        messageCount: 12,
        lastMessageTime: "2026-08-19T13:52:00Z",
      }),
    ).toBe("list");
  });

  it("só envio falho não é contradição — o conteúdo está na tela", () => {
    expect(
      resolveThreadState({
        ...base,
        failedCount: 1,
        lastMessageTime: "2026-08-19T13:52:00Z",
      }),
    ).toBe("list");
  });

  it("conversa que só teve ligação não vira contradição", () => {
    expect(
      resolveThreadState({
        ...base,
        callCount: 2,
        lastMessageTime: "2026-08-19T13:52:00Z",
      }),
    ).toBe("list");
  });

  it("erro vence a contradição — a causa conhecida é mais informativa", () => {
    expect(
      resolveThreadState({
        ...base,
        isError: true,
        lastMessageTime: "2026-08-19T13:52:00Z",
      }),
    ).toBe("error");
  });
});
