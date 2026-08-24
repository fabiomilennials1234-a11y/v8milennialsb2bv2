// @vitest-environment node
/**
 * createBlastPlan — a bifurcação do Canal Oficial (#1722).
 *
 * No Chip, criar o plano JÁ ENVIA o lote 0: despacha pelo `/sender/*` do
 * fornecedor e marca os destinatários como `sent` na mesma passada
 * (`blast-plan.ts:376-388`).
 *
 * No Canal Oficial isso seria desastroso. Não existe endpoint de lote — quem
 * envia é o nosso worker, um a um (ADR-0028 §2). Marcar `sent` na criação faria
 * as linhas nascerem enviadas sem ninguém ter enviado: o worker nunca as
 * reivindicaria, e o Disparo apareceria concluído com zero mensagens entregues.
 *
 * O que TEM de continuar acontecendo no regime oficial: o lote 0 é liberado
 * (`lots_released = 1`), porque é isso que o claim enxerga
 * (`lot_index < lots_released`), e os ledgers de orçamento são incrementados,
 * porque o Orçamento Diário conta PESSOAS PLANEJADAS PARA HOJE e isso não muda
 * com o regime.
 *
 * Mesmo estilo de injeção e store em memória de `blast-plan-single-number-cap`.
 */
import { describe, it, expect, vi } from "vitest";

const { createBlastPlan } = await import(
  "../../supabase/functions/_shared/quick-blast/blast-plan.ts"
);

const CHIP = { id: "num-chip", organization_id: "org-1", provider: "uazapi", daily_blast_cap: 80 } as any;
const OFICIAL = { id: "num-oficial", organization_id: "org-1", provider: "notificame", daily_blast_cap: 80 } as any;

const TEMPLATE = {
  name: "boas_vindas",
  language: "pt_BR",
  components: [],
  previewText: "Olá! Temos novidades.",
  buttonLabels: [],
};

const lead = (id: string) => ({ id, name: `L${id}`, company: "Co", phone: `1199900${id.padStart(4, "0")}` });
const leads = (n: number) => Array.from({ length: n }, (_, i) => lead(String(i)));

function planStore() {
  const state = { plans: new Map<string, any>(), recipients: [] as any[], seq: 0 };
  return {
    state,
    store: {
      async insertPlan(row: any) {
        const id = `plan-${++state.seq}`;
        state.plans.set(id, { id, ...row });
        return id;
      },
      async insertRecipients(rows: any[]) {
        for (const r of rows) state.recipients.push({ ...r });
      },
      async getPlan(planId: string) {
        return state.plans.get(planId) ?? null;
      },
      async updatePlan(planId: string, patch: any) {
        const p = state.plans.get(planId);
        if (p) state.plans.set(planId, { ...p, ...patch });
      },
      async getLotRecipients(planId: string, lotIndex: number) {
        return state.recipients.filter((r) => r.plan_id === planId && r.lot_index === lotIndex);
      },
      async markRecipients(planId: string, leadIds: string[], status: string, reason: string | null) {
        const set = new Set(leadIds);
        for (const r of state.recipients) {
          if (r.plan_id === planId && set.has(r.lead_id)) {
            r.status = status;
            r.reason = reason;
          }
        }
      },
      async moveRecipientsToLot(planId: string, leadIds: string[], lotIndex: number) {
        const set = new Set(leadIds);
        for (const r of state.recipients) {
          if (r.plan_id === planId && set.has(r.lead_id)) r.lot_index = lotIndex;
        }
      },
      async listActivePlansDue(today: string) {
        return [...state.plans.values()].filter((p) => p.status === "active" && p.next_release_date <= today);
      },
    },
  };
}

function orgUsageStub(initialUsed = 0) {
  const state = { used: initialUsed, increments: [] as number[] };
  return {
    state,
    source: {
      async getUsedToday() { return state.used; },
      async increment(_org: string, _date: string, count: number) {
        state.used += count;
        state.increments.push(count);
      },
    },
  };
}

const okDispatch = () => vi.fn(async () => ({ sender_job_id: "j", uazapi_sender_id: "u" }));

