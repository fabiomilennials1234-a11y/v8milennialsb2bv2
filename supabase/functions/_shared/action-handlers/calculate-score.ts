import type { ActionInput, ActionResult } from "./types.ts";

interface Criterion {
  name: string;
  weight: number;
  value: number;
}

export async function calculateScore(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;
  const criteria = params.criteria as Criterion[] | undefined;

  if (!criteria || !Array.isArray(criteria) || criteria.length === 0) {
    return { success: false, error: "criteria é obrigatório e não pode ser vazio" };
  }

  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight === 0) {
    return { success: false, error: "soma dos pesos não pode ser zero" };
  }

  const weightedSum = criteria.reduce((sum, c) => sum + c.value * c.weight, 0);
  const average = weightedSum / totalWeight; // 0-10 scale
  const scaled = Math.round((average / 10) * 100); // scale to 0-100
  const score = Math.min(100, Math.max(0, scaled));

  const { error } = await supabase
    .from("leads")
    .update({ qualification_score: score })
    .eq("id", leadId)
    .eq("organization_id", organizationId);

  if (error) {
    return { success: false, error: `Falha ao atualizar score: ${error.message}` };
  }

  return { success: true, message: `Score: ${score}` };
}
