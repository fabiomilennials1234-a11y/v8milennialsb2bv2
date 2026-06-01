import type { ActionInput, ActionResult } from "./types.ts";

export async function applyChecklist(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;
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

  // Idempotencia: espelha o trigger de stage (uniq_checklists_lead_source).
  // Se este template ja foi aplicado neste lead, no-op em vez de duplicar.
  const { data: existing } = await supabase
    .from("checklists")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .eq("source_template_id", templateId)
    .maybeSingle();

  if (existing) {
    return {
      success: true,
      message: `Checklist "${template.title}" ja aplicado (idempotente)`,
      data: { checklist_id: existing.id, template_id: templateId, idempotent: true },
    };
  }

  const { data: templateItems, error: iErr } = await supabase
    .from("checklist_items")
    .select("title, position")
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
      // Marca a origem → habilita dedup via indice parcial unico (lead_id, source_template_id),
      // igual ao trigger de stage. Tambem deixa o checklist auditavel.
      source_template_id: templateId,
    })
    .select("id")
    .single();

  if (cErr) {
    // Corrida: outro processo aplicou o mesmo template entre o pre-check e o insert.
    // O indice parcial unico garante no-duplicado; tratamos 23505 como sucesso idempotente.
    if (cErr.code === "23505") {
      const { data: raced } = await supabase
        .from("checklists")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("lead_id", leadId)
        .eq("source_template_id", templateId)
        .maybeSingle();
      return {
        success: true,
        message: `Checklist "${template.title}" ja aplicado (idempotente)`,
        data: { checklist_id: raced?.id ?? null, template_id: templateId, idempotent: true },
      };
    }
    return { success: false, error: cErr.message };
  }

  if (templateItems && templateItems.length > 0) {
    const itemsToInsert = templateItems.map((it: { title: string; position: number }) => ({
      checklist_id: newChecklist.id,
      title: it.title,
      position: it.position,
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
