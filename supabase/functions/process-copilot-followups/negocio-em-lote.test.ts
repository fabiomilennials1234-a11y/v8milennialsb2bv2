/**
 * Follow-up do Copilot em lote — funil e etapa saem do NEGÓCIO, não do espelho.
 *
 * Fecha `inv:H4-03` (SCRUM-97 / ADR-0023 §10). Esta função roda em `pg_cron` a
 * cada 5 min, pega até 10 leads por regra e MANDA MENSAGEM. É o caminho de
 * escrita mais barulhento do Copilot: quem ele seleciona, recebe. Por isso o
 * defeito aqui não aparece como erro em log — aparece como cliente recebendo
 * "vi que você ainda não agendou" depois de já ter comprado.
 *
 * O que quebrava antes: `filter_pipes` e `filter_stages` liam o funil WhatsApp
 * pela coluna `leads.pipe_whatsapp`. Essa coluna é ESPELHO — quando o negócio
 * sai de Qualificação por MOVE, o gatilho resolve o slug por `NEW.pipeline_id`
 * e não a reescreve, então ela congela na última etapa de whatsapp ocupada. O
 * lead vira proposta, o espelho continua dizendo "agendado", e a regra de
 * follow-up de agendamento segue pescando ele para sempre.
 *
 * Depois do M1 há um segundo eixo: o lead pode ter N negócios no MESMO funil.
 * O achatamento N→1 é responsabilidade de `getPipeEntriesByLeads`
 * (`pickActiveEntry`, provado em `_shared/pipeline-adapter-leitores.test.ts` —
 * não repetido aqui). O que se prova AQUI é que o lote consome esse resultado
 * já achatado sem reimplementar desempate próprio, e que a decisão de filtrar
 * usa a etapa do negócio.
 *
 * Os dois casos mais fortes desta suíte são os que afirmam AUSÊNCIA:
 *  - a query de `leads` do handler não pede `pipe_whatsapp`;
 *  - o lote chama `getPipeEntriesByLeads` com o slug "whatsapp".
 * Enquanto essas duas valerem, ninguém volta a ler o espelho por acidente.
 */

import { assert, assertEquals, assertFalse } from "jsr:@std/assert@^1.0.0";
import {
  anexarNegocios,
  etapasDoLead,
  funisDoLead,
  passaFiltroDeEtapa,
  passaFiltroDeFunil,
} from "../_shared/copilot/followup-negocio.ts";

const entry = (lead_id: string, stage_key: string) => ({ lead_id, stage_key });

/** Lead como sai da query de `leads` — sem NENHUM campo de funil. */
const leadCru = (id: string) => ({ id, name: `lead ${id}`, phone: "5511999999999" });

// ---------------------------------------------------------------------------
// anexarNegocios — o lote vira o dado que o filtro lê
// ---------------------------------------------------------------------------

Deno.test("lote: a etapa de whatsapp colada no lead é a do NEGÓCIO", () => {
  const [lead] = anexarNegocios([leadCru("l1")], {
    whatsapp: [entry("l1", "respondeu")],
    confirmacao: [],
    propostas: [],
  });

  assertEquals(lead.pipe_whatsapp_entry, { status: "respondeu" });
});

Deno.test("lote: lead sem negócio no funil fica sem etapa, não com etapa vazia", () => {
  const [lead] = anexarNegocios([leadCru("l1")], {
    whatsapp: [entry("outro-lead", "respondeu")],
    confirmacao: [],
    propostas: [],
  });

  assertEquals(lead.pipe_whatsapp_entry, null);
  assertEquals(lead.pipe_confirmacao, []);
  assertEquals(lead.pipe_propostas, []);
});

Deno.test("lote: negócio de um lead NÃO vaza para outro lead do mesmo lote", () => {
  const leads = anexarNegocios([leadCru("l1"), leadCru("l2"), leadCru("l3")], {
    whatsapp: [entry("l1", "agendado"), entry("l3", "novo")],
    confirmacao: [entry("l2", "marcada")],
    propostas: [],
  });

  assertEquals(leads[0].pipe_whatsapp_entry?.status, "agendado");
  assertEquals(leads[0].pipe_confirmacao, []);
  assertEquals(leads[1].pipe_whatsapp_entry, null);
  assertEquals(leads[1].pipe_confirmacao, [{ status: "marcada" }]);
  assertEquals(leads[2].pipe_whatsapp_entry?.status, "novo");
});

