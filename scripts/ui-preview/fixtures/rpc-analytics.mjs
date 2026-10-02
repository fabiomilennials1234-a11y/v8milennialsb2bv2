/**
 * Dashboard / Métricas / Performance RPCs. Numbers are plausible, stable
 * (hash of the inputs, never Math.random) and — where cheap — derived from
 * the fixture rows so a card and its drill-down agree.
 */

/** Stable 0..1 from a string. */
function h01(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619);
  return ((x >>> 0) % 100000) / 100000;
}
const between = (key, a, b) => Math.round(a + h01(key) * (b - a));

function dayKeys(start, end, max = 62) {
  const out = [];
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(+s) || Number.isNaN(+e)) return out;
  for (let d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate())); d <= e && out.length < max; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const members = (fx) => fx.db.team_members.filter((m) => m.is_active);
const sellers = (fx) => members(fx).filter((m) => m.metric_type === "sales");
const sdrs = (fx) => members(fx).filter((m) => m.metric_type === "meetings");

function dashboardMetrics(a, fx) {
  const key = `${a.p_start_date}|${a.p_end_date}|${a.p_filter_member_id ?? ""}`;
  const days = dayKeys(a.p_start_date ?? new Date(fx.NOW - 29 * 864e5).toISOString(), a.p_end_date ?? new Date(fx.NOW).toISOString());
  const nowDay = new Date(fx.NOW).toISOString().slice(0, 10);
  const dailySales = days.map((day) => {
    const future = day > nowDay;
    const count = future ? 0 : between(`c${day}`, 0, 4);
    return { day, count, revenue: count ? count * between(`r${day}`, 14000, 52000) : 0 };
  });
  const vendaTotal = dailySales.reduce((s, d) => s + d.revenue, 0) || between(`vt${key}`, 180000, 640000);
  const vendas = dailySales.reduce((s, d) => s + d.count, 0) || between(`n${key}`, 8, 24);
  const vendaMRR = Math.round(vendaTotal * 0.58);
  const vendaProjeto = Math.round(vendaTotal * 0.34);
  const marcadas = between(`m${key}`, 38, 74);
  const comparecidas = Math.round(marcadas * (0.68 + h01(`cmp${key}`) * 0.18));
  const leads = between(`l${key}`, 160, 420);
  return {
    totalLeads: leads,
    reunioesMarcadas: marcadas,
    reunioesComparecidas: comparecidas,
    noShow: marcadas - comparecidas,
    taxaNoShow: Math.round(((marcadas - comparecidas) / marcadas) * 1000) / 10,
    vendaTotal,
    vendaMRR,
    vendaProjeto,
    vendaSemClassificacao: vendaTotal - vendaMRR - vendaProjeto,
    ticketMedio: Math.round(vendaTotal / Math.max(1, vendas)),
    ticketMedioMRR: Math.round(vendaMRR / Math.max(1, Math.round(vendas * 0.6))),
    ticketMedioProjeto: Math.round(vendaProjeto / Math.max(1, Math.round(vendas * 0.4))),
    novosClientes: Math.max(1, Math.round(vendas * 0.55)),
    propostasEnviadas: between(`p${key}`, 22, 48),
    tempoMedioResposta: between(`t${key}`, 4, 19),
    vendaPrimeiroPedido: Math.round(vendaTotal * 0.62),
    vendaBaseAtiva: Math.round(vendaTotal * 0.38),
    taxaConversao: Math.round((vendas / leads) * 1000) / 10,
    dailySales,
    funnelReunioesMarcadas: marcadas,
    funnelCompareceu: comparecidas,
    funnelPropostas: between(`p${key}`, 22, 48),
    funnelVendas: vendas,
  };
}

