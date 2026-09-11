import { supabase } from "@/integrations/supabase/client";

function normalizarNome(name: string): string {
  return name.toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Exclusão desativa a etapa, mas sua chave continua identificando histórico e
 * automações. Recriar o nome exige uma chave nova, sem reativar nem renomear a
 * linha antiga. A UNIQUE do banco continua protegendo criações concorrentes.
 */
export async function chaveDeNovaEtapa(
  escopo: { organizationId: string } & (
    | { pipelineId: string }
    | { pipelineType: string }
  ),
  name: string,
  baseKey: string,
): Promise<string> {
  let query = supabase.from("pipeline_stages")
    .select("stage_key, name, is_active")
    .eq("organization_id", escopo.organizationId);
  query = "pipelineId" in escopo
    ? query.eq("pipeline_id", escopo.pipelineId)
    : query.eq("pipeline_type", escopo.pipelineType);

  const { data, error } = await query;
  if (error) throw error;

  const stages = data ?? [];
  const normalizedName = normalizarNome(name);
  if (stages.some(stage => stage.is_active && (
    stage.stage_key === baseKey || normalizarNome(stage.name) === normalizedName
  ))) {
    throw new Error("Já existe uma etapa com esse nome neste funil");
  }

  const occupied = new Set(stages.map(stage => stage.stage_key));
  let key = baseKey;
  for (let suffix = 2; occupied.has(key); suffix++) {
    key = `${baseKey}_${suffix}`;
  }
  return key;
}
