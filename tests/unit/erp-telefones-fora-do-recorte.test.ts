// @vitest-environment node
/**
 * Telefones de cliente fora do recorte da Café Jurerê chegam ao CRM (flag
 * `erp_telefones_todos_clientes`) — e só os telefones, só de quem tem lead.
 */
import { describe, expect, it, vi } from "vitest";
import { telefonesDeClienteForaDoRecorte } from "../../supabase/functions/_shared/erp/sync/telefones-fora-do-recorte";
import { mergeByLead, planLeadPhoneOps } from "../../supabase/functions/_shared/erp/sync/lead-phones-sync";

const FONE = { phone: "48991817929", label: "Comprador", erpPhoneId: "t-1", isWhatsApp: true };
const cliente = (over: Record<string, unknown> = {}) =>
  ({ externalId: "1743", cnpj: "12345678000199", phones: [FONE], ...over }) as never;

function store(porId: Record<string, { lead_id: string } | null>, porCnpj: Record<string, { lead_id: string } | null> = {}) {
  return {
    findByExternalId: vi.fn(async (_o: string, id: string) => (porId[id] ?? null) as never),
    findByCnpj: vi.fn(async (_o: string, c: string) => (porCnpj[c] ?? null) as never),
  };
}

const base = (over: Partial<Parameters<typeof telefonesDeClienteForaDoRecorte>[0]> = {}) => ({
  ligado: true,
  dryRun: false,
  organizationId: "org",
  cliente: cliente(),
  store: store({ "1743": { lead_id: "lead-anderson" } }),
  vistos: new Set<string>(),
  ...over,
});

describe("telefones de cliente fora do recorte", () => {
  it("cliente com lead: os telefones do ERP vão para a reconciliação", async () => {
    expect(await telefonesDeClienteForaDoRecorte(base())).toEqual({ leadId: "lead-anderson", phones: [FONE] });
  });

  it("sem a flag: nada muda — fora do recorte continua sem telefone", async () => {
    expect(await telefonesDeClienteForaDoRecorte(base({ ligado: false }))).toBeNull();
  });

  it("modo prévia (dry_run) não enfileira escrita", async () => {
    expect(await telefonesDeClienteForaDoRecorte(base({ dryRun: true }))).toBeNull();
  });

  it("cliente sem lead no CRM: não cria nada (fora do recorte não vira lead)", async () => {
    expect(await telefonesDeClienteForaDoRecorte(base({ store: store({}) }))).toBeNull();
  });

  it("casa pelo CNPJ quando o código do ERP não está na carteira", async () => {
    const s = store({}, { "12345678000199": { lead_id: "lead-por-cnpj" } });
    expect(await telefonesDeClienteForaDoRecorte(base({ store: s }))).toEqual({ leadId: "lead-por-cnpj", phones: [FONE] });
  });

  it("cliente sem telefone no ERP: nem consulta", async () => {
    const s = store({ "1743": { lead_id: "x" } });
    expect(await telefonesDeClienteForaDoRecorte(base({ cliente: cliente({ phones: [] }), store: s }))).toBeNull();
    expect(s.findByExternalId).not.toHaveBeenCalled();
  });

  it("o mesmo cliente repetido na resposta do ERP entra uma vez só", async () => {
    const vistos = new Set<string>();
    expect(await telefonesDeClienteForaDoRecorte(base({ vistos }))).not.toBeNull();
    expect(await telefonesDeClienteForaDoRecorte(base({ vistos }))).toBeNull();
  });
});

describe("mergeByLead — um item por lead", () => {
  it("o mesmo lead duas vezes vira um item, e o número repetido sai como UM insert", () => {
    const itens = mergeByLead([
      { leadId: "L1", phones: [FONE] },
      { leadId: "L1", phones: [FONE, { ...FONE, phone: "4733765190", erpPhoneId: "t-2" }] },
      { leadId: "L2", phones: [] },
    ]);
    expect(itens).toHaveLength(1);
    const ops = planLeadPhoneOps("L1", [], itens[0].phones);
    expect(ops.filter((o) => o.op === "insert").map((o) => (o as { phone: string }).phone)).toEqual([
      "48991817929",
      "4733765190",
    ]);
  });
});
