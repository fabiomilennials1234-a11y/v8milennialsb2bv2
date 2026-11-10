import { describe, expect, it } from "vitest";
import {
  contarPorSituacao,
  dataComSemana,
  diasDeDistancia,
  distanciaRelativa,
  filtrarAgendas,
  hojeNoFuso,
  proximosDias,
  termoDeBusca,
  type AgendaContato,
} from "./agenda-contatos";

const agenda = (over: Partial<AgendaContato>): AgendaContato => ({
  id: "a",
  lead_id: "l",
  lead_name: "Cliente",
  lead_company: null,
  lead_phone: null,
  lead_phones: null,
  lead_erp_code: null,
  lead_uf: null,
  lead_cidade: null,
  erp_representante: null,
  owner_id: "tm",
  owner_name: null,
  data_agenda: "2026-11-10",
  observacao: null,
  situacao: "hoje",
  created_at: "2026-11-01T00:00:00Z",
  ...over,
});

describe("agenda de contatos — datas", () => {
  it("hoje no fuso da org, não no do navegador", () => {
    // 01:30 UTC de 11/11 ainda é 10/11 em São Paulo.
    expect(hojeNoFuso("America/Sao_Paulo", new Date("2026-11-11T01:30:00Z"))).toBe("2026-11-10");
    expect(hojeNoFuso("UTC", new Date("2026-11-11T01:30:00Z"))).toBe("2026-11-11");
  });

  it("fuso inválido cai em São Paulo em vez de quebrar a tela", () => {
    expect(hojeNoFuso("Nada/Isso", new Date("2026-11-11T01:30:00Z"))).toBe("2026-11-10");
  });

  it("distância em dias de calendário, atravessando mês", () => {
    expect(diasDeDistancia("2026-12-01", "2026-11-28")).toBe(3);
    expect(diasDeDistancia("2026-11-07", "2026-11-10")).toBe(-3);
  });

  it("rótulo relativo lê como gente fala", () => {
    expect(distanciaRelativa("2026-11-10", "2026-11-10")).toBe("hoje");
    expect(distanciaRelativa("2026-11-11", "2026-11-10")).toBe("amanhã");
    expect(distanciaRelativa("2026-11-09", "2026-11-10")).toBe("ontem");
    expect(distanciaRelativa("2026-11-15", "2026-11-10")).toBe("em 5 dias");
    expect(distanciaRelativa("2026-11-07", "2026-11-10")).toBe("há 3 dias");
  });

  it("data com dia da semana, sem deslize de UTC", () => {
    expect(dataComSemana("2026-11-10")).toBe("Ter, 10 nov");
  });
});

describe("agenda de contatos — resumo e filtro", () => {
  const linhas = [
    { dia: null, situacao: "atrasada" as const, total: 4 },
    { dia: "2026-11-10", situacao: "hoje" as const, total: 2 },
    { dia: "2026-11-12", situacao: "futura" as const, total: 3 },
    { dia: "2026-11-30", situacao: "futura" as const, total: 1 },
  ];

  it("conta por cor", () => {
    expect(contarPorSituacao(linhas)).toEqual({ atrasada: 4, hoje: 2, futura: 4 });
  });

  it("semana começa hoje, não pula dia vazio e ignora o que está além", () => {
    const semana = proximosDias(linhas, "2026-11-10", 7);
    expect(semana).toHaveLength(7);
    expect(semana.map((d) => d.total)).toEqual([2, 0, 3, 0, 0, 0, 0]);
    expect(semana[6].dia).toBe("2026-11-16");
  });

  it("filtra por cor e por dia", () => {
    const itens = [
      agenda({ id: "1", situacao: "atrasada", data_agenda: "2026-11-01" }),
      agenda({ id: "2", situacao: "hoje", data_agenda: "2026-11-10" }),
      agenda({ id: "3", situacao: "futura", data_agenda: "2026-11-12" }),
    ];
    expect(filtrarAgendas(itens, "todas").map((i) => i.id)).toEqual(["1", "2", "3"]);
    expect(filtrarAgendas(itens, "atrasada").map((i) => i.id)).toEqual(["1"]);
    expect(filtrarAgendas(itens, "dia:2026-11-12").map((i) => i.id)).toEqual(["3"]);
  });

  it("termo de busca não quebra o filtro .or() do PostgREST", () => {
    expect(termoDeBusca("Café (Jurerê), 7001")).toBe("Café Jurerê 7001");
    expect(termoDeBusca("100%_*")).toBe("100");
  });
});
