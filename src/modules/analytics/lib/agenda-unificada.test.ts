import { describe, expect, it } from "vitest";
import type { AgendaContato } from "./agenda-contatos";
import {
  comparecimentoDaReuniao,
  contarAtrasados,
  contarPorTipo,
  filtrarPorTipo,
  intervaloDoPeriodo,
  itemDoEvento,
  montarAgenda,
  type EventoDaAgenda,
} from "./agenda-unificada";

const TZ = "America/Sao_Paulo";

function evento(p: Partial<EventoDaAgenda>): EventoDaAgenda {
  return {
    id: "e1",
    source: "meeting",
    title: "Reunião - Cliente",
    description: null,
    start_at: "2026-11-17T17:00:00Z", // 14:00 BRT
    event_type: "meeting",
    status: "scheduled",
    lead_id: "l1",
    lead_name: "Cliente",
    lead_company: null,
    created_by: null,
    creator_name: "Ana",
    ...p,
  };
}

function contato(p: Partial<AgendaContato>): AgendaContato {
  return {
    id: "c1",
    lead_id: "l2",
    lead_name: "Outro",
    lead_company: null,
    lead_phone: null,
    lead_phones: null,
    lead_erp_code: null,
    lead_uf: null,
    lead_cidade: null,
    erp_representante: null,
    owner_id: "o1",
    owner_name: "Ana",
    data_agenda: "2026-11-17",
    observacao: null,
    situacao: "hoje",
    created_at: "2026-11-10T12:00:00Z",
    ...p,
  };
}

describe("intervaloDoPeriodo", () => {
  it("hoje é só o dia", () => {
    expect(intervaloDoPeriodo("2026-11-17", "hoje")).toEqual({ de: "2026-11-17", ate: "2026-11-17" });
  });
  it("semana vai de segunda a domingo (17/11/2026 é terça)", () => {
    expect(intervaloDoPeriodo("2026-11-17", "semana")).toEqual({ de: "2026-11-16", ate: "2026-11-22" });
  });
  it("semana: domingo pertence à semana que termina nele", () => {
    expect(intervaloDoPeriodo("2026-11-22", "semana")).toEqual({ de: "2026-11-16", ate: "2026-11-22" });
  });
  it("mês vai do dia 1 ao último", () => {
    expect(intervaloDoPeriodo("2026-02-10", "mes")).toEqual({ de: "2026-02-01", ate: "2026-02-28" });
  });
});

describe("itemDoEvento", () => {
  it("reunião e mensagem viram itens; o resto fica de fora", () => {
    expect(itemDoEvento(evento({}), TZ)?.tipo).toBe("reuniao");
    expect(itemDoEvento(evento({ source: "scheduled_message" }), TZ)?.tipo).toBe("mensagem");
    expect(itemDoEvento(evento({ source: "follow_up" }), TZ)).toBeNull();
  });
  it("cancelada e falha não aparecem", () => {
    expect(itemDoEvento(evento({ status: "cancelled" }), TZ)).toBeNull();
    expect(itemDoEvento(evento({ source: "scheduled_message", status: "failed" }), TZ)).toBeNull();
  });
  it("dia e hora saem no fuso da org, não no UTC", () => {
    // 01:30 UTC de 18/11 ainda é 22:30 de 17/11 em Brasília.
    const it = itemDoEvento(evento({ start_at: "2026-11-18T01:30:00Z" }), TZ);
    expect(it?.dia).toBe("2026-11-17");
    expect(it?.hora).toBe("22:30");
  });
  it("realizada, falta e enviada saem como encerradas", () => {
    expect(itemDoEvento(evento({ status: "completed" }), TZ)?.encerrada).toBe(true);
    expect(itemDoEvento(evento({ status: "no_show" }), TZ)?.encerrada).toBe(true);
    expect(itemDoEvento(evento({ source: "scheduled_message", status: "sent" }), TZ)?.encerrada).toBe(true);
    expect(itemDoEvento(evento({ status: "scheduled" }), TZ)?.encerrada).toBe(false);
  });
});

