/**
 * Funnel RPCs: the kanban reads its columns ONLY through these (one
 * get_pipeline_page call per stage), so they are derived from the same
 * pipeline_entries / leads / deals rows the rest of the mock serves.
 * Contract: supabase/migrations/20271021000039_negocio_ganho_vai_para_etapa_won.sql
 */

const person = (fx, tmId) => {
  if (!tmId) return null;
  const m = fx.db.team_members.find((t) => t.id === tmId);
  return m ? { id: m.id, name: m.name, avatar_url: m.avatar_url ?? null } : null;
};

export function leadJson(fx, lead) {
  if (!lead) return null;
  const tags = fx.db.lead_tags
    .filter((lt) => lt.lead_id === lead.id)
    .map((lt) => fx.db.tags.find((t) => t.id === lt.tag_id))
    .filter(Boolean)
    .map((t) => ({ tag: { id: t.id, name: t.name, color: t.color } }));
  const pick = ["id", "name", "company", "email", "phone", "rating", "origin", "segment", "faturamento", "urgency", "notes", "compromisso_date", "ai_disabled", "avatar_url", "erp_code", "pre_qualification_tier", "qualification_tier", "sdr_id", "closer_id", "responsible_id", "pre_sale_responsible_id", "sale_responsible_id"];
  const out = Object.fromEntries(pick.map((k) => [k, lead[k] ?? null]));
  return {
    ...out,
    responsible: person(fx, lead.responsible_id),
    sdr: person(fx, lead.sdr_id),
    closer: person(fx, lead.closer_id),
    pre_sale_responsible: person(fx, lead.pre_sale_responsible_id),
    sale_responsible: person(fx, lead.sale_responsible_id),
    lead_tags: tags,
  };
}

/** Shared filter block (sharedRpcFilterParams) — the common ones only. */
function filteredEntries(fx, a) {
  const leadsById = new Map(fx.db.leads.map((l) => [l.id, l]));
  return fx.db.pipeline_entries.filter((e) => {
    if (a.p_pipeline_id && e.pipeline_id !== a.p_pipeline_id) return false;
    const l = leadsById.get(e.lead_id);
    if (!l || l.deleted_at) return false;
    if (a.p_search) {
      const q = String(a.p_search).toLowerCase();
      if (![l.name, l.company, l.email, l.phone].some((v) => v && String(v).toLowerCase().includes(q))) return false;
    }
    if (a.p_responsible_id) {
      const ids = [l.responsible_id, l.sdr_id, l.closer_id, l.pre_sale_responsible_id, l.sale_responsible_id, e.assigned_to];
      if (!ids.includes(a.p_responsible_id)) return false;
    }
    if (Array.isArray(a.p_tag_ids) && a.p_tag_ids.length) {
      const tagIds = fx.db.lead_tags.filter((lt) => lt.lead_id === l.id).map((lt) => lt.tag_id);
      if (!a.p_tag_ids.some((t) => tagIds.includes(t))) return false;
    }
    if (Array.isArray(a.p_origins) && a.p_origins.length && !a.p_origins.includes(l.origin)) return false;
    if (a.p_qualification_tier && l.qualification_tier !== a.p_qualification_tier) return false;
    return true;
  });
}

export const pipelineRpcs = {
  get_pipeline_page: (a, fx) => {
    const size = Number(a.p_page_size ?? 20);
    let rows = filteredEntries(fx, a).filter((e) => e.stage_key === a.p_stage_id || e.stage_id === a.p_stage_id);
    rows.sort((x, y) => y.created_at.localeCompare(x.created_at));
    if (a.p_cursor) rows = rows.filter((e) => e.created_at < a.p_cursor);
    return rows.slice(0, size).map((e) => ({
      id: e.id,
      pipeline_id: e.pipeline_id,
      lead_id: e.lead_id,
      stage_key: e.stage_key,
      assigned_to: e.assigned_to,
      notes: e.notes,
      metadata: e.metadata ?? {},
      entered_at: e.entered_at,
      stage_changed_at: e.stage_changed_at,
      created_at: e.created_at,
      updated_at: e.updated_at,
      lead: leadJson(fx, fx.db.leads.find((l) => l.id === e.lead_id)),
    }));
  },
  get_pipeline_stage_counts_by_id: (a, fx) => {
    const counts = new Map();
    for (const e of filteredEntries(fx, a)) {
      const k = `${e.stage_id}|${e.stage_key}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts].map(([k, cnt]) => {
      const [stage_id, stage_key] = k.split("|");
      return { stage_id, stage_key, cnt };
    });
  },
  get_funil_desfecho_counts: (a, fx) => {
    const tally = { won: 0, lost: 0, open: 0 };
    for (const e of filteredEntries(fx, a)) {
      const st = fx.db.pipeline_stages.find((s) => s.id === e.stage_id);
      const role = st?.stage_role;
      tally[role === "won" ? "won" : role === "lost" ? "lost" : "open"]++;
    }
    return Object.entries(tally).map(([outcome, cnt]) => ({ outcome, cnt }));
  },
};
