/**
 * Coherent fake tenant for ui-preview: org "Milennials", admin Gabriel Gipp,
 * 9 team members, 4 funnels, ~25 B2B industrial leads, deals/cards across
 * stages, WhatsApp conversations, Copilot agents, workflows, products and a
 * carteira of clients.
 *
 * Deterministic: a seeded PRNG and fixed ids, timestamps relative to "now"
 * (so "há 2 h" and "este mês" read the same on every run). All names,
 * companies, phones and CNPJs are invented.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// ───────────────────────── deterministic helpers ─────────────────────────
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KIND = {
  org: "0a000000",
  user: "0b000000",
  tm: "0c000000",
  pipe: "0d000000",
  stage: "0e000000",
  lead: "0f000000",
  deal: "10000000",
  entry: "11000000",
  tag: "12000000",
  inst: "13000000",
  conv: "14000000",
  msg: "15000000",
  agent: "16000000",
  wf: "17000000",
  prod: "18000000",
  client: "19000000",
  order: "1a000000",
  misc: "1f000000",
};
export const id = (kind, n) => `${KIND[kind]}-0000-4000-8000-${String(n).padStart(12, "0")}`;

/**
 * The fixture clock. Pinned by default so screenshots are identical run to
 * run (shoot.mjs pins the browser clock to the same instant). Mid-month on
 * purpose: "este mês" widgets have data. `UI_PREVIEW_NOW=now` uses real time.
 */
export const DEFAULT_NOW = "2026-09-17T14:30:00-03:00";
export function fixtureNow() {
  const v = process.env.UI_PREVIEW_NOW ?? DEFAULT_NOW;
  return v === "now" ? Date.now() : new Date(v).getTime();
}

