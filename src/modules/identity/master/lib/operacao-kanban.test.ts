import { describe, expect, it } from "vitest";
import {
  OPERACAO_COLUMNS,
  OPERACAO_COLUMN_STATUS,
  canMove,
  columnOf,
  groupByColumn,
  isReopenAlert,
  moveSuccessMessage,
  noopMessage,
  type OperacaoColumn,
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

/**
 * Um Chamado representante de cada coluna. O de Chamado aberto não tem
 * diagnóstico; os demais têm (com resposta pronta), como no fluxo real.
 */
const em: Record<OperacaoColumn, [OperacaoTicketFacts, OperacaoDiagnosisFacts | null]> = {
  aberto: [ticket(), null],
  diagnostico: [ticket(), withReply],
  andamento: [ticket({ status: "em_andamento" }), withReply],
  aguardando: [ticket({ status: "resolvido" }), withReply],
  concluido: [ticket({ status: "fechado" }), withReply],
};

describe("canMove — emenda ao ADR-0018: o master move livre", () => {
  const pares = OPERACAO_COLUMNS.flatMap((from) =>
    OPERACAO_COLUMNS.filter((to) => to !== from).map((to) => [from, to] as const),
  );

  it("são 20 movimentos possíveis entre 5 colunas", () => {
    expect(pares).toHaveLength(20);
  });

  it.each(pares)("master: %s → %s é permitido e grava o estado da coluna", (from, to) => {
    const [t, d] = em[from];
    expect(columnOf(t, d)).toBe(from);
    const v = canMove(t, d, to, true);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.move.from).toBe(from);
    expect(v.move.to).toBe(to);
    expect(v.move.status).toBe(OPERACAO_COLUMN_STATUS[to]);
  });

  it.each(OPERACAO_COLUMNS)("master: %s → mesma coluna não é movimento", (c) => {
    const [t, d] = em[c];
    expect(canMove(t, d, c, true)).toMatchObject({ ok: false });
  });

  it.each(pares)("não-master: %s → %s é negado", (from, to) => {
    const [t, d] = em[from];
    expect(canMove(t, d, to, false)).toEqual({ ok: false, reason: "Só o suporte move chamados no kanban." });
  });

  it("mapa coluna → estado", () => {
    expect(OPERACAO_COLUMN_STATUS).toEqual({
      aberto: "aberto",
      diagnostico: "aberto",
      andamento: "em_andamento",
      aguardando: "resolvido",
      concluido: "fechado",
    });
  });

  it("Concluído pede confirmação de fechamento", () => {
    const v = canMove(ticket({ status: "em_andamento" }), withReply, "concluido", true);
    expect(v).toMatchObject({ ok: true, move: { confirm: "fechar", status: "fechado", noop: false } });
  });

  it("Aguardando confirmação pede a escolha da resposta — inclusive vindo de Concluído", () => {
    expect(canMove(ticket(), withReply, "aguardando", true)).toMatchObject({ ok: true, move: { confirm: "resposta" } });
    expect(canMove(ticket({ status: "fechado" }), withReply, "aguardando", true)).toMatchObject({
      ok: true,
      move: { confirm: "resposta" },
    });
  });

  it("sair de Concluído para trabalho pede confirmação de reabertura", () => {
    expect(canMove(ticket({ status: "fechado" }), null, "andamento", true)).toMatchObject({
      ok: true,
      move: { confirm: "reabrir", status: "em_andamento" },
    });
  });

  it("movimento para trás entre colunas de trabalho é direto, sem diálogo", () => {
    expect(canMove(ticket({ status: "resolvido" }), withReply, "andamento", true)).toMatchObject({
      ok: true,
      move: { confirm: null },
    });
    expect(canMove(ticket({ status: "em_andamento" }), null, "aberto", true)).toMatchObject({
      ok: true,
      move: { confirm: null, landsIn: "aberto" },
    });
  });

  it("solto em Chamado aberto, um chamado com diagnóstico cai em Diagnóstico feito", () => {
    expect(canMove(ticket({ status: "em_andamento" }), noReply, "aberto", true)).toMatchObject({
      ok: true,
      move: { status: "aberto", landsIn: "diagnostico", noop: false },
    });
  });

  it("Chamado aberto ↔ Diagnóstico feito não grava nada: o estado já é aberto", () => {
    expect(canMove(ticket(), null, "diagnostico", true)).toMatchObject({
      ok: true,
      move: { noop: true, landsIn: "aberto" },
    });
    expect(canMove(ticket(), withReply, "aberto", true)).toMatchObject({
      ok: true,
      move: { noop: true, landsIn: "diagnostico" },
    });
  });

  it("aguardando_cliente (pediu informação) também sai livre", () => {
    expect(canMove(ticket({ status: "aguardando_cliente" }), null, "andamento", true)).toMatchObject({
      ok: true,
      move: { from: "aguardando", status: "em_andamento" },
    });
  });
});

describe("mensagens do movimento", () => {
  const mv = (t: OperacaoTicketFacts, d: OperacaoDiagnosisFacts | null, to: OperacaoColumn) => {
    const v = canMove(t, d, to, true);
    if (!v.ok) throw new Error(v.reason);
    return v.move;
  };

  it("Concluído avisa que o cliente não foi avisado", () => {
    expect(moveSuccessMessage(mv(ticket(), null, "concluido"), false)).toMatch(/não foi avisado/);
  });
  it("Aguardando diz se a resposta foi enviada ou não", () => {
    const m = mv(ticket({ status: "em_andamento" }), withReply, "aguardando");
    expect(moveSuccessMessage(m, true)).toMatch(/^Resposta enviada/);
    expect(moveSuccessMessage(m, false)).toMatch(/sem aviso ao cliente/);
  });
  it("solto em Chamado aberto com diagnóstico: avisa que voltou para Diagnóstico feito", () => {
    expect(moveSuccessMessage(mv(ticket({ status: "em_andamento" }), noReply, "aberto"), false)).toMatch(
      /voltou para Diagnóstico feito/,
    );
  });
  it("saindo de Concluído diz que reabriu", () => {
    expect(moveSuccessMessage(mv(ticket({ status: "fechado" }), null, "andamento"), false)).toBe(
      "Chamado reaberto. Movido para Em andamento.",
    );
  });
  it("noop explica por que nada mudou", () => {
    expect(noopMessage(mv(ticket(), null, "diagnostico"))).toMatch(/aparece sozinho/);
    expect(noopMessage(mv(ticket(), withReply, "aberto"))).toMatch(/continua em Diagnóstico feito/);
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