Deno.test("lote: colar o negócio não apaga os campos do lead", () => {
  const [lead] = anexarNegocios([leadCru("l1")], {
    whatsapp: [entry("l1", "abordado")],
    confirmacao: [],
    propostas: [],
  });

  assertEquals(lead.phone, "5511999999999");
  assertEquals(lead.name, "lead l1");
});

Deno.test("lote: os três funis são lidos separadamente, sem se sobrescreverem", () => {
  const [lead] = anexarNegocios([leadCru("l1")], {
    whatsapp: [entry("l1", "agendado")],
    confirmacao: [entry("l1", "d3")],
    propostas: [entry("l1", "enviada")],
  });

  assertEquals(lead.pipe_whatsapp_entry?.status, "agendado");
  assertEquals(lead.pipe_confirmacao, [{ status: "d3" }]);
  assertEquals(lead.pipe_propostas, [{ status: "enviada" }]);
  assertEquals(funisDoLead(lead).sort(), ["confirmacao", "propostas", "whatsapp"]);
});

// ---------------------------------------------------------------------------
// filter_pipes — "está no funil whatsapp?" pergunta ao Negócio
// ---------------------------------------------------------------------------

Deno.test("filter_pipes: lead com negócio em whatsapp casa com ['whatsapp']", () => {
  const [lead] = anexarNegocios([leadCru("l1")], {
    whatsapp: [entry("l1", "novo")],
    confirmacao: [],
    propostas: [],
  });

  assert(passaFiltroDeFunil(lead, ["whatsapp"]));
});

Deno.test("filter_pipes: espelho legado `pipe_whatsapp` no lead NÃO faz o filtro casar", () => {
  // Simula o pior caso do espelho congelado: a coluna ainda diz "agendado",
  // mas o negócio de whatsapp foi encerrado/movido e não existe mais no funil.
  const [lead] = anexarNegocios([{ ...leadCru("l1"), pipe_whatsapp: "agendado" }], {
    whatsapp: [],
    confirmacao: [],
    propostas: [],
  });

  assertEquals(funisDoLead(lead), []);
  assertFalse(passaFiltroDeFunil(lead, ["whatsapp"]));
});

Deno.test("filter_pipes: lead fora de TODOS os funis filtrados é descartado", () => {
  const [lead] = anexarNegocios([leadCru("l1")], {
    whatsapp: [entry("l1", "novo")],
    confirmacao: [],
    propostas: [],
  });

  assertFalse(passaFiltroDeFunil(lead, ["propostas", "confirmacao"]));
});

Deno.test("filter_pipes: basta UM funil bater — não precisa bater todos", () => {
  const [lead] = anexarNegocios([leadCru("l1")], {
    whatsapp: [],
    confirmacao: [],
    propostas: [entry("l1", "enviada")],
  });

  assert(passaFiltroDeFunil(lead, ["whatsapp", "propostas"]));
});

Deno.test("filter_pipes: regra SEM filtro não exclui ninguém", () => {
  const [lead] = anexarNegocios([leadCru("l1")], {
    whatsapp: [],
    confirmacao: [],
    propostas: [],
  });

  assertEquals(funisDoLead(lead), []);
  assert(passaFiltroDeFunil(lead, []));
});

Deno.test("filter_pipes: upsell e campanha continuam vindo das tabelas próprias", () => {
  const [lead] = anexarNegocios(
    [
      {
        ...leadCru("l1"),
        upsell_clients: [{ tipo_cliente_tempo: "recorrente", gestao_stage: "ativo" }],
        campanha_leads: [{ stage_id: "s1", campanha_stages: { name: "Aquecimento" } }],
      },
    ],
    { whatsapp: [], confirmacao: [], propostas: [] },
  );

  assertEquals(funisDoLead(lead).sort(), ["campanha", "upsell_base", "upsell_gestao"]);
  assert(passaFiltroDeFunil(lead, ["upsell_base"]));
});