function agendaEvents(a, fx) {
  const start = a.p_start ?? new Date(fx.NOW).toISOString();
  const end = a.p_end ?? new Date(fx.NOW + 14 * 864e5).toISOString();
  const leadsById = new Map(fx.db.leads.map((l) => [l.id, l]));
  const meetings = fx.db.negocio_projetado
    .filter((n) => n.meeting_date && n.meeting_date >= start && n.meeting_date <= end && n.funil_sistema !== "confirmacao")
    .map((n, i) => {
      const l = leadsById.get(n.lead_id);
      return {
        id: `meeting-${n.id}`,
        source: "meeting",
        title: `Reunião — ${l?.company ?? "Lead"}`,
        description: "Demonstração do Torque CRM",
        start_at: n.meeting_date,
        end_at: new Date(new Date(n.meeting_date).getTime() + 45 * 60_000).toISOString(),
        all_day: false,
        event_type: "meeting",
        status: n.is_confirmed ? "confirmed" : "scheduled",
        lead_id: n.lead_id,
        lead_name: l?.name ?? null,
        lead_company: l?.company ?? null,
        created_by: n.sdr_id,
        creator_name: fx.db.team_members.find((m) => m.id === n.sdr_id)?.name ?? null,
        location: null,
        meet_link: "https://meet.google.com/abc-defg-hij",
        color: "#8B5CF6",
        google_event_id: null,
        owner_team_member_id: n.closer_id ?? n.responsible_id,
      };
    });
  const follows = fx.db.follow_ups
    .filter((f) => !f.completed_at && f.due_date >= start && f.due_date <= end)
    .map((f) => {
      const l = leadsById.get(f.lead_id);
      return {
        id: `follow_up-${f.id}`,
        source: "follow_up",
        title: f.title,
        description: f.description,
        start_at: f.due_date,
        end_at: null,
        all_day: false,
        event_type: "follow_up",
        status: "pending",
        lead_id: f.lead_id,
        lead_name: l?.name ?? null,
        lead_company: l?.company ?? null,
        created_by: f.assigned_to,
        creator_name: fx.db.team_members.find((m) => m.id === f.assigned_to)?.name ?? null,
        location: null,
        meet_link: null,
        color: "#F59E0B",
        google_event_id: null,
        owner_team_member_id: f.assigned_to,
      };
    });
  return [...meetings, ...follows].sort((x, y) => x.start_at.localeCompare(y.start_at));
}

function awaiting(a, fx, threads) {
  return threads(fx, a.p_instance ? [a.p_instance] : null)
    .filter((t) => t.last_message_direction === "incoming" && t.lead_id)
    .slice(0, a.p_limit ?? 30)
    .map((t) => {
      const lead = fx.db.leads.find((l) => l.id === t.lead_id);
      const owner = fx.db.team_members.find((m) => m.id === lead?.responsible_id);
      return {
        phone_number: t.phone_number,
        normalized_phone: t.normalized_phone,
        push_name: t.push_name,
        lead_id: t.lead_id,
        conversation_id: t.conversation_id,
        last_client_message: t.last_message,
        last_client_message_at: t.last_message_time,
        ai_replied: false,
        ai_replied_at: null,
        waiting_total: t.unread_count || 1,
        owner_team_member_id: owner?.id ?? null,
        owner_name: owner?.name ?? null,
      };
    });
}

const MEASURES = [
  ["receita", "Receita", "currency", "fechamentos"],
  ["num_vendas", "Vendas", "count", "fechamentos"],
  ["leads_criados", "Leads criados", "count", "entradas"],
  ["reunioes_marcadas", "Reuniões marcadas", "count", "entradas"],
  ["reunioes_realizadas", "Reuniões realizadas", "count", "entradas"],
  ["negocios_abertos", "Negócios abertos", "count", "hoje"],
  ["negocios_na_etapa", "Negócios na etapa", "count", "hoje"],
  ["tempo_resposta_equipe", "Tempo de resposta da equipe", "duration_seconds", "entradas"],
];
const RECORTES = [
  ["total", "Total"],
  ["tempo", "Ao longo do tempo"],
  ["responsavel", "Por responsável"],
  ["origem", "Por origem"],
  ["etapa", "Por etapa"],
];

function measure(a, fx) {
  const ref = a.p_measure_ref ?? {};
  const mid = ref.id ?? ref.num ?? "receita";
  const meta = MEASURES.find((m) => m[0] === mid) ?? MEASURES[0];
  const unit = ref.kind === "ratio" ? "percent" : meta[2];
  const key = JSON.stringify([ref, a.p_period, a.p_ref, a.p_start, a.p_end]);
  const scale = unit === "currency" ? [120000, 680000] : unit === "duration_seconds" ? [240, 1500] : unit === "percent" ? [8, 42] : [12, 160];
  const base = { kind: ref.kind ?? "leaf", measure_id: ref.kind === "leaf" ? mid : undefined, label: meta[1], unit, currency: unit === "currency" ? "BRL" : null, anchor: meta[3], recorte: a.p_recorte, empty_reason: null };
  if (!a.p_recorte || a.p_recorte === "total") return { ...base, value: between(key, ...scale), series: null };
  let labels;
  if (a.p_recorte === "tempo") {
    const end = a.p_end ?? new Date(fx.NOW).toISOString();
    const start = a.p_start ?? new Date(fx.NOW - 29 * 864e5).toISOString();
    labels = dayKeys(start, end, 31).map((d) => [d, d.slice(8, 10) + "/" + d.slice(5, 7)]);
  } else if (a.p_recorte === "responsavel") labels = members(fx).map((m) => [m.id, m.name]);
  else if (a.p_recorte === "origem") labels = fx.db.lead_origins.map((o) => [o.slug, o.name]);
  else labels = fx.db.pipeline_stages.filter((s) => s.pipeline_id === fx.salesPipelineId).map((s) => [s.stage_key, s.name]);
  const per = [Math.round(scale[0] / Math.max(4, labels.length / 2)), Math.round(scale[1] / Math.max(4, labels.length / 2))];
  return { ...base, value: null, series: labels.map(([k, label]) => ({ key: k, label, value: between(key + k, ...per) })) };
}

