import { describe, it, expect } from "vitest";
import { SUPPORT_REPLY_TYPE, summarizeUnreadReplies } from "./support-unread";

const reply = (entityId: string | null) => ({
  id: crypto.randomUUID(),
  type: SUPPORT_REPLY_TYPE,
  entity_id: entityId,
});

describe("summarizeUnreadReplies", () => {
  it("conta as respostas não lidas por chamado", () => {
    const { byTicket, total } = summarizeUnreadReplies([reply("t1"), reply("t1"), reply("t2")]);
    expect(byTicket).toEqual({ t1: 2, t2: 1 });
    expect(total).toBe(3);
  });

  it("uma lista vazia não lança", () => {
    expect(summarizeUnreadReplies([])).toEqual({ byTicket: {}, total: 0 });
  });

  // A tabela `notifications` é compartilhada. Uma reunião de hoje não é uma
  // resposta do suporte.
  it("ignora notificações de outros tipos", () => {
    const outra = { id: "n1", type: "meeting_today", entity_id: "t1" };
    const { byTicket, total } = summarizeUnreadReplies([outra, reply("t1")]);
    expect(byTicket).toEqual({ t1: 1 });
    expect(total).toBe(1);
  });

  // `entity_id` é nullable: uma notificação antiga, ou malformada, não deve
  // virar uma chave "null" no mapa.
  it("descarta resposta sem chamado associado", () => {
    const { byTicket, total } = summarizeUnreadReplies([reply(null), reply("t1")]);
    expect(byTicket).toEqual({ t1: 1 });
    expect(total).toBe(1);
  });

  it("o total é a soma das contagens, não o número de chamados", () => {
    expect(summarizeUnreadReplies([reply("t1"), reply("t1"), reply("t1")]).total).toBe(3);
  });
});
