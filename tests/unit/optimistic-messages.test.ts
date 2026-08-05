import { describe, it, expect } from "vitest";
import {
  isOptimisticMessage,
  makeOptimisticId,
  promoteOptimisticMessage,
  upsertRealtimeMessage,
  OPTIMISTIC_MATCH_WINDOW_MS,
} from "@/modules/communication/hooks/chat/shared/optimistic-messages";
import type { WhatsAppMessage } from "@/modules/communication/hooks/chat/types";

const BASE_TS = "2026-07-29T12:00:00.000Z";

function makeMessage(overrides: Partial<WhatsAppMessage> = {}): WhatsAppMessage {
  return {
    id: "row-1",
    organization_id: "org-1",
    instance_id: "inst-1",
    message_id: "5521999998888:3EB0ABCDEF",
    remote_jid: "5521999998888@s.whatsapp.net",
    phone_number: "5521999998888",
    direction: "outgoing",
    message_type: "text",
    content: "Bom dia",
    media_url: null,
    push_name: null,
    status: "sent",
    lead_id: null,
    timestamp: BASE_TS,
    created_at: BASE_TS,
    sent_by_ai: false,
    sent_source: "manual",
    ...overrides,
  };
}

function makeOptimistic(overrides: Partial<WhatsAppMessage> = {}): WhatsAppMessage {
  const id = makeOptimisticId();
  return makeMessage({ id, message_id: id, status: "pending", ...overrides });
}

describe("isOptimisticMessage", () => {
  it("reconhece a bolha otimista pelo prefixo do message_id", () => {
    expect(isOptimisticMessage(makeOptimistic())).toBe(true);
    expect(isOptimisticMessage(makeMessage())).toBe(false);
  });

  it("gera ids únicos mesmo em envios no mesmo milissegundo", () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeOptimisticId()));
    expect(ids.size).toBe(50);
  });
});

describe("upsertRealtimeMessage", () => {
  it("substitui a bolha otimista em vez de anexar — a mensagem não duplica", () => {
    const optimistic = makeOptimistic();
    const real = makeMessage();

    const result = upsertRealtimeMessage([optimistic], real);

    expect(result).toHaveLength(1);
    expect(result[0].message_id).toBe(real.message_id);
  });

  it("preserva a posição da bolha na timeline ao substituir", () => {
    const older = makeMessage({ id: "row-0", message_id: "id-antigo", content: "oi" });
    const optimistic = makeOptimistic({ content: "Bom dia" });
    const newer = makeMessage({ id: "row-2", message_id: "id-novo", content: "tudo bem?" });

    const result = upsertRealtimeMessage([older, optimistic, newer], makeMessage());

    expect(result.map((m) => m.message_id)).toEqual([
      "id-antigo",
      "5521999998888:3EB0ABCDEF",
      "id-novo",
    ]);
  });

  it("ignora a mensagem já presente (dedupe por message_id)", () => {
    const real = makeMessage();
    const result = upsertRealtimeMessage([real], { ...real, content: "editado" });
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Bom dia");
  });

  it("anexa quando não há bolha otimista correspondente", () => {
    const result = upsertRealtimeMessage([makeMessage({ message_id: "outro" })], makeMessage());
    expect(result).toHaveLength(2);
  });

  it("não deixa mensagem recebida consumir bolha otimista de envio", () => {
    const optimistic = makeOptimistic();
    const incoming = makeMessage({ direction: "incoming", message_id: "id-recebido" });

    const result = upsertRealtimeMessage([optimistic], incoming);

    expect(result).toHaveLength(2);
  });

  it("não casa conteúdo diferente", () => {
    const optimistic = makeOptimistic({ content: "Bom dia" });
    const result = upsertRealtimeMessage([optimistic], makeMessage({ content: "Boa tarde" }));
    expect(result).toHaveLength(2);
  });

  it("não casa tipo de mensagem diferente", () => {
    const optimistic = makeOptimistic({ message_type: "image", content: "Bom dia" });
    const result = upsertRealtimeMessage([optimistic], makeMessage({ message_type: "text" }));
    expect(result).toHaveLength(2);
  });

  it("não casa fora da janela de tempo — reenvio da mesma frase é mensagem legítima", () => {
    const foraDaJanela = new Date(
      new Date(BASE_TS).getTime() - OPTIMISTIC_MATCH_WINDOW_MS - 1000,
    ).toISOString();
    const optimistic = makeOptimistic({ timestamp: foraDaJanela });

    const result = upsertRealtimeMessage([optimistic], makeMessage());

    expect(result).toHaveLength(2);
  });

  it("com duas bolhas iguais, cada mensagem real reivindica uma", () => {
    const first = makeOptimistic();
    const second = makeOptimistic();

    let list = upsertRealtimeMessage([first, second], makeMessage({ message_id: "real-1" }));
    list = upsertRealtimeMessage(list, makeMessage({ message_id: "real-2" }));

    expect(list).toHaveLength(2);
    expect(list.map((m) => m.message_id)).toEqual(["real-1", "real-2"]);
  });

  it("casa mídia sem legenda (content null dos dois lados)", () => {
    const optimistic = makeOptimistic({ message_type: "image", content: null });
    const real = makeMessage({ message_type: "image", content: null });

    expect(upsertRealtimeMessage([optimistic], real)).toHaveLength(1);
  });
});

describe("promoteOptimisticMessage", () => {
  it("carimba o id real na bolha e marca como enviada", () => {
    const optimistic = makeOptimistic();

    const result = promoteOptimisticMessage([optimistic], optimistic.id, "real-123");

    expect(result).toHaveLength(1);
    expect(result[0].message_id).toBe("real-123");
    expect(result[0].status).toBe("sent");
  });

  it("descarta a bolha quando o realtime já trouxe a linha real", () => {
    const optimistic = makeOptimistic();
    const real = makeMessage({ message_id: "real-123" });

    const result = promoteOptimisticMessage([optimistic, real], optimistic.id, "real-123");

    expect(result).toHaveLength(1);
    expect(result[0].message_id).toBe("real-123");
  });

  it("é no-op quando a bolha já saiu do cache", () => {
    const real = makeMessage({ message_id: "outro" });
    const result = promoteOptimisticMessage([real], "optimistic_inexistente", "real-123");
    expect(result).toEqual([real]);
  });

  it("tolera cache vazio", () => {
    expect(promoteOptimisticMessage(undefined, "optimistic_x", "real-123")).toEqual([]);
  });
});

describe("promoção + realtime combinados", () => {
  it("promoção primeiro, realtime depois: uma bolha só", () => {
    const optimistic = makeOptimistic();
    const promoted = promoteOptimisticMessage([optimistic], optimistic.id, "real-123");
    const final = upsertRealtimeMessage(promoted, makeMessage({ message_id: "real-123" }));

    expect(final).toHaveLength(1);
  });

  it("realtime primeiro, promoção depois: uma bolha só", () => {
    const optimistic = makeOptimistic();
    const patched = upsertRealtimeMessage([optimistic], makeMessage({ message_id: "real-123" }));
    const final = promoteOptimisticMessage(patched, optimistic.id, "real-123");

    expect(final).toHaveLength(1);
    expect(final[0].message_id).toBe("real-123");
  });
});
