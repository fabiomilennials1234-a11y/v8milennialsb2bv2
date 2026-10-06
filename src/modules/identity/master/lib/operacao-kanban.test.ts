import { describe, expect, it } from "vitest";
import {
  canMove,
  columnOf,
  groupByColumn,
  isReopenAlert,
  type OperacaoDiagnosisFacts,
  type OperacaoTicketFacts,
} from "./operacao-kanban";

const ticket = (over: Partial<OperacaoTicketFacts> = {}): OperacaoTicketFacts => ({
  status: "aberto",
  reopen_count: 0,
  assigned_master_user_id: null,
  ...over,
});
const withReply: OperacaoDiagnosisFacts = { customer_reply: "Corrigimos o envio." };
const noReply: OperacaoDiagnosisFacts = { customer_reply: "   " };

describe("columnOf — OP-8: a coluna vem do dado", () => {
  it("aberto sem diagnóstico fica em Chamado aberto", () => {
    expect(columnOf(ticket(), null)).toBe("aberto");
  });
  it("aberto com diagnóstico vai para Diagnóstico feito", () => {
    expect(columnOf(ticket(), noReply)).toBe("diagnostico");
  });
  it("em_andamento é Em andamento, com ou sem diagnóstico", () => {
    expect(columnOf(ticket({ status: "em_andamento" }), null)).toBe("andamento");
  });
  it("resolvido e aguardando_cliente aguardam confirmação", () => {
    expect(columnOf(ticket({ status: "resolvido" }), withReply)).toBe("aguardando");
    expect(columnOf(ticket({ status: "aguardando_cliente" }), null)).toBe("aguardando");
  });
  it("fechado é Concluído", () => {
    expect(columnOf(ticket({ status: "fechado" }), withReply)).toBe("concluido");
  });
});

describe("canMove", () => {
  it("OP-4: ninguém arrasta para Concluído", () => {
    const v = canMove(ticket({ status: "resolvido" }), withReply, "concluido");
    expect(v.ok).toBe(false);
  });
  it("OP-5: ninguém do suporte devolve para Chamado aberto", () => {
    expect(canMove(ticket({ status: "em_andamento" }), withReply, "aberto").ok).toBe(false);
  });
  it("OP-6: fechado não sai do lugar", () => {
    expect(canMove(ticket({ status: "fechado" }), withReply, "andamento").ok).toBe(false);
  });
  it("OP-8: Diagnóstico feito não é destino de arrasto", () => {
    expect(canMove(ticket(), null, "diagnostico").ok).toBe(false);
  });
  it("sem diagnóstico não dá para pegar", () => {
    expect(canMove(ticket(), null, "andamento").ok).toBe(false);
  });
  it("com diagnóstico, pegar põe em andamento", () => {
    expect(canMove(ticket(), noReply, "andamento")).toEqual({ ok: true, move: { kind: "pegar" } });
  });
  it("OP-9: sem resposta pronta, o envio é bloqueado", () => {
    const v = canMove(ticket({ status: "em_andamento" }), noReply, "aguardando");
    expect(v).toMatchObject({ ok: false });
    expect(canMove(ticket({ status: "em_andamento" }), null, "aguardando").ok).toBe(false);
  });
  it("OP-9: com resposta pronta, ir para Aguardando envia a resposta", () => {
    expect(canMove(ticket({ status: "em_andamento" }), withReply, "aguardando")).toEqual({
      ok: true,
      move: { kind: "enviar_resposta" },
    });
  });
  it("não pula Em andamento: de Diagnóstico feito direto para Aguardando é bloqueado", () => {
    expect(canMove(ticket(), withReply, "aguardando").ok).toBe(false);
  });
  it("cliente respondeu ao pedido de informação: volta ao trabalho", () => {
    expect(canMove(ticket({ status: "aguardando_cliente" }), null, "andamento")).toEqual({
      ok: true,
      move: { kind: "retomar" },
    });
  });
  it("Resolvido não volta para Em andamento pelo suporte", () => {
    expect(canMove(ticket({ status: "resolvido" }), withReply, "andamento").ok).toBe(false);
  });
  it("mesma coluna não é movimento", () => {
    expect(canMove(ticket(), null, "aberto").ok).toBe(false);
  });
});

describe("isReopenAlert — OP-10", () => {
  it("dispara na terceira reabertura", () => {
    expect(isReopenAlert({ reopen_count: 2 })).toBe(false);
    expect(isReopenAlert({ reopen_count: 3 })).toBe(true);
  });
});

describe("groupByColumn", () => {
  it("distribui mantendo a ordem de chegada", () => {
    const list = [
      { ...ticket(), id: "a" },
      { ...ticket(), id: "b" },
      { ...ticket({ status: "fechado" }), id: "c" },
    ];
    const g = groupByColumn(list, new Map([["b", noReply]]));
    expect(g.aberto.map((t) => t.id)).toEqual(["a"]);
    expect(g.diagnostico.map((t) => t.id)).toEqual(["b"]);
    expect(g.concluido.map((t) => t.id)).toEqual(["c"]);
    expect(g.andamento).toEqual([]);
  });
});
