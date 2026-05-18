import type { ActionInput, ActionResult } from "./types.ts";

export async function applyChecklist(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;
  const templateId = (params.checklistTemplateId as string | undefined)?.trim();

  if (!templateId) {
    return { success: false, error: "checklistTemplateId nao configurado no no" };
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
    })
    .select("id")
    .single();

  if (cErr) return { success: false, error: cErr.message };

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
