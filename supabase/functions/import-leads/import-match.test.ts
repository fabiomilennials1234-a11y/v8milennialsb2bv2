import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type ExistingLead,
  erpClientReason,
  fieldsToFill,
  findExistingLeads,
  isErpClient,
  phoneKey,
} from "./import-match.ts";

const ORG = "org-cj";
type Row = Record<string, unknown>;

/**
 * Banco em memória que entende só o que `findExistingLeads` usa: select, eq, is(null)
 * e in. Guarda cada consulta para o teste conferir o tamanho dos lotes.
 */
function memoryDb(tables: Record<string, Row[]>, opts: { failOn?: string } = {}) {
  const queries: { table: string; inSize: number }[] = [];
  const db = {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let inSize = 0;
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => (filters.push((r) => r[col] === val), builder),
        is: (col: string, val: unknown) => (filters.push((r) => (r[col] ?? null) === val), builder),
        in: (col: string, vals: unknown[]) => {
          inSize = vals.length;
          filters.push((r) => vals.includes(r[col]));
          return builder;
        },
        then(resolve: (v: { data: Row[] | null; error: { message: string } | null }) => void) {
          queries.push({ table, inSize });
          if (opts.failOn === table) return resolve({ data: null, error: { message: "fora do ar" } });
          resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null });
        },
      };
      return builder;
    },
  };
  return { db: db as unknown as SupabaseClient, queries };
}

