import { describe, expect, it } from "vitest";
import {
  contarPorSituacao,
  dataComSemana,
  diasDeDistancia,
  distanciaRelativa,
  filtrarAgendas,
  filtrosDaBuscaCliente,
  hojeNoFuso,
  paraClienteAgenda,
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

describe("filtrosDaBuscaCliente", () => {
  it("busca só por nome, empresa e código do ERP — nunca por telefone", () => {
    expect(filtrosDaBuscaCliente("1234")).toEqual([
      "name.ilike.%1234%",
      "company.ilike.%1234%",
      "erp_code.ilike.%1234%",
    ]);
  });

  it("número longo digitado também não vira busca por telefone", () => {
    expect(filtrosDaBuscaCliente("(48) 99999-1234").join(",")).not.toMatch(/phone/);
  });

  it("limpa o que quebraria o .or() do PostgREST", () => {
    expect(filtrosDaBuscaCliente("a,b(c)")[0]).toBe("name.ilike.%a b c%");
  });
});

describe("paraClienteAgenda", () => {
  const base = { id: "l1", name: "Razão", company: "Fantasia", phone: null, erp_code: " 1042 ", uf: "SC" };

  it("cidade, UF e representante vêm do cadastro do ERP; o UF do lead é só reserva", () => {
    const c = paraClienteAgenda({
      ...base,
      upsell_clients: [{ erp_city: "Jurerê", erp_uf: "RS", erp_owner_name: "Rep", updated_at: "2026-11-01T00:00:00Z" }],
    });
    expect(c).toMatchObject({ erp_code: "1042", cidade: "Jurerê", uf: "RS", representante: "Rep" });
    expect(paraClienteAgenda(base)).toMatchObject({ cidade: null, uf: "SC", representante: null });
  });

  it("aceita o embed como objeto único e usa o cadastro mais recente quando há mais de um", () => {
    expect(
      paraClienteAgenda({ ...base, upsell_clients: { erp_city: "A", erp_uf: null, erp_owner_name: null, updated_at: null } }).cidade,
    ).toBe("A");
    expect(
      paraClienteAgenda({
        ...base,
        upsell_clients: [
          { erp_city: "Velha", erp_uf: null, erp_owner_name: null, updated_at: "2026-01-01T00:00:00Z" },
          { erp_city: "Nova", erp_uf: null, erp_owner_name: null, updated_at: "2026-06-01T00:00:00Z" },
        ],
      }).cidade,
    ).toBe("Nova");
  });

  it("telefones: principal primeiro, sem repetir o do lead nem o mesmo número em outro formato", () => {
    const c = paraClienteAgenda({
      ...base,
      phone: "5548999991234",
      lead_phones: [
        { phone: "554833334444", is_primary: false, created_at: "2026-02-01T00:00:00Z" },
        { phone: "+55 48 99999-1234", is_primary: true, created_at: "2026-03-01T00:00:00Z" },
        { phone: "  ", is_primary: false, created_at: null },
      ],
    });
    expect(c.telefones).toEqual(["+55 48 99999-1234", "554833334444"]);
  });

  it("sem lead_phones, cai no telefone do próprio lead", () => {
    expect(paraClienteAgenda({ ...base, phone: "5548999991234", lead_phones: null }).telefones).toEqual(["5548999991234"]);
  });

  it("contatos: cada linha de lead_phones vira uma opção — principal, com nome (A–Z), sem nome", () => {
    const c = paraClienteAgenda({
      ...base,
      lead_phones: [
        { id: "p-sem", phone: "554833330000", label: "  ", is_primary: false, created_at: null },
        { id: "p-ze", phone: "5548977770000", label: "Zé - Expedição", is_primary: false, created_at: null },
        { id: "p-ana", phone: "5548988880000", label: "Ana - Financeiro", is_primary: false, created_at: null },
        { id: "p-princ", phone: "5548999990000", label: "Carlos - Compras", is_primary: true, created_at: null },
      ],
    });
    expect(c.contatos).toEqual([
      { id: "p-princ", nome: "Carlos - Compras", telefone: "5548999990000", principal: true },
      { id: "p-ana", nome: "Ana - Financeiro", telefone: "5548988880000", principal: false },
      { id: "p-ze", nome: "Zé - Expedição", telefone: "5548977770000", principal: false },
      { id: "p-sem", nome: null, telefone: "554833330000", principal: false },
    ]);
  });

  it("contatos: linha sem id ou sem número não vira opção; o telefone do lead sozinho também não", () => {
    const c = paraClienteAgenda({
      ...base,
      phone: "5548999991234",
      lead_phones: [
        { phone: "5548911110000", label: "Sem id", is_primary: false, created_at: null },
        { id: "p-vazio", phone: " ", label: "Vazio", is_primary: false, created_at: null },
      ],
    });
    // Sem `lead_phones.id` não há o que gravar em `lead_phone_id`.
    expect(c.contatos).toEqual([]);
  });
});
