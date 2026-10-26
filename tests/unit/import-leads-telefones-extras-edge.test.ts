/**
 * Telefones extras na importação de planilha — o lado da edge `import-leads`.
 *
 * A edge roda com service_role e grava direto em `lead_phones`: as guardas daqui
 * (pular o que o lead já tem, engolir só a corrida do índice único, nunca
 * marcar principal) são a única coisa entre a planilha e a tabela.
 */
import { describe, it, expect, vi } from "vitest";
import {
  extraPhonesOf,
  saveExtraPhones,
  MAX_EXTRA_PHONES,
} from "../../supabase/functions/import-leads/import-phones";

const ORG = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";

function fakeClient(opts: { existing?: string[]; insertErrors?: Record<number, { code: string; message: string }> } = {}) {
  const inserts: Record<string, unknown>[] = [];
  let call = 0;
  const client = {
    from: vi.fn((table: string) => {
      expect(table).toBe("lead_phones");
      return {
        select: () => ({
          eq: () => ({
            is: async () => ({ data: (opts.existing ?? []).map((phone) => ({ phone })), error: null }),
          }),
        }),
        insert: async (row: Record<string, unknown>) => {
          inserts.push(row);
          return { error: opts.insertErrors?.[call++] ?? null };
        },
      };
    }),
  };
  return { client, inserts };
}

describe("extraPhonesOf", () => {
  it("🔑 célula crua com vírgula: o extra sai em formato de leads.phone (55 + número)", () => {
    expect(extraPhonesOf({ phone: "(48) 99999-1111, (48) 98888-2222" })).toEqual(["5548988882222"]);
  });

  it("navegador já separou: junta extra_phones, sem repetir nem incluir o principal", () => {
    const out = extraPhonesOf({
      phone: "48999991111",
      extra_phones: ["48988882222", "48999991111", "(48) 98888-2222", "lixo"],
    });
    expect(out).toEqual(["5548988882222"]);
  });

  it("sem principal válido não há extras (nada para pendurar)", () => {
    expect(extraPhonesOf({ phone: "", extra_phones: ["48988882222"] })).toEqual([]);
    expect(extraPhonesOf({ extra_phones: ["48988882222"] })).toEqual([]);
  });

  it("extra_phones malformado vindo do payload é ignorado, não derruba", () => {
    expect(extraPhonesOf({ phone: "48999991111", extra_phones: "48988882222" })).toEqual([]);
    expect(extraPhonesOf({ phone: "48999991111", extra_phones: [1, null, {}] })).toEqual([]);
  });

  it("teto por lead", () => {
    const many = Array.from({ length: 40 }, (_, i) => `4898${String(8000000 + i)}`);
    expect(extraPhonesOf({ phone: "48999991111", extra_phones: many }).length).toBeLessThanOrEqual(MAX_EXTRA_PHONES);
  });
});

describe("saveExtraPhones", () => {
  it("🔑 grava o extra como secundário do CRM: nunca principal, nunca com nome", async () => {
    const { client, inserts } = fakeClient({ existing: ["5548999991111"] });
    const r = await saveExtraPhones(client, ORG, LEAD, ["5548988882222"]);
    expect(r).toEqual({ added: 1, failed: 0 });
    expect(inserts).toEqual([
      { organization_id: ORG, lead_id: LEAD, phone: "5548988882222", is_primary: false, source: "crm" },
    ]);
  });

  it("pula o que o lead já tem, mesmo gravado sem o 55", async () => {
    const { client, inserts } = fakeClient({ existing: ["5548999991111", "(48) 98888-2222"] });
    const r = await saveExtraPhones(client, ORG, LEAD, ["5548988882222"]);
    expect(r).toEqual({ added: 0, failed: 0 });
    expect(inserts).toHaveLength(0);
  });

  it("reimportar a mesma planilha não duplica: corrida do índice único (23505) não é falha", async () => {
    const { client } = fakeClient({ insertErrors: { 0: { code: "23505", message: "lead_phones_lead_numero_uq" } } });
    const r = await saveExtraPhones(client, ORG, LEAD, ["5548988882222", "5548977773333"]);
    expect(r).toEqual({ added: 1, failed: 0 });
  });

  it("outro erro conta como falha e não impede os próximos números", async () => {
    const { client } = fakeClient({ insertErrors: { 0: { code: "42501", message: "permission denied" } } });
    const r = await saveExtraPhones(client, ORG, LEAD, ["5548988882222", "5548977773333"]);
    expect(r).toEqual({ added: 1, failed: 1 });
  });

  it("sem extras não toca no banco", async () => {
    const { client } = fakeClient();
    expect(await saveExtraPhones(client, ORG, LEAD, [])).toEqual({ added: 0, failed: 0 });
    expect(client.from).not.toHaveBeenCalled();
  });
});
