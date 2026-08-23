import { describe, it, expect } from "vitest";
import type { AcaoDoDia } from "@/modules/engagement";
import { classificarTarefas } from "./tarefas-do-dia";

/**
 * A virada do dia é a única regra de negócio deste bloco, e ela é invisível a
 * olho nu: `acoes_do_dia` não tem coluna de prazo, então "atrasada" é derivada
 * de `created_at` contra o começo do dia NO FUSO DA ORG.
 *
 * O caso que importa é a faixa das 00:00 às 03:00 em São Paulo (UTC-3): nela o
 * dia UTC já virou e o dia org-local ainda não. Uma tarefa criada nessa faixa
 * seria classificada como "de ontem" — e apareceria como Atrasada — se o corte
 * fosse feito em UTC.
 */

function tarefa(over: Partial<AcaoDoDia> & { id: string }): AcaoDoDia {
  return {
    user_id: "u1",
    title: `tarefa ${over.id}`,
    description: null,
    proposta_id: null,
    lead_id: null,
    confirmacao_id: null,
    follow_up_id: null,
    is_completed: false,
    position: 0,
    created_at: "2026-08-21T12:00:00.000Z",
    completed_at: null,
    ...over,
  } as AcaoDoDia;
}

const SP = "America/Sao_Paulo";
// 21/08/2026 às 10:00 em São Paulo.
const AGORA = new Date("2026-08-21T13:00:00.000Z");

describe("classificarTarefas", () => {
  it("marca como atrasada a não concluída criada antes de hoje", () => {
    const r = classificarTarefas(
      [
        tarefa({ id: "ontem", created_at: "2026-08-20T14:00:00.000Z" }),
        tarefa({ id: "hoje", created_at: "2026-08-21T11:00:00.000Z" }),
      ],
      SP,
      AGORA,
    );

    expect(r.atrasadasCount).toBe(1);
    expect(r.pendentes.map((p) => p.tarefa.id)).toEqual(["ontem", "hoje"]);
    expect(r.pendentes[0].atrasada).toBe(true);
    expect(r.pendentes[1].atrasada).toBe(false);
  });

  it("não acusa atrasada a tarefa criada na madrugada org-local, que em UTC já é outro dia", () => {
    // 01:00 em São Paulo = 04:00Z do MESMO dia. O corte org-local é 03:00Z,
    // então a tarefa é de hoje. Um corte em UTC (00:00Z) também diria hoje —
    // o caso que quebra é o inverso, abaixo.
    const r = classificarTarefas(
      [tarefa({ id: "madrugada", created_at: "2026-08-21T04:00:00.000Z" })],
      SP,
      AGORA,
    );
    expect(r.atrasadasCount).toBe(0);
  });

  it("respeita o fuso da org: 22:00 de ontem em SP ainda é ontem, mesmo já sendo hoje em UTC", () => {
    // 20/08 às 22:00 em São Paulo = 21/08T01:00Z. Em UTC o dia já virou e a
    // tarefa passaria por "de hoje"; no fuso da org ela é de ontem.
    const r = classificarTarefas(
      [tarefa({ id: "noite-de-ontem", created_at: "2026-08-21T01:00:00.000Z" })],
      SP,
      AGORA,
    );
    expect(r.atrasadasCount).toBe(1);
  });

  it("tira as concluídas da lista principal e devolve só as concluídas hoje", () => {
    const r = classificarTarefas(
      [
        tarefa({
          id: "feita-hoje",
          is_completed: true,
          completed_at: "2026-08-21T12:30:00.000Z",
        }),
        tarefa({
          id: "feita-ontem",
          is_completed: true,
          completed_at: "2026-08-20T12:30:00.000Z",
        }),
        tarefa({ id: "aberta" }),
      ],
      SP,
      AGORA,
    );

    expect(r.pendentes.map((p) => p.tarefa.id)).toEqual(["aberta"]);
    expect(r.concluidasHoje.map((t) => t.id)).toEqual(["feita-hoje"]);
  });

  it("ordena atrasadas primeiro e, dentro do grupo, por position", () => {
    const r = classificarTarefas(
      [
        tarefa({ id: "b-hoje", position: 1 }),
        tarefa({ id: "a-hoje", position: 0 }),
        tarefa({
          id: "z-atrasada",
          position: 9,
          created_at: "2026-08-19T10:00:00.000Z",
        }),
      ],
      SP,
      AGORA,
    );

    expect(r.pendentes.map((p) => p.tarefa.id)).toEqual([
      "z-atrasada",
      "a-hoje",
      "b-hoje",
    ]);
  });

  it("aguenta lista vazia e indefinida", () => {
    expect(classificarTarefas(undefined, SP, AGORA).pendentes).toEqual([]);
    expect(classificarTarefas([], null, AGORA).atrasadasCount).toBe(0);
  });
});