function lead(over: Partial<ExistingLead> & { id: string }): Row {
  return {
    organization_id: ORG,
    deleted_at: null,
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

Deno.test("phoneKey — formato do import e formato do ERP caem na mesma chave", () => {
  // Santo Bistrô (planilha, 55+DDD+número) × DEITOS & ZANATTA (ERP, sem 55): 25/11/2026.
  assertEquals(phoneKey("5554981448969"), "54981448969");
  assertEquals(phoneKey("54981448969"), "54981448969");
  // Fixo de 10 dígitos ganha o 9, como no banco (Sereníssima: 5436991164).
  assertEquals(phoneKey("555436991164"), "54936991164");
  assertEquals(phoneKey("5436991164"), "54936991164");
  assertEquals(phoneKey(undefined), null);
  assertEquals(phoneKey(""), null);
});

Deno.test("findExistingLeads — acha cliente do ERP gravado sem o 55", async () => {
  const { db } = memoryDb({
    leads: [lead({ id: "erp-10088", phone: "54981448969", normalized_phone: "54981448969", erp_code: "10088", company: "SANTO CAFFE" })],
  });
  const found = await findExistingLeads(db, ORG, ["5554981448969"], []);
  assertEquals(found.byPhone.get("54981448969")?.id, "erp-10088");
});

Deno.test("findExistingLeads — ignora lead apagado e de outra org", async () => {
  const { db } = memoryDb({
    leads: [
      lead({ id: "apagado", normalized_phone: "54932864551", deleted_at: "2026-09-01T00:00:00Z" }),
      lead({ id: "outra-org", normalized_phone: "54932864551", organization_id: "org-x" }),
    ],
  });
  const found = await findExistingLeads(db, ORG, ["555432864551"], []);
  assertEquals(found.byPhone.size, 0);
});

Deno.test("findExistingLeads — com número compartilhado, devolve o dono (não compartilhado, mais antigo)", async () => {
  const { db } = memoryDb({
    leads: [
      lead({ id: "compartilhado", normalized_phone: "51981340007", phone_compartilhado: true, created_at: "2026-01-01T00:00:00Z" }),
      lead({ id: "dono-novo", normalized_phone: "51981340007", created_at: "2026-11-25T12:00:00Z" }),
      lead({ id: "dono", normalized_phone: "51981340007", created_at: "2026-11-25T09:28:00Z" }),
    ],
  });
  const found = await findExistingLeads(db, ORG, ["5551981340007"], []);
  assertEquals(found.byPhone.get("51981340007")?.id, "dono");
});

Deno.test("findExistingLeads — número que é só telefone extra casa com o lead dele", async () => {
  const { db } = memoryDb({
    leads: [lead({ id: "erp-15724", normalized_phone: null, erp_code: "15724", company: "SERENISSIMA PANETTERIA" })],
    lead_phones: [{ lead_id: "erp-15724", organization_id: ORG, normalized_phone: "54936991164", deleted_at: null }],
  });
  const found = await findExistingLeads(db, ORG, ["555436991164"], []);
  assertEquals(found.byPhone.get("54936991164")?.id, "erp-15724");
});

Deno.test("findExistingLeads — telefone principal vence o extra de outro lead", async () => {
  const { db } = memoryDb({
    leads: [
      lead({ id: "principal", normalized_phone: "54936991164", created_at: "2026-10-01T00:00:00Z" }),
      lead({ id: "extra", created_at: "2026-01-01T00:00:00Z" }),
    ],
    lead_phones: [{ lead_id: "extra", organization_id: ORG, normalized_phone: "54936991164", deleted_at: null }],
  });
  const found = await findExistingLeads(db, ORG, ["5436991164"], []);
  assertEquals(found.byPhone.get("54936991164")?.id, "principal");
});

Deno.test("findExistingLeads — consulta em lotes de 150 números", async () => {
  const phones = Array.from({ length: 320 }, (_, i) => `55479${String(90000000 + i)}`);
  const { db, queries } = memoryDb({ leads: [] });
  await findExistingLeads(db, ORG, phones, []);
  const leadQueries = queries.filter((q) => q.table === "leads").map((q) => q.inSize);
  assertEquals(leadQueries, [150, 150, 20]);
});

Deno.test("findExistingLeads — email em minúsculas; valor sem @ não vira busca", async () => {
  const { db, queries } = memoryDb({ leads: [lead({ id: "por-email", email: "compras@hotel.com.br" })] });
  const found = await findExistingLeads(db, ORG, [], ["Compras@Hotel.com.br", "sem-arroba", null]);
  assertEquals(found.byEmail.get("compras@hotel.com.br")?.id, "por-email");
  assertEquals(queries.map((q) => q.inSize), [1]);
});

Deno.test("findExistingLeads — erro de leitura derruba antes de gravar", async () => {
  const { db } = memoryDb({ leads: [] }, { failOn: "leads" });
  await assertRejects(() => findExistingLeads(db, ORG, ["5554981448969"], []), Error, "telefone");
});

const ERP = {
  ...lead({ id: "erp", erp_code: "10088", name: "DEITOS & ZANATTA CAFFE LTDA", company: "SANTO CAFFE" }),
} as unknown as ExistingLead;

Deno.test("fieldsToFill — cliente do ERP não recebe nada", () => {
  assertEquals(isErpClient(ERP), true);
  assertEquals(fieldsToFill(ERP, { name: "Santo Bistrô - Restaurante - Strudelhaus", segment: "Cafeteria" }), {});
});

Deno.test("fieldsToFill — só completa vazio; nome mais longo não troca o atual", () => {
  const existing = lead({ id: "l", name: "Karmel Café", company: "Karmel Café", segment: "-", email: "sem email" }) as unknown as ExistingLead;
  assertEquals(
    fieldsToFill(existing, {
      name: "Cafeteria É de Chocolate",
      company: "Cafeteria É de Chocolate",
      segment: "Cafeteria",
      email: "contato@karmel.com.br",
      rating: 3,
      utm_source: "maps",
    }),
    { segment: "Cafeteria", email: "contato@karmel.com.br", rating: 3, utm_source: "maps" },
  );
});

Deno.test("fieldsToFill — valor vazio da planilha nunca apaga", () => {
  const existing = lead({ id: "l", name: "A", segment: null }) as unknown as ExistingLead;
  assertEquals(fieldsToFill(existing, { name: "", segment: "   " }), {});
});

Deno.test("erpClientReason — diz código e nome do cadastro do ERP", () => {
  const msg = erpClientReason(ERP);
  assertEquals(msg, "Já é cliente do ERP — cód 10088, SANTO CAFFE. O cadastro do ERP não é alterado pela planilha.");
});