describe("montarAgenda", () => {
  const base = { hoje: "2026-11-17", timezone: TZ };

  it("mistura os três tipos do período, em ordem de dia e hora", () => {
    const itens = montarAgenda({
      ...base,
      periodo: "hoje",
      eventos: [
        evento({ id: "m", source: "scheduled_message", start_at: "2026-11-17T12:00:00Z" }), // 09:00
        evento({ id: "r", start_at: "2026-11-17T17:00:00Z" }), // 14:00
      ],
      contatos: [contato({})],
    });
    expect(itens.map((i) => i.tipo)).toEqual(["contato", "mensagem", "reuniao"]);
  });

  it("tira o que está fora do período", () => {
    const itens = montarAgenda({
      ...base,
      periodo: "hoje",
      eventos: [evento({ id: "amanha", start_at: "2026-11-18T17:00:00Z" })],
      contatos: [],
    });
    expect(itens).toHaveLength(0);
  });

  it("semana traz o que cai de segunda a domingo", () => {
    const itens = montarAgenda({
      ...base,
      periodo: "semana",
      eventos: [
        evento({ id: "a", start_at: "2026-11-16T17:00:00Z" }),
        evento({ id: "b", start_at: "2026-11-22T17:00:00Z" }),
        evento({ id: "c", start_at: "2026-11-23T17:00:00Z" }),
      ],
      contatos: [],
    });
    expect(itens.map((i) => i.chave)).toEqual(["meeting:a", "meeting:b"]);
  });

  it("contato ATRASADO aparece em qualquer período; o futuro de fora não", () => {
    const itens = montarAgenda({
      ...base,
      periodo: "hoje",
      eventos: [],
      contatos: [
        contato({ id: "velho", data_agenda: "2026-11-01", situacao: "atrasada" }),
        contato({ id: "longe", data_agenda: "2026-12-05", situacao: "futura" }),
      ],
    });
    expect(itens.map((i) => i.chave)).toEqual(["contato:velho"]);
  });

  it("não duplica o mesmo evento vindo de duas janelas", () => {
    const e = evento({ id: "dup" });
    const itens = montarAgenda({ ...base, periodo: "hoje", eventos: [e, e], contatos: [] });
    expect(itens).toHaveLength(1);
  });
});

describe("contagem e filtro por tipo", () => {
  const itens = montarAgenda({
    hoje: "2026-11-17",
    timezone: TZ,
    periodo: "hoje",
    eventos: [evento({ id: "r" }), evento({ id: "m", source: "scheduled_message" })],
    contatos: [contato({})],
  });
  it("conta por tipo", () => {
    expect(contarPorTipo(itens)).toEqual({ todos: 3, reuniao: 1, mensagem: 1, contato: 1 });
  });
  it("filtra por tipo e 'todos' devolve tudo", () => {
    expect(filtrarPorTipo(itens, "mensagem")).toHaveLength(1);
    expect(filtrarPorTipo(itens, "todos")).toHaveLength(3);
  });
});

