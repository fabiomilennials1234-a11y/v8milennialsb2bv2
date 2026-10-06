/**
 * A frota que o master enxerga na Área Dev (as 5 centrais): mais orgs,
 * chamados em todas as etapas, implantações, incidentes e avaliações.
 *
 * Só entra com `--master`. Nomes e números são inventados e coerentes entre
 * si (o chamado da Lapa é o mesmo que aparece na ficha da Lapa) — é o que o
 * QA visual precisa para ver cada estado das telas.
 */
import { id } from "./seed.mjs";

const H = 3600_000;
const D = 24 * H;

const FLEET = [
  // [n, nome, slug, plano, status, criada há (d)]
  [11, "Café Jurerê", "cafe-jurere", "torque-v8", "active", 400],
  [12, "Lapidação Bueno", "lapidacao-bueno", "pro", "active", 180],
  [13, "Loofting", "loofting", "starter", "trial", 12],
  [14, "Riofix Energia", "riofix", "enterprise", "active", 25],
  [15, "Bolívar Pet", "bolivar-pet", null, "trial", 3],
  [16, "Itatex Têxtil", "itatex", "pro", "overdue", 260],
  [17, "SacoEco Multi", "sacoeco", "starter", "active", 40],
];

export function extendMasterFleet(fx) {
  const NOW = fx.NOW;
  const ago = (ms) => new Date(NOW - ms).toISOString();
  const orgId = (n) => id("org", n);
  const nome = new Map([[fx.orgId, fx.org.name]]);

  for (const [n, name, slug, plan, status, dias] of FLEET) {
    nome.set(orgId(n), name);
    fx.db.organizations.push({
      ...fx.org,
      id: orgId(n),
      name,
      slug,
      subscription_plan: plan,
      subscription_status: status,
      billing_override: n === 16,
      billing_override_reason: n === 16 ? "Negociação de renovação até 15/10" : null,
      created_at: ago(dias * D),
      updated_at: ago(2 * D),
    });
  }

  // ─── Operação: um chamado em cada etapa, alguns com diagnóstico ───
  const tk = (n) => id("misc", 7000 + n);
  const t = (n, org, title, status, extra = {}) => ({
    id: tk(n),
    organization_id: org,
    author_user_id: fx.authUser.id,
    title,
    description: "Relato do cliente com os passos para reproduzir.",
    tipo: "bug",
    impacto: "contorno",
    severidade: null,
    status,
    reopen_count: 0,
    assigned_master_user_id: null,
    awaiting_customer_ms: 0,
    awaiting_since: null,
    first_response_at: null,
    resolved_at: null,
    closed_at: null,
    defect_url: null,
    support_context: { route: "/funis", app_version: "2026.10.04" },
    created_at: ago(n * 5 * H),
    updated_at: ago(n * 2 * H),
    ...extra,
  });
  const meu = fx.db.master_users[0]?.id ?? null;
  fx.db.support_tickets = [
    t(1, orgId(14), "Webhook do WhatsApp parou de receber mensagens às 11h", "aberto", { impacto: "parado", severidade: "critica" }),
    t(2, orgId(11), "Card some do funil depois de mover para Vendido", "aberto", { severidade: "alta" }),
    t(3, orgId(12), "Copilot responde fora do horário configurado", "aberto", { severidade: "media" }),
    t(4, orgId(13), "Importação de planilha trava em 80%", "aberto", { severidade: "media", impacto: "parado" }),
    t(5, orgId(11), "Disparo agendado não saiu na segunda", "em_andamento", { severidade: "alta", assigned_master_user_id: meu, first_response_at: ago(20 * H) }),
    t(6, orgId(17), "Relatório de comissão soma vendas canceladas", "em_andamento", { severidade: "media", assigned_master_user_id: id("misc", 2), first_response_at: ago(30 * H) }),
    t(7, orgId(16), "Anexo do chat não abre no celular", "resolvido", { severidade: "baixa", resolved_at: ago(2 * D), first_response_at: ago(3 * D) }),
    t(8, orgId(12), "Lead duplicado ao receber mensagem de grupo", "aguardando_cliente", { severidade: "media", awaiting_since: ago(1 * D), first_response_at: ago(2 * D) }),
    t(9, orgId(14), "Etapa de ganho não conta receita no painel", "resolvido", { severidade: "alta", reopen_count: 3, resolved_at: ago(8 * H), first_response_at: ago(4 * D) }),
    t(10, orgId(11), "Notificação duplicada de nova mensagem", "fechado", { severidade: "baixa", resolved_at: ago(9 * D), closed_at: ago(2 * D) }),
    t(11, orgId(17), "Botão de exportar some no modo escuro", "fechado", { severidade: "baixa", resolved_at: ago(10 * D), closed_at: ago(3 * D) }),
  ];
  const diag = (n, extra) => ({
    ticket_id: tk(n),
    kind: "fix",
    complexity: "media",
    summary: "Causa raiz localizada; correção pequena e verificável.",
    root_cause: "O trigger de etapa olha o SET de stage_key, e o front só escreve stage_id.",
    customer_reply: null,
    recommended_model: "opus",
    recommended_effort: "medium",
    resolution_prompt: "Plano: 1) reproduzir 2) corrigir 3) provar com os keystones. ".repeat(2),
    keystones: [{ label: "Card permanece no funil", verify: "select count(*) from pipeline_entries where …" }],
    estimated_cost_usd: 1.8,
    template_version: 2,
    source: "claude_code",
    diagnosed_by: fx.authUser.id,
    executed_at: null,
    execution_outcome: null,
    actual_cost_usd: null,
    created_at: ago(n * 3 * H),
    updated_at: ago(n * 3 * H),
    ...extra,
  });
  fx.db.support_ticket_diagnoses = [
    diag(2, { customer_reply: "Encontramos a causa: o card voltava por causa de uma regra de etapa. Já corrigimos." }),
    diag(3, { kind: "configuracao", complexity: "baixa", estimated_cost_usd: 0.4 }),
    diag(5, { customer_reply: "O disparo ficou preso na janela de horário. Liberamos e ele saiu hoje às 9h.", estimated_cost_usd: 2.2 }),
    diag(6, { complexity: "alta", estimated_cost_usd: 4.5 }),
    diag(7, { customer_reply: "Corrigido.", executed_at: ago(2 * D), execution_outcome: "resolvido", actual_cost_usd: 1.1 }),
    diag(9, { complexity: "critica", customer_reply: "Corrigido.", executed_at: ago(9 * H), execution_outcome: "parcial", actual_cost_usd: 6.3, estimated_cost_usd: 3.9 }),
  ];
  fx.db.support_ticket_comments = fx.db.support_ticket_comments ?? [];

  // ─── Monitoramento ───
  const alert = (n, org, severity, category, title, message, h) => ({
    id: id("misc", 7200 + n),
    organization_id: org,
    severity,
    category,
    source_type: category.includes("whatsapp") ? "whatsapp" : "workflow",
    source_id: null,
    title,
    message,
    metadata: {},
    resolved_at: null,
    resolved_by: null,
    created_at: ago(h * H),
  });
  fx.db.system_alerts = [
    alert(1, orgId(11), "error", "dead_letter_pattern", "Automação em dead-letter: enviar_whatsapp", "12 jobs falharam com 'instance not connected'", 2),
    alert(2, orgId(17), "warning", "workflow_stuck", "Workflow parado há 3 horas", "Follow-up pós-venda sem execução desde 11:20", 5),
    alert(3, null, "critical", "whatsapp_provider", "Uazapi devolvendo 429 em lote", "Circuit breaker aberto por 2 min", 1),
  ];
  const chk = (n, org, status, h) => ({
    id: id("misc", 7300 + n),
    organization_id: org,
    instance_id: id("inst", 1),
    status,
    notes: status === "probe_failed" ? "sonda sem resposta em 30 s" : "drift de mensagens acima de 40%",
    action_taken: null,
    drift_ratio: 0.42,
    checked_at: ago(h * H),
  });
  fx.db.whatsapp_health_checks = [
    ...[11, 12, 14, 17].flatMap((n, i) => [chk(i * 3, orgId(n), "probe_failed", 1 + i), chk(i * 3 + 1, orgId(n), "probe_failed", 2 + i)]),
    ...Array.from({ length: 14 }, (_, i) => chk(40 + i, orgId(14), "critical", 0.2 + i * 0.3)),
  ];
  fx.db.runtime_logs = Array.from({ length: 6 }, (_, i) => ({
    id: id("misc", 7400 + i),
    organization_id: i < 4 ? orgId(13) : null,
    module: i < 4 ? "import-leads" : "agent-message",
    action: i < 4 ? "parse_sheet" : "send_reply",
    status: "error",
    error_message: i < 4 ? `Linha ${100 + i}: telefone inválido` : "timeout ao chamar o modelo após 30000 ms",
    entity_type: null,
    entity_id: null,
    actor_type: "system",
    created_at: ago((i + 1) * H),
  }));

  // ─── RPCs das centrais ───
  const impl = [
    [15, "cliente_novo", null, 3, { has_plan: false }],
    [13, "construcao", meu, 9, { has_plan: true, whatsapp_connected: true, pipelines_total: 2, pipelines_won_lost: 1 }],
    [14, "call", meu, 4, { has_plan: true, whatsapp_connected: true, pipelines_total: 1, pipelines_won_lost: 1 }],
    [17, "concluido", meu, 6, { has_plan: true, whatsapp_connected: true, pipelines_total: 1, pipelines_won_lost: 1, first_sale: true }],
  ];
  const checklist = (k) => ({
    whatsapp: k > 0, lead: k > 1, copilot: k > 2, automacao: k > 3, membro: k > 4, venda: k > 5,
  });
  // Estado mutável da implantação: as RPCs de escrita mexem aqui, a listagem lê.
  const ORDEM = ["cliente_novo", "construcao", "call", "concluido"];
  const estado = new Map(impl.map(([n, stage, owner, dias]) => [orgId(n), { stage, owner, entered: ago(dias * D) }]));

  fx.rpcMaster = {
    // Espelho dos gates de 20271105000100 — só o suficiente para o preview.
    master_advance_implementation: (a) => {
      const st = estado.get(a.p_org_id);
      const g = impl.find(([n]) => orgId(n) === a.p_org_id)?.[4] ?? {};
      const to = a.p_to_stage;
      const err = (message) => ({ __status: 400, body: { code: "23514", message, details: null, hint: null } });
      if (ORDEM.indexOf(to) > ORDEM.indexOf(st.stage) + 1) return err("avance uma etapa por vez");
      if (to === "construcao" && (!g.has_plan || !st.owner)) return err("sai de Cliente novo so com plano e responsavel");
      if (to === "call" && (!g.whatsapp_connected || !g.pipelines_total || g.pipelines_won_lost < g.pipelines_total))
        return err("Call de Apresentacao so com WhatsApp conectado e funis com etapa de ganho e de perda");
      if (to === "concluido" && !g.first_sale) return err("Concluido so com a 1a venda registrada");
      st.stage = to;
      st.entered = new Date(NOW).toISOString();
      return {};
    },
    master_update_implementation: (a) => {
      const st = estado.get(a.p_org_id);
      st.owner = a.p_owner_master_user_id;
      return {};
    },
    master_ticket_send_reply: (a) => {
      const ticket = fx.db.support_tickets.find((x) => x.id === a.p_ticket_id);
      const d = fx.db.support_ticket_diagnoses.find((x) => x.ticket_id === a.p_ticket_id);
      fx.db.support_ticket_comments.push({
        id: id("misc", 7600 + fx.db.support_ticket_comments.length),
        ticket_id: ticket.id,
        author_user_id: fx.authUser.id,
        body: d.customer_reply,
        is_internal: false,
        from_staff: true,
        created_at: new Date(NOW).toISOString(),
      });
      ticket.status = "resolvido";
      ticket.resolved_at = new Date(NOW).toISOString();
      return ticket;
    },
    master_list_implementations: () =>
      impl.map(([n, , , , gates], i) => ({
        organization_id: orgId(n),
        org_name: nome.get(orgId(n)),
        org_created_at: fx.db.organizations.find((o) => o.id === orgId(n)).created_at,
        subscription_plan: fx.db.organizations.find((o) => o.id === orgId(n)).subscription_plan,
        stage: estado.get(orgId(n)).stage,
        owner_master_user_id: estado.get(orgId(n)).owner,
        owner_name: estado.get(orgId(n)).owner ? "Equipe Torque" : null,
        call_scheduled_at: estado.get(orgId(n)).stage === "call" ? new Date(NOW + 2 * D).toISOString() : null,
        call_participants: estado.get(orgId(n)).stage === "call" ? "Diretor comercial e 2 SDRs" : null,
        stage_entered_at: estado.get(orgId(n)).entered,
        completed_at: estado.get(orgId(n)).stage === "concluido" ? estado.get(orgId(n)).entered : null,
        gates: {
          has_plan: false, whatsapp_connected: false, pipelines_total: 0, pipelines_won_lost: 0, first_sale: false,
          ...gates,
          checklist: checklist([1, 3, 5, 6][i]),
        },
      })),
    master_list_staff: () => [{ master_user_id: meu, name: "Equipe Torque" }, { master_user_id: id("misc", 2), name: "Suporte Plantão" }],
    master_org_health_signals: () =>
      fx.db.organizations.map((o, i) => ({
        organization_id: o.id,
        members_active: [9, 14, 6, 3, 8, 1, 5, 4][i] ?? 3,
        last_login_at: [ago(2 * H), ago(1 * D), ago(16 * D), ago(9 * D), ago(3 * H), null, ago(21 * D), ago(4 * D)][i] ?? ago(D),
        active_users_7d: [8, 11, 0, 2, 7, 0, 0, 3][i] ?? 1,
        events_7d: [1840, 2210, 12, 64, 950, 0, 3, 140][i] ?? 10,
        whatsapp_instances: [3, 4, 2, 1, 2, 0, 1, 1][i] ?? 1,
        whatsapp_connected: [3, 3, 0, 1, 2, 0, 0, 1][i] ?? 1,
        open_tickets: fx.db.support_tickets.filter((t2) => t2.organization_id === o.id && t2.status !== "fechado").length,
        reopen_alert_tickets: fx.db.support_tickets.filter((t2) => t2.organization_id === o.id && t2.reopen_count >= 3).length,
        quota_max_ratio: [0.6, 0.95, null, 0.5, 1, null, 0.4, 0.92][i] ?? null,
        quota_max_resource: ["max_users", "max_whatsapp_instances", null, "max_users", "max_copilot_agents", null, "max_users", "max_users"][i] ?? null,
      })),
    master_copilot_eval_summary: () =>
      [
        ["Bia", 11, 5.4, 6.3, 412],
        ["Luzia", 16, 6.1, 6.0, 230],
        ["Loo", 13, 7.2, 7.4, 96],
        ["Copilot Vendas", null, 8.4, 8.1, 1380],
        ["URA Café", 11, 8.9, 8.7, 610],
      ].map(([agent, n, avg, prev, evals], i) => ({
        agent_id: id("agent", 50 + i),
        agent_name: agent,
        organization_id: n ? orgId(n) : fx.orgId,
        org_name: n ? nome.get(orgId(n)) : fx.org.name,
        evaluations: evals,
        below_6: Math.round(evals * (avg < 6 ? 0.42 : avg < 7 ? 0.31 : avg < 8 ? 0.12 : 0.04)),
        avg_overall: avg,
        avg_relevance: Math.min(10, avg + 0.6),
        avg_tone: Math.min(10, avg + 1.1),
        avg_goal_align: Math.max(0, avg - 0.9),
        avg_conciseness: Math.max(0, avg - 0.3),
        previous_evaluations: Math.round(evals * 0.9),
        previous_avg_overall: prev,
        last_evaluated_at: ago((i + 1) * H),
      })),
  };

  fx.db.copilot_conversation_evaluations = [
    ...(fx.db.copilot_conversation_evaluations ?? []),
    ...[3.1, 3.8, 4.4, 4.9].map((s, i) => ({
      id: id("misc", 7500 + i),
      conversation_id: id("conv", 1),
      organization_id: orgId(11),
      agent_id: id("agent", 50),
      lead_id: null,
      turn_count: 3 + i,
      user_message: ["Qual o prazo de entrega para Florianópolis?", "Vocês fazem nota fiscal?", "Quero falar com uma pessoa", "Tem desconto à vista?"][i],
      agent_response: ["Nosso horário é das 8h às 18h.", "Pode me passar seu CNPJ?", "Claro! Posso te ajudar com mais alguma dúvida sobre o cardápio?", "Temos várias opções no cardápio."][i],
      score_overall: s,
      score_relevance: s,
      score_tone: s + 2,
      score_goal_align: s - 1,
      score_conciseness: s + 1,
      strengths: null,
      weaknesses: ["Não respondeu o prazo perguntado.", "Pediu dado sem explicar por quê.", "Ignorou o pedido de humano.", "Fugiu da pergunta sobre desconto."][i],
      suggestion: ["Responder o prazo ou dizer que vai consultar.", "Explicar que a NF sai com CNPJ.", "Transferir para atendente.", "Informar a política de desconto."][i],
      model_used: "google/gemini-2.0-flash-001",
      evaluated_at: ago((i + 2) * H),
    })),
  ];
}