describe("createBlastPlan — regime OFICIAL", () => {
  it("não despacha pelo fornecedor e não marca ninguém como enviado", async () => {
    const dispatch = okDispatch();
    const { store, state } = planStore();
    const org = orgUsageStub(0);

    const out = await createBlastPlan(
      { store, usageSource: org.source, dispatch } as any,
      {
        orgId: "org-1",
        userId: "u",
        instance: OFICIAL,
        leads: leads(10),
        message: TEMPLATE.previewText,
        template: TEMPLATE,
        dailyBudget: 100,
      } as any,
    );

    expect(out.ok).toBe(true);
    // O fornecedor não tem endpoint de lote para este canal. Chamá-lo devolveria
    // `NotSupportedError` — e é o erro que o vendedor via na tela antes do #1722.
    expect(dispatch).not.toHaveBeenCalled();
    // Ninguém nasce enviado: quem envia é o worker, uma a uma.
    expect(state.recipients.filter((r) => r.status === "sent")).toHaveLength(0);
    expect(state.recipients.every((r) => r.status === "pending")).toBe(true);
  });

  it("libera o lote 0 mesmo sem despachar — é o que o claim enxerga", async () => {
    // `claim_blast_recipients` exige `lot_index < lots_released`. Com
    // `lots_released = 0` o worker não veria linha nenhuma, e a fila ficaria
    // parada para sempre parecendo vazia.
    const { store, state } = planStore();
    const org = orgUsageStub(0);

    const out = await createBlastPlan(
      { store, usageSource: org.source, dispatch: okDispatch() } as any,
      {
        orgId: "org-1", userId: "u", instance: OFICIAL, leads: leads(10),
        message: TEMPLATE.previewText, template: TEMPLATE, dailyBudget: 100,
      } as any,
    );

    const plano = state.plans.get((out as any).planId);
    expect(plano.lots_released).toBe(1);
    expect(state.recipients.filter((r) => r.lot_index === 0)).toHaveLength(10);
  });

  it("congela o Template no plano", async () => {
    const { store, state } = planStore();
    const out = await createBlastPlan(
      { store, usageSource: orgUsageStub(0).source, dispatch: okDispatch() } as any,
      {
        orgId: "org-1", userId: "u", instance: OFICIAL, leads: leads(3),
        message: TEMPLATE.previewText, template: TEMPLATE, dailyBudget: 100,
      } as any,
    );
    const plano = state.plans.get((out as any).planId);
    expect(plano.template).toMatchObject({ name: "boas_vindas", language: "pt_BR" });
    // `message` carrega o corpo renderizado: é o texto que a pessoa recebe, e
    // tem de sobreviver ao dia em que a Meta pausar o Template do lado dela.
    expect(plano.message).toBe(TEMPLATE.previewText);
  });

  it("o Orçamento Diário continua contando as pessoas planejadas para hoje", async () => {
    // O orçamento conta PESSOAS, não envios já feitos. Não incrementar aqui
    // faria um Disparo oficial de 200 pessoas não consumir nada do teto do dia,
    // e um Disparo de Chip logo depois estouraria o limite real da org.
    const org = orgUsageStub(0);
    const { store } = planStore();

    await createBlastPlan(
      { store, usageSource: org.source, dispatch: okDispatch() } as any,
      {
        orgId: "org-1", userId: "u", instance: OFICIAL, leads: leads(10),
        message: TEMPLATE.previewText, template: TEMPLATE, dailyBudget: 100,
      } as any,
    );

    expect(org.state.increments).toEqual([10]);
  });
});

describe("createBlastPlan — regime CHIP segue idêntico (critério 8)", () => {
  it("continua despachando pelo fornecedor e marcando enviado na criação", async () => {
    // CONTROLE do critério 8, e o que impede a bifurcação de vazar para o lado
    // que já funciona: o Chip é o caminho de produção de hoje.
    const dispatch = okDispatch();
    const { store, state } = planStore();
    const org = orgUsageStub(0);

    const out = await createBlastPlan(
      { store, usageSource: org.source, dispatch } as any,
      { orgId: "org-1", userId: "u", instance: CHIP, leads: leads(10), message: "Oi", dailyBudget: 100 } as any,
    );

    expect(out.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(state.recipients.filter((r) => r.status === "sent")).toHaveLength(10);
    expect(org.state.increments).toEqual([10]);
  });
});