describe("atrasados abertos no Hoje", () => {
  const base = { hoje: "2026-11-17", timezone: TZ, contatos: [] as AgendaContato[] };
  const ontem = (p: Partial<EventoDaAgenda> = {}) =>
    evento({ id: "velha", start_at: "2026-11-14T17:00:00Z", status: "scheduled", ...p }); // 14/11 14:00

  it("reunião de dia anterior sem desfecho entra no Hoje e fica marcada como atrasada", () => {
    const itens = montarAgenda({ ...base, periodo: "hoje", eventos: [], atrasados: [ontem()] });
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ tipo: "reuniao", atrasada: true, encerrada: false, origemId: "velha" });
  });

  it("mensagem agendada que não saiu também entra", () => {
    const itens = montarAgenda({ ...base, periodo: "hoje", eventos: [], atrasados: [ontem({ source: "scheduled_message", id: "m" })] });
    expect(itens[0]).toMatchObject({ tipo: "mensagem", atrasada: true });
  });

  it("com desfecho registrado (realizada, falta) ou enviada, não entra", () => {
    const itens = montarAgenda({
      ...base,
      periodo: "hoje",
      eventos: [],
      atrasados: [ontem({ status: "completed" }), ontem({ id: "b", status: "no_show" }), ontem({ id: "c", source: "scheduled_message", status: "sent" })],
    });
    expect(itens).toHaveLength(0);
  });

  it("o de hoje não é atrasado, mesmo com a hora já passada", () => {
    const itens = montarAgenda({ ...base, periodo: "hoje", eventos: [evento({ start_at: "2026-11-17T11:00:00Z" })] }); // 08:00
    expect(itens[0].atrasada).toBe(false);
  });

  it("semana e mês não carregam atrasado de fora do período", () => {
    const sem = montarAgenda({ ...base, periodo: "semana", eventos: [], atrasados: [ontem()] });
    expect(sem).toHaveLength(0);
  });

  it("não duplica a reunião que veio nas duas buscas e ordena a mais antiga primeiro", () => {
    const velha = ontem();
    const mais = ontem({ id: "mais", start_at: "2026-10-20T17:00:00Z" });
    const itens = montarAgenda({ ...base, periodo: "hoje", eventos: [velha], atrasados: [velha, mais] });
    expect(itens.map((i) => i.origemId)).toEqual(["mais", "velha"]);
  });

  it("contato atrasado conta como atrasado; o futuro não", () => {
    const itens = montarAgenda({
      ...base,
      periodo: "hoje",
      eventos: [],
      contatos: [contato({ id: "a", data_agenda: "2026-11-10", situacao: "atrasada" }), contato({ id: "b", data_agenda: "2026-11-17", situacao: "hoje" })],
    });
    expect(contarAtrasados(itens)).toBe(1);
  });
});

describe("comparecimentoDaReuniao", () => {
  const hoje = "2026-11-17";
  const reuniao = (p: Partial<EventoDaAgenda> = {}) => {
    const it = itemDoEvento(evento(p), TZ, hoje);
    if (!it) throw new Error("evento de teste não virou item");
    return it;
  };

  it("reunião de hoje ainda aberta pode ser marcada — antes ficava sem botão até virar o dia", () => {
    expect(comparecimentoDaReuniao(reuniao({ start_at: "2026-11-17T13:00:00Z" }), hoje)).toBe("marcar"); // 10:00
  });

  it("reunião de hoje com a hora ainda por vir também pode ser marcada", () => {
    expect(comparecimentoDaReuniao(reuniao({ start_at: "2026-11-17T22:00:00Z" }), hoje)).toBe("marcar"); // 19:00
  });

  it("reunião atrasada e aberta pode ser marcada", () => {
    expect(comparecimentoDaReuniao(reuniao({ start_at: "2026-11-14T17:00:00Z" }), hoje)).toBe("marcar");
  });

  it("reunião de dia futuro mostra os botões, mas aguarda o dia", () => {
    expect(comparecimentoDaReuniao(reuniao({ start_at: "2026-11-18T13:00:00Z" }), hoje)).toBe("aguarda");
  });

  it("o dia é o do fuso da org: 22:30 de hoje em Brasília (01:30 UTC de amanhã) já pode", () => {
    expect(comparecimentoDaReuniao(reuniao({ start_at: "2026-11-18T01:30:00Z" }), hoje)).toBe("marcar");
  });

  it("com desfecho, mostra qual foi", () => {
    expect(comparecimentoDaReuniao(reuniao({ status: "completed" }), hoje)).toBe("compareceu");
    expect(comparecimentoDaReuniao(reuniao({ status: "no_show" }), hoje)).toBe("faltou");
  });

  it("o status vem em qualquer caixa do banco", () => {
    expect(comparecimentoDaReuniao(reuniao({ status: "COMPLETED" }), hoje)).toBe("compareceu");
  });

  it("mensagem e próximo contato não têm comparecimento", () => {
    expect(comparecimentoDaReuniao(reuniao({ source: "scheduled_message" }), hoje)).toBeNull();
    const [c] = montarAgenda({ hoje, timezone: TZ, periodo: "hoje", eventos: [], contatos: [contato({})] });
    expect(comparecimentoDaReuniao(c, hoje)).toBeNull();
  });
});
