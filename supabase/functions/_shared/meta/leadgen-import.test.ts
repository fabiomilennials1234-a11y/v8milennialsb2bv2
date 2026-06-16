import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { applyFieldMappings, flattenFieldData, planLeadgenImport } from "./leadgen-import.ts";

Deno.test("applyFieldMappings — maps Meta standard fields to lead defaults when no config", () => {
  const fields = {
    full_name: "Maria Silva",
    phone_number: "+5511999",
    email: "maria@acme.com",
    company_name: "Acme",
  };
  assertEquals(applyFieldMappings(fields, null), {
    name: "Maria Silva",
    email: "maria@acme.com",
    phone: "+5511999",
    company: "Acme",
  });
});

Deno.test("applyFieldMappings — configured mapping routes a custom field onto a lead column", () => {
  const fields = {
    full_name: "Joao",
    "qual_o_faturamento_mensal_atualmente_da_sua_empresa?": "100k-500k",
  };
  const mapped = applyFieldMappings(fields, [
    { meta_field: "qual_o_faturamento_mensal_atualmente_da_sua_empresa?", lead_field: "faturamento" },
  ]);
  assertEquals(mapped.faturamento, "100k-500k");
  assertEquals(mapped.name, "Joao");
});

function lead(id: string, createdTime: string, fields: Record<string, string>) {
  return {
    id,
    created_time: createdTime,
    field_data: Object.entries(fields).map(([name, v]) => ({ name, values: [v] })),
  };
}

Deno.test("planLeadgenImport — skips already-seen leadgen ids, imports the rest", () => {
  const plan = planLeadgenImport({
    leads: [
      lead("lead_new", "2026-06-15T13:00:00+0000", { full_name: "Nova" }),
      lead("lead_seen", "2026-06-15T12:00:00+0000", { full_name: "Velha" }),
    ],
    seenLeadgenIds: new Set(["lead_seen"]),
    fieldMappings: null,
  });

  assertEquals(plan.toImport.map((l) => l.leadgenId), ["lead_new"]);
  assertEquals(plan.skipped, ["lead_seen"]);
  assertEquals(plan.toImport[0].fields.name, "Nova");
});

Deno.test("planLeadgenImport — cursor advances past the newest lead, even if skipped", () => {
  // Newest lead is one we've already seen — cursor must still move past it so
  // the next poll doesn't refetch the whole window.
  const plan = planLeadgenImport({
    leads: [
      lead("lead_seen_newest", "2026-06-15T14:00:00+0000", { full_name: "X" }),
      lead("lead_new_older", "2026-06-15T09:00:00+0000", { full_name: "Y" }),
    ],
    seenLeadgenIds: new Set(["lead_seen_newest"]),
    fieldMappings: null,
  });

  assertEquals(plan.newestCreatedTime, Math.floor(Date.parse("2026-06-15T14:00:00+0000") / 1000));
  assertEquals(plan.toImport.map((l) => l.leadgenId), ["lead_new_older"]);
});