function ranking(a, fx) {
  const key = `${a.p_month}-${a.p_year}`;
  const salesRanking = sellers(fx)
    .map((m) => {
      const value = between(`${key}v${m.id}`, 60000, 210000);
      return { id: m.id, name: m.name, job_title: m.job_title, metric_type: m.metric_type, role: m.role, value, conversions: between(`${key}c${m.id}`, 3, 12), goal: 150000, goalProgress: Math.round((value / 150000) * 100) };
    })
    .sort((x, y) => y.value - x.value)
    .map((r, i, arr) => ({ ...r, position: i + 1, revenueShare: Math.round((r.value / arr.reduce((s, z) => s + z.value, 0)) * 1000) / 10 }));
  const meetingsRanking = sdrs(fx)
    .map((m) => {
      const meetings = between(`${key}m${m.id}`, 8, 26);
      const booked = meetings + between(`${key}b${m.id}`, 2, 8);
      return { id: m.id, name: m.name, job_title: m.job_title, metric_type: m.metric_type, role: m.role, value: 0, meetings, meetingsBooked: booked, goalBooked: 30, goalBookedProgress: Math.round((booked / 30) * 100), goal: 24, goalProgress: Math.round((meetings / 24) * 100) };
    })
    .sort((x, y) => y.meetings - x.meetings)
    .map((r, i) => ({ ...r, position: i + 1 }));
  return { salesRanking, meetingsRanking };
}

