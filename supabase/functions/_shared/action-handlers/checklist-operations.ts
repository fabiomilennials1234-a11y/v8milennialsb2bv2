import type { ActionInput, ActionResult } from "./types.ts";

/**
 * `apply_checklist` — o checklist é DO NEGÓCIO (decisão do CTO, 2026-08-25).
 *
 * ── O QUE MUDA, E O QUE NÃO MUDA ──────────────────────────────────────────
 * Quando a execução sabe qual Negócio disparou (gatilho de funil), o checklist
 * nasce preso a ele: `pipeline_entry_id` preenchido, e a idempotência passa a
 * ser por `(negócio, template)`. Era por `(lead, template)`, e com isso o
 * SEGUNDO negócio do mesmo lead a passar pela etapa não recebia nada — 146 dos
 * 759 checklists de template em prod estão em leads com 2+ negócios.
 *
 * Quando não sabe (gatilho da pessoa: `tag_added`, `lead_created`), o checklist
 * continua sendo da PESSOA — `pipeline_entry_id` nulo, idempotência por lead,
 * exatamente como era. Não é meio-termo: é a regra. Ver a migration
 * `20270827000020_checklist_do_negocio.sql`.
 */
export async function applyChecklist(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, entryId, dealId, params } = input;
  const templateId = (params.checklistTemplateId as string | undefined)?.trim();

  if (!templateId) {
    return { success: false, error: "checklistTemplateId nao configurado no no" };
  }
  // Sem leadId o INSERT criaria um checklist orfao (lead_id NULL passa no FK) que
  // nunca aparece no modal de nenhum lead. Falhar explicito em vez de poluir o DB.
  if (!leadId) {
    return { success: false, error: "Workflow sem lead vinculado — apply_checklist requer leadId" };
  }

  const { data: template, error: tErr } = await supabase
    .from("checklists")
    .select("id, organization_id, title, description, lead_id")
    .eq("id", templateId)
    .maybeSingle();

  if (tErr) return { success: false, error: tErr.message };
  if (!template) {
    return { success: false, error: `Template de checklist nao encontrado (id=${templateId})` };
  }
  if (template.organization_id !== organizationId) {
    return { success: false, error: "Template pertence a outra organizacao" };
  }
  if (template.lead_id !== null) {
    return { success: false, error: "Registro alvo nao e um template (lead_id nao e null)" };
  }

  // Defense-in-depth: handler roda com service-role (RLS bypassed) e e reusado por
  // 30 action types. Garantir que o lead pertence a esta org antes de anexar — nao
  // confiar so no par (org, lead) que o executor monta. Espelha update-lead.ts.
  const { data: leadRow, error: lErr } = await supabase
    .from("leads")
    .select("organization_id")
    .eq("id", leadId)
    .maybeSingle();

  if (lErr) return { success: false, error: lErr.message };
  if (!leadRow || leadRow.organization_id !== organizationId) {
    return { success: false, error: "Lead nao pertence a esta organizacao" };
  }

  /**
   * Idempotência no MESMO escopo em que a linha vai nascer.
   *
   * Com negócio: `(pipeline_entry_id, source_template_id)`. Sem: `(lead_id,
   * source_template_id)` entre os que também não têm negócio — o
   * `.is("pipeline_entry_id", null)` não é detalhe: sem ele, um checklist que
   * já pertence a OUTRO negócio do mesmo lead seria lido como "já aplicado" e
   * este negócio sairia sem nada, que é o defeito de novo por outro caminho.
   */
  const escopo = supabase
    .from("checklists")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("source_template_id", templateId);
  const { data: existing } = entryId
    ? await escopo.eq("pipeline_entry_id", entryId).maybeSingle()
    : await escopo.eq("lead_id", leadId).is("pipeline_entry_id", null).maybeSingle();

  if (existing) {
    return {
      success: true,
      message: `Checklist "${template.title}" ja aplicado (idempotente)`,
      data: { checklist_id: existing.id, template_id: templateId, idempotent: true, entry_id: entryId ?? null },
    };
  }

  const { data: templateItems, error: iErr } = await supabase
    .from("checklist_items")
    .select("id, title, position")
    .eq("checklist_id", templateId)
    .order("position", { ascending: true });

  if (iErr) return { success: false, error: iErr.message };

  const { data: newChecklist, error: cErr } = await supabase
    .from("checklists")
    .insert({
      organization_id: organizationId,
      created_by: null,
      title: template.title,
      description: template.description,
      lead_id: leadId,
      // O lead continua gravado mesmo no escopo de negócio: o checklist é do
      // Negócio E da pessoa por trás dele, e sem isto a ficha do lead perderia
      // de vista o que a automação aplicou.
      pipeline_entry_id: entryId ?? null,
      deal_id: dealId ?? null,
      // Marca a origem → habilita dedup via indice parcial unico, igual ao
      // trigger de stage. Tambem deixa o checklist auditavel.
      source_template_id: templateId,
    })
    .select("id")
    .single();

  if (cErr) {
    // Corrida: outro processo aplicou o mesmo template entre o pre-check e o insert.
    // O indice parcial unico garante no-duplicado; tratamos 23505 como sucesso idempotente.
    if (cErr.code === "23505") {
      const corrida = supabase
        .from("checklists")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("source_template_id", templateId);
      const { data: raced } = entryId
        ? await corrida.eq("pipeline_entry_id", entryId).maybeSingle()
        : await corrida.eq("lead_id", leadId).is("pipeline_entry_id", null).maybeSingle();
      return {
        success: true,
        message: `Checklist "${template.title}" ja aplicado (idempotente)`,
        data: { checklist_id: raced?.id ?? null, template_id: templateId, idempotent: true },
      };
    }
    return { success: false, error: cErr.message };
  }

  if (templateItems && templateItems.length > 0) {
    const itemsToInsert = templateItems.map((it: { id: string; title: string; position: number }) => ({
      checklist_id: newChecklist.id,
      title: it.title,
      position: it.position,
      // Linhagem estavel template->lead (ADR-0016): o item copiado aponta pro
      // item de template de origem. E o identificador que o node de workflow usa
      // pra achar "este item" atravessando a copia, ja que o id da copia so nasce aqui.
      template_item_id: it.id,
    }));

    const { error: insErr } = await supabase
      .from("checklist_items")
      .insert(itemsToInsert);

    if (insErr) {
      await supabase.from("checklists").delete().eq("id", newChecklist.id);
      return { success: false, error: insErr.message };
    }
  }

  return {
    success: true,
    message: `Checklist "${template.title}" aplicado (${templateItems?.length ?? 0} itens)`,
    data: { checklist_id: newChecklist.id, template_id: templateId },
  };
}