// ---------------------------------------------------------------------------
// filter_stages — a etapa comparada é a do Negócio, não a congelada
// ---------------------------------------------------------------------------

Deno.test("filter_stages: casa com a etapa ATUAL do negócio de whatsapp", () => {
  const [lead] = anexarNegocios([leadCru("l1")], {
    whatsapp: [entry("l1", "agendado")],
    confirmacao: [],
    propostas: [],
  });

  assert(passaFiltroDeEtapa(lead, ["agendado"]));
});

Deno.test("filter_stages: lead que ANDOU no funil deixa de casar com a etapa velha", () => {
  // O espelho congelou em "agendado"; o negócio já está em "respondeu".
  // A regra de follow-up de agendamento não pode mais pescar este lead.
  const [lead] = anexarNegocios([{ ...leadCru("l1"), pipe_whatsapp: "agendado" }], {
    whatsapp: [entry("l1", "respondeu")],
    confirmacao: [],
    propostas: [],
  });

  assertEquals(etapasDoLead(lead), ["respondeu"]);
  assertFalse(passaFiltroDeEtapa(lead, ["agendado"]));
  assert(passaFiltroDeEtapa(lead, ["respondeu"]));
});

Deno.test("filter_stages: soma as etapas de todos os funis do lead", () => {
  const [lead] = anexarNegocios([leadCru("l1")], {
    whatsapp: [entry("l1", "agendado")],
    confirmacao: [entry("l1", "d1")],
    propostas: [entry("l1", "enviada")],
  });

  assertEquals(etapasDoLead(lead), ["agendado", "d1", "enviada"]);
  assert(passaFiltroDeEtapa(lead, ["enviada"]));
});

Deno.test("filter_stages: lead sem nenhum negócio não tem etapa e é descartado", () => {
  const [lead] = anexarNegocios([{ ...leadCru("l1"), pipe_whatsapp: "novo" }], {
    whatsapp: [],
    confirmacao: [],
    propostas: [],
  });

  assertEquals(etapasDoLead(lead), []);
  assertFalse(passaFiltroDeEtapa(lead, ["novo"]));
});

Deno.test("filter_stages: filtro salvo em branco não casa com lead sem etapa", () => {
  // Regra gravada com string vazia é erro de UI, não "todo mundo".
  const [lead] = anexarNegocios([leadCru("l1")], {
    whatsapp: [],
    confirmacao: [],
    propostas: [],
  });

  assertFalse(passaFiltroDeEtapa(lead, [""]));
});

Deno.test("filter_stages: regra SEM filtro não exclui ninguém", () => {
  const [lead] = anexarNegocios([leadCru("l1")], {
    whatsapp: [],
    confirmacao: [],
    propostas: [],
  });

  assert(passaFiltroDeEtapa(lead, []));
});

// ---------------------------------------------------------------------------
// AUSÊNCIA — o handler não pede o espelho e pede o Negócio
// ---------------------------------------------------------------------------

const fonteDoHandler = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("handler: a query de `leads` NÃO seleciona a coluna espelho pipe_whatsapp", () => {
  const select = /\.from\("leads"\)\s*\n?\s*\.select\(`([\s\S]*?)`\)/.exec(fonteDoHandler);
  assert(select, "não achei o .from('leads').select(`...`) do handler — o teste precisa ser reancorado");

  const colunas = select[1];
  // Sanidade: peguei mesmo a lista de colunas certa.
  assert(colunas.includes("lead_tags"), "regex pegou o bloco errado");
  assertFalse(
    /\bpipe_whatsapp\b/.test(colunas),
    "a coluna espelho `pipe_whatsapp` voltou ao SELECT de leads — o filtro em lote volta a congelar",
  );
});

Deno.test("handler: o lote lê o funil whatsapp por getPipeEntriesByLeads", () => {
  const semComentarios = fonteDoHandler
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  for (const slug of ["whatsapp", "confirmacao", "propostas"]) {
    assert(
      new RegExp(`getPipeEntriesByLeads\\([^)]*"${slug}"\\)`).test(semComentarios),
      `o lote deixou de ler o funil "${slug}" pelo Negócio`,
    );
  }
});
