/**
 * Carrega um snapshot SÓ-LEITURA de prod no mock, no lugar da frota inventada
 * (`master-fleet.mjs`). As escritas continuam só na memória do mock: arrastar
 * um card aqui nunca chega a um cliente de verdade.
 *
 * O arquivo vem de fora do repo (tem dado pessoal): `UI_PREVIEW_PROD_SNAPSHOT=<json>`.
 */
import { readFileSync } from "node:fs";

export function loadProdSnapshot(fx, path) {
  const snap = JSON.parse(readFileSync(path, "utf8"));
  const nome = new Map(snap.organizations.map((o) => [o.id, o.name]));

  fx.db.organizations.push(...snap.organizations.map((o) => ({ ...fx.org, ...o })));
  for (const t of [
    "support_tickets",
    "support_ticket_diagnoses",
    "support_ticket_comments",
    "subscription_plans",
    "feature_flags",
    "organization_features",
    "system_alerts",
    "whatsapp_health_checks",
    "runtime_logs",
    "copilot_conversation_evaluations",
  ]) {
    fx.db[t] = snap[t] ?? [];
  }
  fx.db.team_members = [...fx.db.team_members, ...snap.team_members];

  // Implantação: o que a carga inicial da migration vai produzir; escrita só em memória.
  const estado = new Map(snap.implementations.map((i) => [i.id, { stage: i.first_sale ? "concluido" : "cliente_novo", owner: null, entered: i.created_at }]));
  const staff = snap.master_users.map((m) => ({ master_user_id: m.id, name: m.name }));
  const ORDEM = ["cliente_novo", "construcao", "call", "concluido"];
  const err = (message) => ({ __status: 400, body: { code: "23514", message, details: null, hint: null } });

  fx.rpcMaster = {
    master_list_implementations: () =>
      snap.implementations.map((i) => {
        const st = estado.get(i.id);
        return {
          organization_id: i.id,
          org_name: i.name,
          org_created_at: i.created_at,
          subscription_plan: i.subscription_plan,
          stage: st.stage,
          owner_master_user_id: st.owner,
          owner_name: staff.find((s) => s.master_user_id === st.owner)?.name ?? null,
          call_scheduled_at: null,
          call_participants: null,
          stage_entered_at: st.entered,
          completed_at: st.stage === "concluido" ? st.entered : null,
          gates: {
            has_plan: i.has_plan,
            whatsapp_connected: i.whatsapp_connected,
            pipelines_total: i.pipelines_total,
            pipelines_won_lost: i.pipelines_won_lost,
            first_sale: i.first_sale,
            checklist: i.checklist,
          },
        };
      }),
    master_list_staff: () => staff,
    master_update_implementation: (a) => {
      estado.get(a.p_org_id).owner = a.p_owner_master_user_id;
      return {};
    },
    master_advance_implementation: (a) => {
      const st = estado.get(a.p_org_id);
      const g = snap.implementations.find((i) => i.id === a.p_org_id);
      const to = a.p_to_stage;
      if (ORDEM.indexOf(to) > ORDEM.indexOf(st.stage) + 1) return err("avance uma etapa por vez");
      if (to === "construcao" && (!g.has_plan || !st.owner)) return err("sai de Cliente novo so com plano e responsavel");
      if (to === "call" && (!g.whatsapp_connected || !g.pipelines_total || g.pipelines_won_lost < g.pipelines_total))
        return err("Call de Apresentacao so com WhatsApp conectado e funis com etapa de ganho e de perda");
      if (to === "concluido" && !g.first_sale) return err("Concluido so com a 1a venda registrada");
      st.stage = to;
      st.entered = new Date().toISOString();
      return {};
    },
    master_org_health_signals: () => snap.health_signals,
    master_copilot_eval_summary: () => snap.eval_summary,
    // Nunca envia nada a ninguém: só muda a memória do mock.
    master_ticket_send_reply: (a) => {
      const ticket = fx.db.support_tickets.find((x) => x.id === a.p_ticket_id);
      ticket.status = "resolvido";
      ticket.resolved_at = new Date().toISOString();
      return ticket;
    },
  };
  return { orgs: nome.size };
}
