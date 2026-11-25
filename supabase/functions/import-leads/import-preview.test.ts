import { assertEquals } from "jsr:@std/assert@^1.0.0";
import type { ExistingLead, ExistingLeads } from "./import-match.ts";
import {
  classifyRows,
  countByGroup,
  GROUP_ACTIONS,
  hideInvisible,
  matchedLeadIds,
  planRows,
  type PreviewInput,
} from "./import-preview.ts";

function existingLead(over: Partial<ExistingLead> & { id: string }): ExistingLead {
  return {
    phone: null,
    normalized_phone: null,
    phone_compartilhado: false,
    erp_code: null,
    name: null,
    company: null,
    email: null,
    faturamento: null,
    segment: null,
    notes: null,
    rating: 0,
    utm_campaign: null,
    utm_source: null,
    utm_medium: null,
    utm_content: null,
    utm_term: null,
    created_at: "2026-08-21T12:00:00Z",
    ...over,
  };
}

/** O CRM da Café Jurerê nos números que a planilha de 25/11 tocou. */
const CRM: ExistingLeads = {
  byPhone: new Map([
    ["54981448969", existingLead({ id: "erp-10088", erp_code: "10088", name: "DEITOS & ZANATTA CAFFE LTDA", company: "SANTO CAFFE" })],
    ["51981340007", existingLead({ id: "karmel", name: "Karmel Café", company: "Karmel Café" })],
    ["54996161459", existingLead({ id: "ruppenthal", name: "Pousada Ruppenthal", company: "Pousada Ruppenthal" })],
  ]),
  byEmail: new Map([["compras@pousada.com.br", existingLead({ id: "por-email", name: "Pousada Manu" })]]),
};

function row(r: number, name: string, phone?: string, extra: Partial<PreviewInput> = {}): PreviewInput {
  return { row: r, name, company: name, phone, ...extra };
}

Deno.test("classifyRows — os grupos da planilha do RS (25/11)", () => {
  const rows = classifyRows(
    [
      row(2, "Le Bari Café | Bistrô e Cafeteria", "5554999316404"),
      row(7, "Pimpinella Café e Bistrô"),
      row(9, "Empório Canela Restaurante", "555436991121"),
      row(15, "Santo Bistrô - Restaurante - Strudelhaus", "5554981448969"),
      row(16, "Café Colonial Bela Vista", "555432861608"),
      row(17, "Leña Torrefação", "555432861608"),
      row(22, "Cafeteria É de Chocolate", "5551981340007"),
      row(41, "Empório Canela Restaurante", "555436991121"),
      row(48, "Livraria Empório Canela", "555436991121"),
      row(60, "POUSADA RUPPENTHAL", "54996161459"),
      row(61, "Hotel sem número", undefined, { email: "Compras@Pousada.com.br" }),
      row(62, "Linha ruim", "123", { invalid: "Linha 62: telefone inválido (123)" }),
    ],
    CRM,
  );
  const byRow = new Map(rows.map((r) => [r.row, r]));

  assertEquals(byRow.get(2)?.group, "novo");
  assertEquals(byRow.get(7)?.group, "sem_telefone");
  assertEquals(byRow.get(9)?.group, "novo");
  // Cliente do ERP com outro nome na planilha: é cliente, não "outra empresa".
  assertEquals(byRow.get(15)?.group, "cliente_erp");
  assertEquals(byRow.get(15)?.match?.erp_code, "10088");
  // Mesmo fixo, outra empresa: aponta a primeira linha que trouxe o número.
  assertEquals(byRow.get(17)?.group, "outra_empresa");
  assertEquals(byRow.get(17)?.match, { origem: "arquivo", row: 16, label: "Café Colonial Bela Vista", visible: true });
  // Número de lead do CRM, nome diferente.
  assertEquals(byRow.get(22)?.group, "outra_empresa");
  assertEquals(byRow.get(22)?.match?.lead_id, "karmel");
  // Mesma empresa repetida × outra empresa com o mesmo número, ambas contra a linha 9.
  assertEquals(byRow.get(41)?.group, "repetido");
  assertEquals(byRow.get(48)?.group, "outra_empresa");
  assertEquals(byRow.get(48)?.match?.row, 9);
  // Mesmo nome (sem acento e caixa), número no formato do ERP.
  assertEquals(byRow.get(60)?.group, "ja_lead");
  assertEquals(byRow.get(61)?.group, "ja_lead");
  assertEquals(byRow.get(62)?.group, "invalido");
  assertEquals(byRow.get(62)?.reason, "Linha 62: telefone inválido (123)");

  assertEquals(countByGroup(rows), {
    novo: 3,
    cliente_erp: 1,
    ja_lead: 2,
    repetido: 1,
    outra_empresa: 3,
    sem_telefone: 1,
    invalido: 1,
  });
  assertEquals(matchedLeadIds(rows).sort(), ["erp-10088", "karmel", "por-email", "ruppenthal"]);
});

Deno.test("hideInvisible — quem não enxerga o lead vê só 'já cadastrado'", () => {
  const rows = classifyRows([row(15, "Santo Bistrô", "5554981448969"), row(22, "É de Chocolate", "5551981340007")], CRM);
  const out = hideInvisible(rows, new Set(["karmel"]));
  assertEquals(out[0].match, { origem: "crm", label: null, erp_code: null, visible: false });
  assertEquals(out[1].match?.label, "Karmel Café");
  assertEquals(out[1].match?.lead_id, "karmel");
});

Deno.test("planRows — sem decisão vale o padrão do grupo", () => {
  const rows = classifyRows([row(2, "Novo", "5554999316404"), row(15, "Santo", "5554981448969")], CRM);
  const plan = planRows(rows, undefined);
  assertEquals(plan.get(2), { group: "novo", action: "criar", mismatch: false, match: undefined });
  assertEquals(plan.get(15)?.action, "pular");
  assertEquals(GROUP_ACTIONS.cliente_erp[0], "pular");
});

Deno.test("planRows — decisão permitida passa; fora do grupo vira 'pular' com aviso", () => {
  const rows = classifyRows(
    [row(16, "Café Colonial Bela Vista", "555432861608"), row(17, "Leña Torrefação", "555432861608"), row(2, "Novo", "5554999316404")],
    CRM,
  );
  const plan = planRows(rows, [
    { row: 17, action: "criar_compartilhado" },
    // A linha 2 virou "novo"; "vincular" não existe para ela.
    { row: 2, action: "vincular" },
    { row: 16, action: "pular" },
  ]);
  assertEquals(plan.get(17)?.action, "criar_compartilhado");
  assertEquals(plan.get(17)?.mismatch, false);
  assertEquals(plan.get(2), { group: "novo", action: "pular", mismatch: true, match: undefined });
  assertEquals(plan.get(16)?.action, "pular");
});

Deno.test("planRows — corpo malformado não quebra nem vira escrita", () => {
  const rows = classifyRows([row(2, "Novo", "5554999316404")], CRM);
  for (const junk of [null, "x", 42, {}, [null], [{ row: "2", action: "criar" }], [{ row: 2, action: { a: 1 } }]]) {
    const p = planRows(rows, junk).get(2)!;
    // Ou o padrão (decisão ilegível = ausente), ou "pular" (decisão legível e inválida).
    assertEquals(p.action === "criar" || (p.action === "pular" && p.mismatch), true);
  }
  assertEquals(planRows(rows, [{ row: 2, action: "apagar" }]).get(2)?.action, "pular");
});