export function buildFixtures({ master = false, now = fixtureNow() } = {}) {
  const rnd = mulberry32(20261001);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const NOW = now;
  const ago = (ms) => new Date(NOW - ms).toISOString();
  const H = 3600_000;
  const D = 24 * H;
  const ahead = (ms) => new Date(NOW + ms).toISOString();

  const ORG_ID = id("org", 1);
  const USER_ID = id("user", 1);
  const SALES_PIPE = id("pipe", 1);

  const org = {
    id: ORG_ID,
    name: "Milennials",
    slug: "milennials",
    org_type: "crm",
    timezone: "America/Sao_Paulo",
    onboarding_state: "completed",
    onboarding_completed_at: ago(220 * D),
    onboarding_answers: {},
    subscription_status: "active",
    subscription_plan: "enterprise",
    subscription_expires_at: ahead(200 * D),
    default_pipeline_id: SALES_PIPE,
    created_at: ago(400 * D),
    updated_at: ago(2 * D),
    feature_flags: {},
    composable_metrics_enabled: true,
    metrics_studio_enabled: true,
    carteira_emits_revenue_enabled: true,
    auto_create_lead_on_inbound: true,
    whatsapp_migration_status: "completed",
    whatsapp_migration_completed_at: ago(120 * D),
    copilot_engine_version: "v1",
    send_governor_mode: "enforce",
    daily_blast_budget: 1500,
    quick_blast_max_leads: 200,
    voice_sessions_cap: 5,
    confirmacao_overdue_days: 2,
  };

  // ───────────── people ─────────────
  const people = [
    ["Gabriel Gipp", "admin", "CEO & Head Comercial", "gabriel@milennials.com.br", "sales"],
    ["Camila Rocha", "admin", "Gerente Comercial", "camila@milennials.com.br", "sales"],
    ["Rafael Martins", "member", "Closer", "rafael@milennials.com.br", "sales"],
    ["Juliana Costa", "member", "Closer", "juliana@milennials.com.br", "sales"],
    ["Ana Beatriz Souza", "member", "SDR", "ana@milennials.com.br", "meetings"],
    ["Lucas Ferreira", "member", "SDR", "lucas@milennials.com.br", "meetings"],
    ["Pedro Henrique Alves", "member", "BDR", "pedro@milennials.com.br", "meetings"],
    ["Mariana Oliveira", "member", "Customer Success", "mariana@milennials.com.br", "sales"],
    ["Thiago Nunes", "member", "SDR", "thiago@milennials.com.br", "meetings"],
  ];
  const team_members = people.map(([name, role, job, email, metric], i) => ({
    id: id("tm", i + 1),
    user_id: id("user", i + 1),
    organization_id: ORG_ID,
    name,
    email,
    role,
    job_title: job,
    metric_type: metric,
    is_active: true,
    phone: `+55 11 9${String(8100 + i * 37).padStart(4, "0")}-${String(1200 + i * 211).slice(0, 4)}`,
    avatar_url: null,
    ote_base: 6000 + i * 500,
    ote_bonus: 3000,
    commission_mrr_percent: 5,
    commission_projeto_percent: 8,
    created_at: ago((380 - i * 20) * D),
    updated_at: ago(10 * D),
  }));
  const tm = (i) => team_members[i].id;
  const closers = [tm(2), tm(3), tm(1)];
  const sdrs = [tm(4), tm(5), tm(6), tm(8)];

  const profiles = team_members.map((m) => ({
    id: m.user_id,
    full_name: m.name,
    avatar_url: null,
    created_at: m.created_at,
    updated_at: m.updated_at,
  }));
  const user_roles = team_members.map((m, i) => ({ id: id("misc", 100 + i), user_id: m.user_id, role: m.role, created_at: m.created_at }));

  const master_users = master
    ? [{ id: id("misc", 1), user_id: USER_ID, permissions: { all: true }, is_active: true, granted_at: ago(300 * D), notes: "ui-preview", created_at: ago(300 * D) }]
    : [];

  // ───────────── plans ─────────────
  const subscription_plans = [
    { id: id("misc", 201), name: "starter", display_name: "Starter", position: 1, is_active: true, is_default: false, price_monthly: 297, features: {}, limits: {} },
    { id: id("misc", 202), name: "pro", display_name: "Pro", position: 2, is_active: true, is_default: true, price_monthly: 697, features: {}, limits: {} },
    { id: id("misc", 203), name: "enterprise", display_name: "Enterprise", position: 3, is_active: true, is_default: false, price_monthly: 1497, features: {}, limits: {} },
  ];

  // ───────────── funnels ─────────────
  const funnelDefs = [
    {
      id: SALES_PIPE,
      name: "Funil de Vendas",
      slug: "vendas",
      color: "#F5C400",
      icon: "target",
      type: "sales",
      stages: [
        ["Novo", "novo", "open", "#64748B"],
        ["Em conversa", "em_conversa", "open", "#3B82F6"],
        ["Reunião marcada", "reuniao_marcada", "meeting_booked", "#8B5CF6"],
        ["Reunião realizada", "reuniao_realizada", "meeting_held", "#06B6D4"],
        ["Proposta enviada", "proposta_enviada", "open", "#F59E0B"],
        ["Ganhou", "ganhou", "won", "#22C55E"],
        ["Perdeu", "perdeu", "lost", "#EF4444"],
      ],
    },
    {
      id: id("pipe", 2),
      name: "Prospecção Outbound",
      slug: "prospeccao",
      color: "#3B82F6",
      icon: "radar",
      type: "custom",
      stages: [
        ["Lista fria", "lista_fria", "open", "#64748B"],
        ["Primeiro contato", "primeiro_contato", "open", "#3B82F6"],
        ["Respondeu", "respondeu", "open", "#06B6D4"],
        ["Qualificado", "qualificado", "meeting_booked", "#8B5CF6"],
        ["Descartado", "descartado", "lost", "#EF4444"],
      ],
    },
    {
      id: id("pipe", 3),
      name: "Recompra & Upsell",
      slug: "recompra",
      color: "#22C55E",
      icon: "repeat",
      type: "custom",
      stages: [
        ["Ciclo vencendo", "ciclo_vencendo", "open", "#F59E0B"],
        ["Contato feito", "contato_feito", "open", "#3B82F6"],
        ["Pedido em negociação", "pedido_negociacao", "open", "#8B5CF6"],
        ["Pedido fechado", "pedido_fechado", "won", "#22C55E"],
        ["Sem recompra", "sem_recompra", "lost", "#EF4444"],
      ],
    },
    {
      id: id("pipe", 4),
      name: "Indicações",
      slug: "indicacoes",
      color: "#EC4899",
      icon: "users",
      type: "custom",
      stages: [
        ["Indicado", "indicado", "open", "#64748B"],
        ["Apresentação", "apresentacao", "meeting_booked", "#8B5CF6"],
        ["Negociação", "negociacao", "open", "#F59E0B"],
        ["Fechado", "fechado", "won", "#22C55E"],
        ["Perdido", "perdido", "lost", "#EF4444"],
      ],
    },
  ];
  const pipelines = funnelDefs.map((f, i) => ({
    id: f.id,
    organization_id: ORG_ID,
    name: f.name,
    slug: f.slug,
    color: f.color,
    icon: f.icon,
    type: f.type,
    description: null,
    display_order: i,
    is_active: true,
    config: {},
    stage_dispatch_enabled: false,
    created_by: tm(0),
    created_at: ago((300 - i * 30) * D),
    updated_at: ago(3 * D),
  }));
  let stageN = 0;
  const pipeline_stages = [];
  for (const f of funnelDefs) {
    f.stages.forEach(([name, key, role, color], pos) => {
      stageN++;
      pipeline_stages.push({
        id: id("stage", stageN),
        organization_id: ORG_ID,
        pipeline_id: f.id,
        pipeline_type: f.slug,
        name,
        stage_key: key,
        stage_role: role,
        color,
        position: pos,
        is_active: true,
        is_final_positive: role === "won",
        is_final_negative: role === "lost",
        requires_sale_value: role === "won",
        default_probability: role === "won" ? 100 : role === "lost" ? 0 : Math.min(90, 10 + pos * 18),
        created_at: ago(300 * D),
        updated_at: ago(30 * D),
      });
    });
  }
  const stagesOf = (pipeId) => pipeline_stages.filter((s) => s.pipeline_id === pipeId);

  // ───────────── leads ─────────────
  const companies = [
    ["Metalúrgica Vale do Aço", "Roberto Siqueira", "MG", "Metalurgia"],
    ["Plásticos Paranaense Ind.", "Fernanda Kowalski", "PR", "Plásticos"],
    ["Têxtil Itajaí Malhas", "Carlos Hoffmann", "SC", "Têxtil"],
    ["Distribuidora Nordeste Alimentos", "Joana Batista", "PE", "Distribuição"],
    ["Fundição Gaúcha de Precisão", "Marcelo Becker", "RS", "Fundição"],
    ["Embalagens Serra Azul", "Patrícia Lemos", "SP", "Embalagens"],
    ["Química Fina Campinas", "Eduardo Prado", "SP", "Química"],
    ["Autopeças Joinvillense", "Sandra Schmitt", "SC", "Autopeças"],
    ["Usinagem Precisa ABC", "André Tavares", "SP", "Usinagem"],
    ["Moinho Rio Grande Farinhas", "Luciana Pereira", "RS", "Alimentos"],
    ["Cerâmica Vale do Tijucas", "Rodrigo Werner", "SC", "Cerâmica"],
    ["Madeireira Norte Mato Grosso", "Ivone Carvalho", "MT", "Madeira"],
    ["Eletrocabos Sorocaba", "Henrique Dias", "SP", "Elétrica"],
    ["Tintas Horizonte Industrial", "Cláudia Ramos", "MG", "Tintas"],
    ["Agroindustrial Cerrado Verde", "Paulo Menezes", "GO", "Agro"],
    ["Ferragens Atlântico Distribuidora", "Bianca Moura", "BA", "Distribuição"],
    ["Borrachas Vulcan Sul", "Gustavo Lenz", "RS", "Borracha"],
    ["Vidros Temperados Paulista", "Renata Fontes", "SP", "Vidros"],
    ["Laticínios Serra da Canastra", "José Augusto Faria", "MG", "Alimentos"],
    ["Papelão Ondulado Contagem", "Daniela Couto", "MG", "Embalagens"],
    ["Hidráulica Recôncavo", "Fábio Nascimento", "BA", "Hidráulica"],
    ["Móveis Planejados Bento", "Simone Zanella", "RS", "Moveleiro"],
    ["Aços Especiais Guarulhos", "Ricardo Okamoto", "SP", "Siderurgia"],
    ["Cosméticos Industriais Goiânia", "Aline Barbosa", "GO", "Cosméticos"],
    ["Rações Oeste Catarinense", "Volmir Dalla Costa", "SC", "Agro"],
    ["Termoplásticos Manaus", "Kátia Albuquerque", "AM", "Plásticos"],
    ["Distribuidora Paulista de EPI", "Márcio Teixeira", "SP", "Distribuição"],
  ];
  const origins = ["meta_ads", "whatsapp", "indicacao", "site", "outbound", "evento", "google_ads"];
  const tiers = ["diamante", "ouro", "ouro", "prata", "prata", "bronze"];
  const faturamentos = ["R$ 1–5 mi/ano", "R$ 5–20 mi/ano", "R$ 20–50 mi/ano", "R$ 50–100 mi/ano", "Acima de R$ 100 mi/ano"];
  const leads = companies.map(([company, contact, uf, segment], i) => {
    const ddd = { MG: "31", PR: "41", SC: "47", PE: "81", RS: "51", SP: "11", MT: "65", GO: "62", BA: "71", AM: "92" }[uf] ?? "11";
    const digits = `55${ddd}9${int(8100, 9989)}${int(1000, 9999)}`;
    // a few leads arrive "today" so this-month counters are not all zero
    const created = i >= companies.length - 3 ? ago((int(1, 5) + rnd()) * H) : ago((int(1, 60) + rnd()) * D);
    return {
      id: id("lead", i + 1),
      organization_id: ORG_ID,
      name: contact,
      company,
      email: `${contact.split(" ")[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}@${company.split(" ")[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}.ind.br`,
      phone: `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`,
      phone_digits: digits,
      // normalizePhone(): national number, no country code ("11987654321")
      normalized_phone: digits.slice(2),
      uf,
      segment,
      origin: origins[i % origins.length],
      faturamento: pick(faturamentos),
      rating: int(2, 5),
      qualification_score: int(35, 96),
      qualification_tier: tiers[i % tiers.length],
      classificacao: "B2B",
      classificacao_manual: false,
      sdr_id: sdrs[i % sdrs.length],
      closer_id: closers[i % closers.length],
      responsible_id: i % 3 === 0 ? sdrs[i % sdrs.length] : closers[i % closers.length],
      pre_sale_responsible_id: sdrs[i % sdrs.length],
      sale_responsible_id: closers[i % closers.length],
      responsible_user_id: null,
      interest: pick(["CRM + automação WhatsApp", "Carteira e recompra", "Copilot de qualificação", "Disparos em massa", "Integração ERP"]),
      notes: null,
      excluded_from_metrics: false,
      is_shadow: false,
      deleted_at: null,
      ai_disabled: false,
      created_at: created,
      updated_at: ago(int(1, 48) * H),
      utm_source: i % 2 ? "facebook" : "google",
      utm_campaign: i % 2 ? "industria-b2b-q3" : "crm-fabricas",
    };
  });

  // ───────────── tags ─────────────
  const tagDefs = [
    ["Ouro", "#F5C400"],
    ["Diamante", "#38BDF8"],
    ["Indústria", "#64748B"],
    ["Distribuidor", "#A855F7"],
    ["Decisor", "#22C55E"],
    ["Urgente", "#EF4444"],
    ["Evento Fenatran", "#F97316"],
  ];
  const tags = tagDefs.map(([name, color], i) => ({ id: id("tag", i + 1), organization_id: ORG_ID, name, color, created_at: ago(200 * D) }));
  const lead_tags = [];
  leads.forEach((l, i) => {
    const n = 1 + (i % 3);
    for (let k = 0; k < n; k++) lead_tags.push({ id: id("misc", 1000 + i * 5 + k), lead_id: l.id, tag_id: tags[(i + k * 2) % tags.length].id, created_at: l.created_at });
  });

  // ───────────── deals + pipeline entries ─────────────
  const deals = [];
  const pipeline_entries = [];
  const salesStages = stagesOf(SALES_PIPE);
  // distribution for the sales funnel: index into salesStages
  const salesDist = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5, 5, 6, 1, 0, 2, 4, 3, 5, 1, 0];
  let entryN = 0;
  const pos = (st) => st.position;
  leads.forEach((l, i) => {
    const st = salesStages[salesDist[i % salesDist.length]];
    const value = int(18, 240) * 1000;
    const dealId = id("deal", i + 1);
    const outcome = st.stage_role === "won" ? "won" : st.stage_role === "lost" ? "lost" : "open";
    deals.push({
      id: dealId,
      organization_id: ORG_ID,
      title: `${l.company} — ${l.interest}`,
      value,
      currency: "BRL",
      probability: st.default_probability,
      outcome,
      won: outcome === "won" ? true : outcome === "lost" ? false : null,
      outcome_at: outcome === "open" ? null : ago(int(1, 20) * D),
      closed_at: outcome === "open" ? null : ago(int(1, 20) * D),
      owner_id: l.closer_id,
      source: l.origin,
      source_lead_id: l.id,
      expected_close_date: ahead(int(5, 45) * D).slice(0, 10),
      last_activity_at: ago(int(1, 72) * H),
      loss_reason: outcome === "lost" ? "Preço acima do orçamento" : null,
      metadata: {},
      created_by: l.sdr_id,
      created_at: l.created_at,
      updated_at: ago(int(1, 72) * H),
      deleted_at: null,
    });
    entryN++;
    pipeline_entries.push({
      id: id("entry", entryN),
      organization_id: ORG_ID,
      pipeline_id: SALES_PIPE,
      stage_id: st.id,
      stage_key: st.stage_key,
      lead_id: l.id,
      deal_id: dealId,
      assigned_to: l.responsible_id,
      entered_at: l.created_at,
      stage_changed_at: ago(int(2, 200) * H),
      closed_at: outcome === "open" ? null : ago(int(1, 20) * D),
      notes: null,
      metadata: {
        value,
        sale_value: value,
        deal_outcome: outcome,
        product_type: i % 3 === 0 ? "projeto" : "mrr",
        meeting_date:
          st.stage_role === "meeting_booked" ? ahead(int(3, 120) * H) : st.stage_role === "meeting_held" || pos(st) > 3 ? ago(int(24, 240) * H) : null,
        is_confirmed: st.stage_role === "meeting_held" || pos(st) > 3,
        metrics_period_at: l.created_at,
        sdr_id: l.sdr_id,
        closer_id: l.closer_id,
        pre_sale_responsible_id: l.pre_sale_responsible_id,
        sale_responsible_id: l.sale_responsible_id,
      },
      created_at: l.created_at,
      updated_at: ago(int(1, 48) * H),
    });
  });
  // other funnels: a handful of cards each
  for (const p of funnelDefs.slice(1)) {
    const st = stagesOf(p.id);
    leads.slice(0, 14).forEach((l, i) => {
      if ((i + p.slug.length) % 2) return;
      entryN++;
      const s = st[i % (st.length - 1)];
      pipeline_entries.push({
        id: id("entry", entryN),
        organization_id: ORG_ID,
        pipeline_id: p.id,
        stage_id: s.id,
        stage_key: s.stage_key,
        lead_id: l.id,
        deal_id: null,
        assigned_to: l.responsible_id,
        entered_at: ago(int(1, 30) * D),
        stage_changed_at: ago(int(2, 300) * H),
        closed_at: null,
        notes: null,
        metadata: {},
        created_at: ago(int(1, 30) * D),
        updated_at: ago(int(1, 48) * H),
      });
    });
  }

  // ───────────── whatsapp ─────────────
  const whatsapp_instances = [
    {
      id: id("inst", 1),
      organization_id: ORG_ID,
      instance_name: "Comercial Milennials",
      instance_id: "ui-preview-inst-1",
      phone_number: "5511940028922",
      provider: "uazapi",
      provider_config: {},
      status: "connected",
      last_connection_at: ago(2 * H),
      owner_team_member_id: tm(0),
      daily_blast_cap: 500,
      inbound_subscription_status: "registered",
      inbound_subscription_attempts: 1,
      inbound_subscription_next_attempt_at: ago(30 * D),
      voice_calls_enabled: false,
      metadata: { profile_name: "Milennials Comercial" },
      created_at: ago(200 * D),
      updated_at: ago(2 * H),
    },
    {
      id: id("inst", 2),
      organization_id: ORG_ID,
      instance_name: "SDR — Ana",
      instance_id: "ui-preview-inst-2",
      phone_number: "5511940028933",
      provider: "uazapi",
      provider_config: {},
      status: "connected",
      last_connection_at: ago(5 * H),
      owner_team_member_id: tm(4),
      daily_blast_cap: 300,
      inbound_subscription_status: "registered",
      inbound_subscription_attempts: 1,
      inbound_subscription_next_attempt_at: ago(30 * D),
      voice_calls_enabled: false,
      metadata: {},
      created_at: ago(150 * D),
      updated_at: ago(5 * H),
    },
  ];

  const scripts = [
    [
      ["in", "Boa tarde! Vi o anúncio de vocês sobre CRM para indústria. Como funciona a integração com o nosso ERP?"],
      ["out", "Boa tarde, Roberto! Aqui é a Ana, da Milennials. Integramos com Tiny, Omie e via API — os pedidos entram direto na carteira do cliente."],
      ["in", "Interessante. Hoje temos 14 representantes e tudo é planilha."],
      ["out", "Esse é exatamente o cenário que mais atendemos. Posso te mostrar em 30 min como ficaria o funil de vocês? Tenho quinta às 10h ou 15h."],
      ["in", "Quinta 15h fica ótimo."],
      ["out", "Fechado! Enviei o convite para o seu e-mail. Até quinta 👊"],
    ],
    [
      ["in", "Olá, recebemos a proposta. O valor por usuário tem desconto acima de 20 licenças?"],
      ["out", "Olá, Fernanda! Tem sim — a partir de 20 usuários entra a faixa de volume com 15% de desconto."],
      ["in", "Perfeito, vou levar para a diretoria amanhã."],
    ],
    [
      ["out", "Carlos, tudo bem? Passando para saber se conseguiu avaliar o cronograma de implantação."],
      ["in", "Tudo certo! Só preciso validar com o TI a parte do WhatsApp oficial."],
      ["out", "Claro. Se ajudar, nosso time técnico participa da call com o TI de vocês."],
      ["in", "Ajuda sim, pode ser sexta?"],
    ],
    [
      ["in", "Bom dia, gostaria de um orçamento para 8 usuários."],
      ["out", "Bom dia, Joana! Já te envio. Vocês trabalham com distribuição para quais estados?"],
      ["in", "Nordeste inteiro, foco em PE, PB e RN."],
    ],
    [
      ["out", "Marcelo, a reunião de hoje está confirmada para 14h?"],
      ["in", "Confirmada. Vou levar nosso gerente industrial também."],
    ],
    [
      ["in", "Vocês atendem fábrica com venda por representante?"],
      ["out", "Atendemos! A carteira separa representante, cliente e ciclo de recompra."],
    ],
    [
      ["in", "Pedido 4471 saiu hoje? Precisamos para segunda."],
      ["out", "Saiu sim, Eduardo! Previsão de entrega sexta à tarde."],
      ["in", "Show, obrigado!"],
    ],
    [
      ["out", "Sandra, preparamos a simulação do ROI com base no volume que você passou. Posso enviar?"],
      ["in", "Pode mandar!"],
    ],
  ];
  const whatsapp_messages = [];
  const whatsapp_conversations = [];
  const conversations = [];
  const conversation_messages = [];
  let msgN = 0;
  scripts.forEach((script, ci) => {
    const lead = leads[ci];
    const inst = whatsapp_instances[ci % 3 === 2 ? 1 : 0];
    const phone = lead.phone_digits; // 55 + DDD + number
    const nphone = lead.normalized_phone;
    const base = NOW - (ci * 3 + 1) * H - script.length * 6 * 60_000;
    whatsapp_conversations.push({
      id: id("misc", 3000 + ci),
      organization_id: ORG_ID,
      instance_id: inst.id,
      phone_number: phone,
      normalized_phone: nphone,
      created_at: new Date(base - D).toISOString(),
      archived_at: null,
      deleted_at: null,
    });
    script.forEach(([dir, text], k) => {
      msgN++;
      const ts = new Date(base + k * 6 * 60_000).toISOString();
      whatsapp_messages.push({
        id: id("msg", msgN),
        organization_id: ORG_ID,
        instance_id: inst.id,
        lead_id: lead.id,
        message_id: `UIPREVIEW${String(msgN).padStart(8, "0")}`,
        remote_jid: `${phone}@s.whatsapp.net`,
        phone_number: phone,
        normalized_phone: nphone,
        direction: dir === "in" ? "incoming" : "outgoing",
        content: text,
        message_type: "text",
        status: dir === "in" ? "received" : k === script.length - 1 ? "delivered" : "read",
        is_group: false,
        edited: false,
        media_expired: false,
        reactions: {},
        received_via: "webhook",
        sent_source: dir === "in" ? null : ci < 3 && k % 2 ? "copilot" : "manual",
        sent_by_ai: dir !== "in" && ci < 3 && k % 2 === 1,
        sent_by_team_member_id: dir === "in" ? null : lead.sdr_id,
        push_name: dir === "in" ? lead.name : null,
        assigned_to: lead.responsible_id,
        timestamp: ts,
        created_at: ts,
      });
    });
    // Copilot conversation mirror for the first 5
    if (ci < 5) {
      const convId = id("conv", ci + 1);
      conversations.push({
        id: convId,
        organization_id: ORG_ID,
        agent_id: id("agent", (ci % 3) + 1),
        lead_id: lead.id,
        state: ci === 4 ? "WAITING_HUMAN" : "active",
        ai_state: ci === 4 ? "WAITING_HUMAN" : "AI_ACTIVE",
        assigned_to: lead.sdr_id,
        turn_count: script.length,
        last_message_at: new Date(base + (script.length - 1) * 6 * 60_000).toISOString(),
        context: {},
        created_at: new Date(base).toISOString(),
        updated_at: new Date(base + (script.length - 1) * 6 * 60_000).toISOString(),
      });
      script.forEach(([dir, text], k) => {
        conversation_messages.push({
          id: id("misc", 4000 + ci * 20 + k),
          conversation_id: convId,
          role: dir === "in" ? "user" : "assistant",
          content: text,
          metadata: {},
          created_at: new Date(base + k * 6 * 60_000).toISOString(),
        });
      });
    }
  });

  // ───────────── copilot ─────────────
  const agentDefs = [
    ["Qualificador Indústria", "qualificador", "Qualificar leads industriais por faturamento, volume e decisor", true, "consultivo", "profissional", "moderada"],
    ["SDR Outbound Fábricas", "sdr", "Agendar reunião com decisores de fábricas e distribuidoras", true, "direto", "amigavel", "alta"],
    ["Follow-up de Propostas", "followup", "Retomar propostas paradas há mais de 3 dias", true, "consultivo", "profissional", "moderada"],
    ["Agendador de Demonstrações", "agendador", "Confirmar e reagendar demonstrações", false, "direto", "amigavel", "baixa"],
  ];
  const copilot_agents = agentDefs.map(([name, type, objective, active, style, tone, energy], i) => ({
    id: id("agent", i + 1),
    organization_id: ORG_ID,
    name,
    template_type: type,
    main_objective: objective,
    is_active: active,
    is_default: i === 0,
    personality_style: style,
    personality_tone: tone,
    personality_energy: energy,
    llm_model: "gpt-4.1-mini",
    reasoning_mode: "standard",
    operation_mode: i === 1 ? "outbound" : "inbound",
    whatsapp_instance_id: whatsapp_instances[i % 2].id,
    business_context: { company_name: "Milennials", segment: "CRM para indústria B2B" },
    active_pipes: i === 1 ? [id("pipe", 2)] : [SALES_PIPE],
    active_stages: [],
    can_qualify_lead: true,
    can_schedule_meeting: i !== 2,
    can_move_cards: true,
    can_transfer_human: true,
    can_send_followup: true,
    max_conversation_turns: 30,
    skills: [],
    routing_origins: [],
    routing_segments: [],
    routing_stages: [],
    allowed_topics: [],
    forbidden_topics: [],
    anti_patterns: [],
    human_transfer_triggers: [],
    handoff_notify_phones: [],
    created_by: USER_ID,
    finalized_at: ago((88 - i * 15) * D),
    created_at: ago((90 - i * 15) * D),
    updated_at: ago(int(1, 9) * D),
  }));

  // ───────────── workflows ─────────────
  const wfDefs = [
    ["Boas-vindas para lead novo", "lead_created", true, "Envia mensagem de boas-vindas e atribui SDR por round robin"],
    ["Lembrete de reunião (24h e 1h)", "stage_changed", true, "Confirma a reunião por WhatsApp antes do horário"],
    ["Proposta parada há 3 dias", "cron", true, "Cria follow-up e avisa o closer quando a proposta esfria"],
    ["Tag Ouro → Copilot Qualificador", "tag_added", true, "Leads com tag Ouro entram no agente de qualificação"],
    ["Reativação de clientes inativos", "cron", false, "Dispara oferta de recompra para clientes sem pedido há 90 dias"],
  ];
  const workflows = wfDefs.map(([name, trigger, active, description], i) => ({
    id: id("wf", i + 1),
    organization_id: ORG_ID,
    name,
    description,
    trigger_type: trigger,
    trigger_config: trigger === "stage_changed" ? { pipeline_id: SALES_PIPE, stage_id: salesStages[2].id } : trigger === "tag_added" ? { tag_id: tags[0].id } : {},
    is_active: active,
    loop_limit: 3,
    re_enrollment_enabled: false,
    definition: {
      nodes: [
        { id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: { label: "Gatilho", trigger_type: trigger } },
        { id: "delay", type: "delay", position: { x: 0, y: 140 }, data: { label: "Aguardar 5 min", amount: 5, unit: "minutes" } },
        { id: "msg", type: "action", position: { x: 0, y: 280 }, data: { label: "Enviar WhatsApp", action_type: "send_whatsapp", message: "Olá {primeiro_nome}! Aqui é da Milennials 👋" } },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "delay" },
        { id: "e2", source: "delay", target: "msg" },
      ],
    },
    enrollment_criteria: {},
    created_by: tm(0),
    created_at: ago((120 - i * 10) * D),
    updated_at: ago(int(1, 20) * D),
  }));

  // ───────────── products ─────────────
  const prodDefs = [
    ["Torque CRM — Licença Pro", "mrr", 197, "LIC-PRO"],
    ["Torque CRM — Licença Enterprise", "mrr", 297, "LIC-ENT"],
    ["Implantação Assistida", "projeto", 4900, "IMP-01"],
    ["Copilot IA — Pacote 5 agentes", "mrr", 990, "COP-5"],
    ["Integração ERP (Omie/Tiny)", "projeto", 2900, "ERP-INT"],
    ["Treinamento de Equipe Comercial", "projeto", 3500, "TRN-01"],
  ];
  const products = prodDefs.map(([name, type, ticket, sku], i) => ({
    id: id("prod", i + 1),
    organization_id: ORG_ID,
    name,
    type,
    ticket,
    ticket_minimo: Math.round(ticket * 0.8),
    sku,
    is_active: true,
    has_variants: false,
    description: null,
    links: [],
    created_at: ago(200 * D),
    updated_at: ago(15 * D),
  }));

  // ───────────── carteira (upsell) ─────────────
  // won deals + a few accounts that already buy and are back in the funnel (upsell)
  const wonLeads = [16, 17, 24, 2, 6, 11, 20, 13, 9, 22].map((i) => leads[i]);
  const upsell_clients = wonLeads.map((l, i) => {
    const orders = int(3, 28);
    const avg = int(8, 90) * 1000;
    const daysSince = int(3, 120);
    return {
      id: id("client", i + 1),
      organization_id: ORG_ID,
      lead_id: l.id,
      name: l.name,
      company: l.company,
      cnpj: `${String(11 + i).padStart(2, "0")}.${String(222 + i * 7).slice(0, 3)}.333/0001-${String(10 + i).slice(0, 2)}`,
      email: l.email,
      phone: l.phone,
      // carteira segment buckets (get_portfolio_kpis.segment_counts)
      segment: daysSince > 90 ? "dormindo" : daysSince > 60 ? "resgate" : orders < 5 ? "novo" : avg > 50000 ? "ouro" : "prata",
      is_active: daysSince < 100,
      first_sale_at: ago(int(120, 700) * D),
      last_order_at: ago(daysSince * D),
      days_since_last_order: daysSince,
      order_count: orders,
      avg_ticket: avg,
      lifetime_value: orders * avg,
      reorder_cycle_days: int(25, 60),
      next_order_expected: ahead(int(-10, 30) * D),
      health_score: Math.max(5, 100 - daysSince),
      health_status: daysSince < 30 ? "saudavel" : daysSince < 70 ? "atencao" : "risco",
      health_updated_at: ago(D),
      trend: pick(["up", "stable", "down"]),
      churn_probability: Math.round(Math.min(95, (daysSince / 130) * 100)), // percent
      potencial: pick(["alto", "medio", "baixo"]),
      tipo_cliente_tempo: daysSince < 60 ? "recorrente" : "inativo",
      responsible_id: tm(7),
      closer_id: l.closer_id,
      sale_responsible_id: l.closer_id,
      pre_sale_responsible_id: l.sdr_id,
      gestao_manual_override: false,
      erp_uf: l.uf,
      erp_city: null,
      created_at: ago(300 * D),
      updated_at: ago(D),
    };
  });
  const upsell_orders = [];
  let orderN = 0;
  upsell_clients.forEach((c, i) => {
    for (let k = 0; k < 3; k++) {
      orderN++;
      const p = products[(i + k) % products.length];
      upsell_orders.push({
        id: id("order", orderN),
        organization_id: ORG_ID,
        client_id: c.id,
        product_id: p.id,
        product_name: p.name,
        product_type: p.type,
        sale_value: Math.round(p.ticket * int(1, 12)),
        sold_at: ago((k * 35 + int(1, 30)) * D),
        origin: pick(["upsell", "recompra", "cross_sell"]),
        approval_status: "approved",
        responsible_id: c.responsible_id,
        closer_id: c.closer_id,
        created_at: ago((k * 35 + 1) * D),
      });
    }
  });

  // ───────────── engagement ─────────────
  const followTitles = ["Retomar proposta", "Enviar estudo de caso", "Confirmar reunião", "Ligar para o decisor", "Enviar contrato revisado", "Checar retorno do TI"];
  const follow_ups = leads.slice(0, 14).map((l, i) => ({
    id: id("misc", 5000 + i),
    organization_id: ORG_ID,
    lead_id: l.id,
    deal_id: deals[i].id,
    title: followTitles[i % followTitles.length],
    description: `Contato com ${l.name} (${l.company})`,
    due_date: new Date(NOW + (i - 5) * 9 * H).toISOString(),
    priority: ["high", "medium", "low"][i % 3],
    assigned_to: l.responsible_id,
    completed_at: i % 5 === 4 ? ago(2 * H) : null,
    is_automated: i % 4 === 0,
    created_at: ago((i + 2) * D),
    updated_at: ago(H),
  }));
  const activityTypes = ["call", "meeting", "email", "whatsapp", "note", "task"];
  const activities = leads.slice(0, 18).map((l, i) => ({
    id: id("misc", 6000 + i),
    organization_id: ORG_ID,
    lead_id: l.id,
    deal_id: deals[i].id,
    type: activityTypes[i % activityTypes.length],
    subject: ["Ligação de descoberta", "Demonstração do produto", "Envio de proposta", "Mensagem de follow-up", "Anotação da reunião", "Revisar contrato"][i % 6],
    description: null,
    due_date: new Date(NOW + (i - 8) * 7 * H).toISOString(),
    completed_at: i % 3 === 0 ? ago(i * H) : null,
    owner_id: l.responsible_id,
    assigned_to: l.responsible_id,
    outcome: i % 3 === 0 ? "completed" : null,
    duration_sec: i % 6 === 0 ? 540 : null,
    source: "manual",
    metadata: {},
    created_at: ago((i + 1) * D),
    updated_at: ago(H),
  }));

  const nowDate = new Date(NOW);
  const month = nowDate.getMonth() + 1;
  const year = nowDate.getFullYear();
  const goals = [
    // organization-level (team_member_id null)
    ["Faturamento do mês", "faturamento", 900000, 612400],
    ["Novos clientes", "clientes", 12, 7],
    ["Reuniões marcadas", "reunioes_marcadas", 80, 52],
    ["Reuniões realizadas", "reunioes_realizadas", 60, 37],
    ["Conversão", "conversao", 25, 19],
  ].map(([name, type, target, current], i) => ({
    id: id("misc", 6900 + i),
    organization_id: ORG_ID,
    team_member_id: null,
    name,
    type,
    target_value: target,
    current_value: current,
    month,
    year,
    created_at: ago(20 * D),
    updated_at: ago(D),
  }));
  team_members.slice(1).forEach((m, i) => {
    const sales = m.metric_type === "sales";
    goals.push({
      id: id("misc", 7000 + i),
      organization_id: ORG_ID,
      team_member_id: m.id,
      name: sales ? "Meta de vendas" : "Meta de reuniões",
      type: sales ? "vendas" : "reunioes",
      target_value: sales ? 150000 : 24,
      current_value: sales ? int(40, 140) * 1000 : int(6, 22),
      month,
      year,
      created_at: ago(20 * D),
      updated_at: ago(D),
    });
  });
  const commissions = team_members.slice(1, 5).map((m, i) => ({
    id: id("misc", 7100 + i),
    organization_id: ORG_ID,
    team_member_id: m.id,
    amount: int(18, 64) * 100,
    rate_percent: 5,
    source: "venda",
    type: "mrr",
    month,
    year,
    paid: i % 2 === 0,
    created_at: ago(5 * D),
  }));

  // PostgREST computed column `relacao_negocios`: "lead" | "cliente" | "perdido"
  const clientLeadIds = new Set(upsell_clients.map((c) => c.lead_id));
  for (const l of leads) {
    const d = deals.find((x) => x.source_lead_id === l.id);
    l.relacao_negocios = clientLeadIds.has(l.id) || d?.outcome === "won" ? "cliente" : d?.outcome === "lost" ? "perdido" : "lead";
  }

  // ───────────── derived / views ─────────────
  const org_visible_members = team_members.map(({ phone, avatar_url, preferred_whatsapp_instance_id, ...m }) => ({ ...m }));
  const pipeById = Object.fromEntries(pipelines.map((p) => [p.id, p]));
  const stageById = Object.fromEntries(pipeline_stages.map((s) => [s.id, s]));
  const leadById = Object.fromEntries(leads.map((l) => [l.id, l]));
  const dealById = Object.fromEntries(deals.map((d) => [d.id, d]));
  const negocio_projetado = pipeline_entries.map((e) => {
    const st = stageById[e.stage_id];
    const p = pipeById[e.pipeline_id];
    const l = leadById[e.lead_id];
    const d = e.deal_id ? dealById[e.deal_id] : null;
    const meeting = st.stage_role === "meeting_booked" ? ahead(int(2, 120) * H) : st.stage_role === "meeting_held" ? ago(int(2, 96) * H) : null;
    return {
      id: e.id,
      organization_id: ORG_ID,
      deal_id: e.deal_id,
      lead_id: e.lead_id,
      pipeline_id: p.id,
      pipeline_name: p.name,
      pipeline_slug: p.slug,
      pipeline_type: p.type,
      pipeline_display_order: p.display_order,
      funil_sistema: p.slug === "vendas" ? "vendas" : null,
      stage_id: st.id,
      stage_key: st.stage_key,
      stage_name: st.name,
      stage_position: st.position,
      stage_role: st.stage_role,
      stage_is_final_positive: st.is_final_positive,
      stage_is_final_negative: st.is_final_negative,
      stage_changed_at: e.stage_changed_at,
      entered_at: e.entered_at,
      closed_at: e.closed_at,
      assigned_to: e.assigned_to,
      responsible_id: l.responsible_id,
      sdr_id: l.sdr_id,
      closer_id: l.closer_id,
      pre_sale_responsible_id: l.pre_sale_responsible_id,
      sale_responsible_id: l.sale_responsible_id,
      sale_value: d?.value ?? null,
      product_id: products[0].id,
      product_type: "mrr",
      contract_duration: 12,
      calor: int(10, 95),
      meeting_date: meeting,
      scheduled_date: meeting,
      commitment_date: meeting,
      is_confirmed: st.stage_role === "meeting_held",
      meet_link: meeting ? "https://meet.google.com/abc-defg-hij" : null,
      loss_reason: d?.loss_reason ?? null,
      notes: null,
      metadata: {},
      metrics_period_at: e.entered_at,
      created_at: e.created_at,
      updated_at: e.updated_at,
    };
  });
  const sale_events = deals
    .filter((d) => d.outcome === "won")
    .map((d, i) => ({
      id: id("misc", 8000 + i),
      organization_id: ORG_ID,
      lead_id: d.source_lead_id,
      deal_id: d.id,
      pipeline_id: SALES_PIPE,
      event_type: "sale",
      sale_value: d.value,
      currency: "BRL",
      sold_at: d.closed_at,
      source: "pipeline",
      producer: "stage_move",
      revenue_stream: "new",
      sale_responsible_id: d.owner_id,
      pre_sale_responsible_id: leadById[d.source_lead_id]?.sdr_id ?? null,
      stage_key: "ganhou",
      created_at: d.closed_at,
    }))
    .concat(
      upsell_orders.slice(0, 18).map((o, i) => ({
        id: id("misc", 8100 + i),
        organization_id: ORG_ID,
        lead_id: upsell_clients.find((c) => c.id === o.client_id).lead_id,
        deal_id: null,
        pipeline_id: null,
        event_type: "sale",
        sale_value: o.sale_value,
        currency: "BRL",
        sold_at: o.sold_at,
        source: "carteira",
        producer: "upsell_order",
        revenue_stream: "recompra",
        sale_responsible_id: o.closer_id,
        pre_sale_responsible_id: null,
        stage_key: null,
        created_at: o.sold_at,
      })),
    );
  const lead_origins = [
    ["Meta Ads", "meta_ads", "#3B82F6"],
    ["WhatsApp", "whatsapp", "#22C55E"],
    ["Indicação", "indicacao", "#EC4899"],
    ["Site", "site", "#8B5CF6"],
    ["Outbound", "outbound", "#F59E0B"],
    ["Evento", "evento", "#F97316"],
    ["Google Ads", "google_ads", "#EF4444"],
  ].map(([name, slug, color], i) => ({ id: id("misc", 8500 + i), organization_id: ORG_ID, name, slug, color, is_active: true, sort_order: i, created_at: ago(300 * D) }));
  const loss_reasons = ["Preço acima do orçamento", "Escolheu concorrente", "Sem prioridade agora", "Sem resposta", "Não é decisor"].map((name, i) => ({
    id: id("misc", 8600 + i),
    organization_id: ORG_ID,
    name,
    category: i < 2 ? "comercial" : "timing",
    display_order: i,
    is_system: false,
    created_at: ago(300 * D),
  }));
  const notifications = [
    ["Novo lead: Termoplásticos Manaus", "lead_created", leads[25]?.id, 25 * 60_000],
    ["Reunião em 1 hora com Fundição Gaúcha", "meeting_reminder", leads[4].id, 50 * 60_000],
    ["Proposta aceita — Plásticos Paranaense", "deal_won", leads[1].id, 3 * H],
    ["Joana Batista respondeu no WhatsApp", "whatsapp_reply", leads[3].id, 5 * H],
  ].map(([title, type, leadId, age], i) => ({
    id: id("misc", 8700 + i),
    organization_id: ORG_ID,
    user_id: USER_ID,
    title,
    type,
    lead_id: leadId,
    description: null,
    link: leadId ? `/leads?lead=${leadId}` : null,
    event_count: 1,
    last_event_at: ago(age),
    read_at: i > 1 ? ago(age - 60_000) : null,
    created_at: ago(age),
  }));
  const org_onboarding_progress = [
    {
      organization_id: ORG_ID,
      step_add_member: true,
      step_configure_copilot: true,
      step_connect_whatsapp: true,
      step_create_workflow: true,
      step_first_sale: true,
      step_import_lead: true,
      dismissed_at: ago(100 * D),
      created_at: ago(300 * D),
      updated_at: ago(100 * D),
    },
  ];
  const acoes_do_dia = follow_ups.slice(0, 6).map((f, i) => ({
    id: id("misc", 8800 + i),
    organization_id: ORG_ID,
    user_id: USER_ID,
    title: f.title,
    description: f.description,
    lead_id: f.lead_id,
    deal_id: f.deal_id,
    follow_up_id: f.id,
    position: i,
    is_completed: i === 5,
    completed_at: i === 5 ? ago(H) : null,
    created_at: ago(6 * H),
  }));

  // Legacy system funnels (propostas/confirmacao) are still read by goal
  // progress (useGoals) and some metrics: project a few closed rows for them.
  const legacyRows = [];
  team_members.slice(1).forEach((m, i) => {
    const sales = m.metric_type === "sales";
    const n = sales ? 3 : 4;
    for (let k = 0; k < n; k++) {
      const l = leads[(i * 3 + k) % leads.length];
      const monthStart = new Date(year, month - 1, 1).getTime();
      const when = new Date(monthStart + rnd() * (NOW - monthStart)).toISOString();
      legacyRows.push({
        id: id("misc", 9000 + legacyRows.length),
        organization_id: ORG_ID,
        lead_id: l.id,
        deal_id: null,
        pipeline_id: null,
        pipeline_name: sales ? "Propostas" : "Confirmação",
        pipeline_slug: sales ? "propostas" : "confirmacao",
        pipeline_type: "system",
        funil_sistema: sales ? "propostas" : "confirmacao",
        stage_key: sales ? "vendido" : "compareceu",
        stage_name: sales ? "Vendido" : "Compareceu",
        stage_role: sales ? "won" : "meeting_held",
        stage_is_final_positive: sales,
        stage_is_final_negative: false,
        responsible_id: m.id,
        sale_responsible_id: sales ? m.id : null,
        closer_id: sales ? m.id : l.closer_id,
        pre_sale_responsible_id: sales ? null : m.id,
        sdr_id: sales ? l.sdr_id : m.id,
        sale_value: sales ? int(18, 90) * 1000 : null,
        product_type: "mrr",
        meeting_date: when,
        is_confirmed: true,
        metrics_period_at: when,
        closed_at: when,
        entered_at: when,
        stage_changed_at: when,
        created_at: when,
        updated_at: when,
        metadata: {},
      });
    }
  });
  negocio_projetado.push(...legacyRows);

  // /metricas — the 4 template panels every org is seeded with in prod
  let templates = [];
  try {
    templates = JSON.parse(readFileSync(resolve(ROOT, "src/modules/analytics/lib/metrics-studio-templates.json"), "utf8"));
  } catch {
    /* templates moved: /metricas will show its empty state */
  }
  const metrics_studio_panels = templates.map((t, i) => ({
    id: id("misc", 9500 + i),
    organization_id: ORG_ID,
    team_member_id: null,
    nome: t.nome,
    ordem: t.ordem ?? i + 1,
    template_key: t.key,
    layout: t.layout ?? [],
    created_at: ago(90 * D),
    updated_at: ago(2 * D),
  }));

  // /performance — awards + an active competition
  const awards = [
    ["Clube dos 100k", "sales", 100000, "Jantar no Fasano + troféu", 1500],
    ["Máquina de reuniões", "meetings", 25, "Day off + voucher", 800],
    ["Primeira venda do mês", "sales", 1, "Kit Milennials", 300],
  ].map(([name, type, threshold, prize, value], i) => ({
    id: id("misc", 9600 + i),
    organization_id: ORG_ID,
    name,
    type,
    threshold,
    description: null,
    prize_description: prize,
    prize_value: value,
    month,
    year,
    is_active: true,
    created_at: ago(20 * D),
  }));
  const competitionId = id("misc", 9700);
  const competitions = [
    {
      id: competitionId,
      organization_id: ORG_ID,
      name: `Copa Torque — ${["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"][month - 1]}`,
      description: "Quem bater a maior % da meta leva.",
      criteria: "goal_percentage",
      metric_type: "sales",
      month,
      year,
      start_date: new Date(year, month - 1, 1).toISOString().slice(0, 10),
      end_date: new Date(year, month, 0).toISOString().slice(0, 10),
      status: "active",
      created_by: tm(0),
      created_at: ago(D),
      updated_at: ago(D),
    },
  ];
  const competition_participants = team_members.slice(1).map((m, i) => ({ id: id("misc", 9710 + i), competition_id: competitionId, team_member_id: m.id, created_at: ago(D) }));
  const competition_prizes = [
    [1, "Viagem para Gramado", "2 diárias com acompanhante", 4000, "🏆"],
    [2, "iPad", "iPad 10ª geração", 3500, "🥈"],
    [3, "Vale-experiência", "Voucher de R$ 800", 800, "🎁"],
  ].map(([position, prize_name, prize_description, prize_value, prize_icon], i) => ({
    id: id("misc", 9730 + i),
    competition_id: competitionId,
    position,
    prize_name,
    prize_description,
    prize_value,
    prize_icon,
    created_at: ago(D),
  }));

  const message_templates = [
    ["apresentacao", "Apresentação", "Olá {primeiro_nome}! Aqui é da Milennials. Ajudamos fábricas a organizar o comercial no WhatsApp. Posso te mostrar em 15 min?"],
    ["followup", "Follow-up proposta", "{primeiro_nome}, conseguiu avaliar a proposta? Fico à disposição para ajustar o escopo."],
    ["confirmacao", "Confirmação de reunião", "Confirmado nosso papo amanhã às {hora}? O link do Meet vai no convite."],
  ].map(([command, display_name, body], i) => ({
    id: id("misc", 9800 + i),
    organization_id: ORG_ID,
    command,
    display_name,
    body,
    created_by: tm(0),
    created_at: ago(60 * D),
    updated_at: ago(10 * D),
  }));

  // ───────────── copilot: avaliações do juiz e testes A/B ─────────────
  // Notas 0–10 por critério, espalhadas nos últimos 30 dias, para a tela de
  // Métricas LLM ter radar, tabela por agente e "piores avaliações".
  const copilot_conversation_evaluations = Array.from({ length: 18 }, (_, i) => {
    const agentIdx = i % 3;
    const base = [8.4, 7.1, 6.2][agentIdx];
    const wobble = ((i * 37) % 17) / 10 - 0.8;
    const clamp = (v) => Math.max(2, Math.min(10, Math.round(v * 10) / 10));
    const relevance = clamp(base + wobble);
    const tone = clamp(base + 0.4 - wobble / 2);
    const goal = clamp(base - 0.3 + wobble / 3);
    const concise = clamp(base - 1.1 + wobble);
    return {
      id: id("misc", 7800 + i),
      organization_id: ORG_ID,
      agent_id: id("agent", agentIdx + 2),
      score_relevance: relevance,
      score_tone: tone,
      score_goal_align: goal,
      score_conciseness: concise,
      score_overall: clamp((relevance + tone + goal + concise) / 4),
      evaluated_at: ago((i * 1.5 + 0.3) * D),
    };
  });
  const copilot_agent_variants = [
    [1, 2, "A · Abertura consultiva", true, 412, 7.9, 8.1, 9.8, 40],
    [2, 2, "B · Abertura com case", false, 398, 8.4, 8.6, 12.9, 51],
    [3, 3, "Pergunta de faturamento", true, 120, 7.0, 7.2, 21.4, 9],
  ].map(([n, agent, name, control, convs, overall, goal, qual, meetings]) => ({
    id: id("misc", 7900 + n),
    organization_id: ORG_ID,
    agent_id: id("agent", agent),
    name,
    is_control: control,
    total_conversations: convs,
    avg_score_overall: overall,
    avg_score_goal_align: goal,
    qualification_rate: qual,
    meetings_scheduled: meetings,
  }));

  // ───────────── disparos (blast plans) ─────────────
  // Planos em todos os estados do painel: dois ativos, um pausado, um com
  // todos os lotes liberados e um cancelado. Destinatários por lote
  // (`lot_index`) para as barras "Progresso por lote".
  const dayIso = (offsetDays) => new Date(NOW + offsetDays * D).toISOString().slice(0, 10);
  const blastDefs = [
    // [n, status, message, total, lotsTotal, lotsReleased, nextOffset, source, inst, createdDaysAgo, processedInCurrentLot]
    [1, "active", "Reativação · perdidos do 2º trimestre\nOlá {{primeiro_nome}}! Aqui é da Milennials — voltamos com condição nova para a {{empresa}}.", 240, 6, 3, 1, { context: "disparo", source: "estagio", funnelScope: "one", stageScope: "one", pipelineId: SALES_PIPE }, 1, 3, 0.55],
    [2, "active", "Convite · Feira Febratex 2026\n{{primeiro_nome}}, vamos estar no estande 214. Bora tomar um café?", 120, 4, 1, 1, { context: "disparo", type: "planilha", fileName: "feira-febratex-2026.xlsx" }, 2, 1, 0.7],
    [3, "paused", "Follow-up · propostas sem resposta\n{{primeiro_nome}}, conseguiu avaliar a proposta?", 60, 2, 1, 1, { context: "disparo", source: "estagio", funnelScope: "one", stageScope: "one", pipelineId: SALES_PIPE }, 1, 2, 1],
    [4, "completed", "Boas-vindas · clientes do 3º trimestre\nSeja bem-vindo, {{primeiro_nome}}!", 90, 3, 3, null, { context: "disparo", source: "estagio", funnelScope: "all", stageScope: "all" }, 1, 12, 1],
    [5, "cancelled", "Oferta de setembro · teste\n{{primeiro_nome}}, condição especial até sexta.", 80, 4, 1, null, { context: "disparo", type: "planilha", fileName: "base-distribuidores-sul.csv" }, 2, 9, 1],
  ];
  const blast_plans = [];
  const blast_plan_recipients = [];
  let recipientSeq = 0;
  for (const [n, status, message, total, lotsTotal, lotsReleased, nextOffset, source, inst, createdDaysAgo, partial] of blastDefs) {
    const planId = id("misc", 7700 + n);
    blast_plans.push({
      id: planId,
      organization_id: ORG_ID,
      instance_id: id("inst", inst),
      status,
      message,
      image_url: null,
      total_recipients: total,
      lots_total: lotsTotal,
      lots_released: lotsReleased,
      release_time: "09:00:00",
      next_release_date: nextOffset == null ? null : dayIso(nextOffset),
      created_by: null,
      created_at: ago(createdDaysAgo * D),
      updated_at: ago(2 * H),
      pipeline_id: source.pipelineId ?? null,
      source,
      post_send_target: null,
      template: null,
      refinements: {},
      delay_min_ms: 5000,
      delay_max_ms: 30000,
      window_days: null,
      window_from_minutes: null,
      window_to_minutes: null,
    });
    const perLot = Math.ceil(total / lotsTotal);
    for (let i = 0; i < total; i++) {
      const lot = Math.min(lotsTotal - 1, Math.floor(i / perLot));
      const posInLot = i - lot * perLot;
      const released = lot < lotsReleased;
      const isCurrent = lot === lotsReleased - 1;
      const done = released && (!isCurrent || posInLot < perLot * partial);
      let st = "pending";
      if (done) st = i % 29 === 7 ? "failed" : i % 23 === 5 ? "skipped" : "sent";
      blast_plan_recipients.push({
        id: id("misc", 20000 + recipientSeq++),
        plan_id: planId,
        lead_id: leads[i % leads.length].id,
        phone: leads[i % leads.length].phone ?? null,
        instance_id: id("inst", inst),
        lot_index: lot,
        status: st,
        reason: st === "failed" ? "número sem WhatsApp" : st === "skipped" ? "recebeu disparo há menos de 7 dias" : null,
        variable_snapshot: {},
        sent_at: st === "sent" ? ago((lotsReleased - lot) * D) : null,
        claimed_at: null,
        delivered_at: null,
        provider_message_id: null,
        estimated_cost: null,
        actual_cost: null,
        created_at: ago(createdDaysAgo * D),
      });
    }
  }

  const lead_history = leads.slice(0, 8).flatMap((l, i) => [
    { id: id("misc", 9900 + i * 3), organization_id: ORG_ID, lead_id: l.id, action: "created", description: "Lead criado via " + l.origin, source: "system", metadata: {}, created_by: null, created_at: l.created_at },
    { id: id("misc", 9901 + i * 3), organization_id: ORG_ID, lead_id: l.id, action: "note_added", description: "Decisor é o diretor industrial; pediu proposta com implantação em 30 dias.", source: "user", metadata: {}, created_by: tm(0), created_at: ago((i + 2) * H) },
    { id: id("misc", 9902 + i * 3), organization_id: ORG_ID, lead_id: l.id, action: "stage_changed", description: "Movido para Em conversa", source: "user", metadata: {}, created_by: l.sdr_id, created_at: ago((i + 5) * H) },
  ]);

  return {
    NOW,
    isMaster: master,
    org,
    orgId: ORG_ID,
    salesPipelineId: SALES_PIPE,
    authUser: { id: USER_ID, email: team_members[0].email, full_name: team_members[0].name },
    db: {
      organizations: [org],
      team_members,
      profiles,
      user_roles,
      master_users,
      gestores: [],
      gestor_organizations: [],
      subscription_plans,
      pipelines,
      pipeline_stages,
      pipeline_entries,
      leads,
      deals,
      tags,
      lead_tags,
      whatsapp_instances,
      whatsapp_messages,
      whatsapp_conversations,
      conversations,
      conversation_messages,
      copilot_agents,
      workflows,
      workflow_executions: [],
      products,
      upsell_clients,
      upsell_orders,
      follow_ups,
      activities,
      goals,
      commissions,
      org_visible_members,
      negocio_projetado,
      sale_events,
      lead_origins,
      loss_reasons,
      notifications,
      org_onboarding_progress,
      acoes_do_dia,
      metrics_studio_panels,
      metric_custom_definitions: [],
      awards,
      competitions,
      competition_participants,
      competition_prizes,
      message_templates,
      blast_plans,
      blast_plan_recipients,
      copilot_conversation_evaluations,
      copilot_agent_variants,
      lead_history,
      saved_views: [],
    },
  };
}