export function analyticsRpcs(threads) {
  return {
    get_dashboard_metrics: dashboardMetrics,
    get_sales_metrics: dashboardMetrics,
    get_comando_agenda_events: agendaEvents,
    get_agenda_events_scoped: agendaEvents,
    // ── carteira (/upsell) ──
    get_portfolio_kpis: (_a, fx) => {
      const cs = fx.db.upsell_clients.filter((c) => c.is_active !== false);
      const seg = { ouro: 0, prata: 0, novo: 0, resgate: 0, dormindo: 0 };
      for (const c of fx.db.upsell_clients) if (c.segment in seg) seg[c.segment]++;
      const overdue = cs.filter((c) => c.next_order_expected && c.next_order_expected < new Date(fx.NOW).toISOString());
      const week = new Date(fx.NOW + 7 * 864e5).toISOString();
      return {
        total_clients: fx.db.upsell_clients.length,
        // monthly recurring revenue of repeat buyers (rendered as R$)
        total_recurring: cs.filter((c) => (c.order_count ?? 0) > 2).reduce((s, c) => s + Math.round((c.avg_ticket ?? 0) * (30 / Math.max(15, c.reorder_cycle_days ?? 30))), 0),
        overdue_count: overdue.length,
        overdue_revenue: overdue.reduce((s, c) => s + (c.avg_ticket ?? 0), 0),
        avg_health: Math.round(cs.reduce((s, c) => s + (c.health_score ?? 0), 0) / Math.max(1, cs.length)),
        avg_ticket: Math.round(cs.reduce((s, c) => s + (c.avg_ticket ?? 0), 0) / Math.max(1, cs.length)),
        expected_this_week: cs.filter((c) => c.next_order_expected && c.next_order_expected <= week && c.next_order_expected >= new Date(fx.NOW).toISOString()).length,
        segment_counts: seg,
      };
    },
    get_portfolio_clients: (a, fx) => {
      let rows = fx.db.upsell_clients.map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company,
        phone: c.phone,
        health_score: c.health_score,
        health_status: c.health_status,
        segment: c.segment,
        avg_ticket: c.avg_ticket,
        days_since_last_order: c.days_since_last_order,
        reorder_cycle_days: c.reorder_cycle_days,
        next_order_expected: c.next_order_expected,
        order_count: c.order_count,
        lifetime_value: c.lifetime_value,
        lead_id: c.lead_id,
        trend: c.trend,
        churn_probability: c.churn_probability,
        external_id: c.external_id ?? null,
      }));
      if (a.p_filter && a.p_filter !== "all") rows = rows.filter((r) => r.segment === a.p_filter || r.health_status === a.p_filter);
      if (a.p_search) rows = rows.filter((r) => `${r.name} ${r.company}`.toLowerCase().includes(String(a.p_search).toLowerCase()));
      const col = a.p_sort_by ?? "name";
      const dir = a.p_sort_dir === "desc" ? -1 : 1;
      rows.sort((x, y) => (x[col] ?? 0) > (y[col] ?? 0) ? dir : (x[col] ?? 0) < (y[col] ?? 0) ? -dir : 0);
      const size = Number(a.p_page_size ?? 50);
      const page = Number(a.p_page ?? 1);
      return { rows: rows.slice((page - 1) * size, page * size), total: rows.length, page, page_size: size, total_pages: Math.max(1, Math.ceil(rows.length / size)) };
    },
    get_agenda_events: agendaEvents,
    get_conversations_awaiting_human_reply: (a, fx) => awaiting(a, fx, threads),
    get_funnel_health: (a, fx) => {
      const k = `${a.p_start_date}|${a.p_end_date}`;
      const entraram = between(`e${k}`, 220, 380);
      const avaliados = Math.round(entraram * 0.82);
      const bons = Math.round(avaliados * 0.46);
      const reuniao = Math.round(bons * 0.71);
      const compareceram = Math.round(reuniao * 0.78);
      const compraram = Math.round(compareceram * 0.36);
      return {
        cohort_total: entraram,
        stages: { entraram, avaliados, bons, reuniao, compareceram, compraram },
        tiers: { diamante: Math.round(avaliados * 0.09), ouro: Math.round(avaliados * 0.21), prata: Math.round(avaliados * 0.31), bronze: Math.round(avaliados * 0.24), desqualificado: Math.round(avaliados * 0.15) },
        depth: { pre_only: Math.round(avaliados * 0.4), final: Math.round(avaliados * 0.6) },
        sellers: members(fx)
          .slice(1)
          .map((m) => {
            const v = between(`s${k}${m.id}`, 18, 52);
            return { team_member_id: m.id, name: m.name, vinculados: v, avaliados: Math.round(v * 0.85), bons: Math.round(v * 0.4), reuniao: Math.round(v * 0.28), compareceram: Math.round(v * 0.22), compraram: Math.round(v * 0.08) };
          }),
        cycles: { sales_count: compraram, lead_to_sale_days: 34.5, meeting_sales_count: Math.round(compraram * 0.8), meeting_to_sale_days: 12.2, lead_to_meeting_days: 6.8 },
      };
    },
    get_next_best_actions: (a, fx) =>
      fx.db.deals
        .filter((d) => d.outcome === "open")
        .slice(0, a.p_limit ?? 5)
        .map((d, i) => {
          const l = fx.db.leads.find((x) => x.id === d.source_lead_id);
          const kinds = [
            ["follow_up", "Retomar proposta parada", "Proposta enviada há 4 dias sem resposta", "high"],
            ["call", "Ligar para o decisor", "Abriu o e-mail da proposta 3 vezes hoje", "high"],
            ["schedule_meeting", "Agendar demonstração", "Lead Ouro respondeu no WhatsApp", "medium"],
            ["whatsapp", "Enviar estudo de caso", "Mesmo segmento de 2 clientes ativos", "medium"],
            ["follow_up", "Confirmar reunião de amanhã", "Reunião sem confirmação", "low"],
          ][i % 5];
          return { id: `nba-${d.id}`, lead_id: l?.id ?? null, lead_name: l?.name ?? null, deal_id: d.id, action_type: kinds[0], title: kinds[1], reason: kinds[2], priority: kinds[3], due_by: new Date(fx.NOW + (i + 1) * 3600e3).toISOString(), metadata: { company: l?.company } };
        }),
    fn_metric_catalog: () => ({
      measures: MEASURES.map(([id, label, unit, anchor]) => ({ id, label, unit, anchor, description: null, compatible_recortes: RECORTES.map((r) => r[0]), compatible_formats: ["number", "bar", "line", "donut"] })),
      recortes: RECORTES.map(([id, label]) => ({ id, label })),
      formats: [
        { id: "number", label: "Número" },
        { id: "bar", label: "Barras" },
        { id: "line", label: "Linha" },
        { id: "donut", label: "Rosca" },
      ],
      ratios: [{ id: "conversao_reuniao_venda", label: "Conversão reunião → venda", num: "num_vendas", den: "reunioes_realizadas", format: "percent", unit: "percent" }],
      renderers: [
        { id: "number", label: "Número", description: null, is_legacy: false },
        { id: "bar", label: "Barras", description: null, is_legacy: false },
        { id: "line", label: "Linha", description: null, is_legacy: false },
        { id: "donut", label: "Rosca", description: null, is_legacy: false },
      ],
    }),
    fn_metric_measure: measure,
    get_ranking_data: ranking,
    get_ranking: ranking,
    get_movement_metrics: (a) => {
      const k = `${a.p_start}|${a.p_end}`;
      return { marcadas: between(`m${k}`, 40, 70), comparecidas: between(`c${k}`, 28, 50), vendido_count: between(`v${k}`, 8, 18), vendido_receita: between(`r${k}`, 240000, 620000) };
    },
    get_product_ranking: (a, fx) =>
      fx.db.products
        .map((p) => {
          const qty = between(`${a.p_start_date}${p.id}`, 2, 18);
          return { product_id: p.id, product_name: p.name, product_type: p.type, qty_sold: qty, total_value: qty * p.ticket, ticket_medio: p.ticket };
        })
        .sort((x, y) => y.total_value - x.total_value),
    get_seller_activity_scores: (a, fx) =>
      members(fx)
        .slice(1)
        .map((m) => {
          const k = `${a.p_start_date}${m.id}`;
          const leads = between(k + "l", 10, 60);
          const followups = between(k + "f", 15, 80);
          const reunioes = between(k + "r", 4, 24);
          const propostas = between(k + "p", 2, 14);
          const vendas = between(k + "v", 0, 8);
          const scoreBruto = leads + followups * 0.5 + reunioes * 3 + propostas * 4 + vendas * 8;
          return { id: m.id, name: m.name, role: m.role, metricType: m.metric_type, leads, followups, reunioes, propostas, vendas, scoreBruto, scoreNormalizado: 0 };
        })
        .map((r, _i, arr) => ({ ...r, scoreNormalizado: Math.round((r.scoreBruto / Math.max(...arr.map((x) => x.scoreBruto))) * 100) })),
    get_sales_cycle_analysis: (_a, fx) => {
      const st = fx.db.pipeline_stages.filter((s) => s.pipeline_id === fx.salesPipelineId).slice(0, 6);
      return st.slice(0, -1).map((s, i) => ({ from_stage: s.name, to_stage: st[i + 1].name, avg_hours: between(`a${i}`, 18, 140), median_hours: between(`m${i}`, 12, 96), transition_count: between(`t${i}`, 8, 40) }));
    },
    get_win_loss_analysis: (_a, fx) => {
      const rows = fx.db.loss_reasons.map((r, i) => ({ loss_reason: r.name, count: between(`wl${i}`, 2, 14), total_value: between(`wv${i}`, 40000, 300000) }));
      const total = rows.reduce((s, r) => s + r.count, 0);
      return rows.map((r) => ({ ...r, pct: Math.round((r.count / total) * 1000) / 10 }));
    },
    get_uf_heatmap: (_a, fx) => {
      const by = {};
      for (const l of fx.db.leads) {
        by[l.uf] ??= { uf: l.uf, leads_count: 0, clients_count: 0, total_sold: 0, unmapped_count: 0 };
        by[l.uf].leads_count++;
        if (l.relacao_negocios === "cliente") {
          by[l.uf].clients_count++;
          by[l.uf].total_sold += between(`uf${l.id}`, 30000, 180000);
        }
      }
      return Object.values(by);
    },
    get_leads_by_uf: (a, fx) =>
      fx.db.leads
        .filter((l) => l.uf === a.p_uf)
        .map((l) => ({ id: l.id, name: l.name, company: l.company, phone: l.phone, uf_source: "ddd", is_client: l.relacao_negocios === "cliente", sold_value: l.relacao_negocios === "cliente" ? between(`uf${l.id}`, 30000, 180000) : 0, created_at: l.created_at })),
  };
}
