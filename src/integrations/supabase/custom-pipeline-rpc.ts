import { supabase } from "./client";
import type { Json } from "./types";

function withoutUndefined(value: Record<string, Json | undefined>): Json {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Json;
}

export async function createCustomPipelineWithStages(
  pipeline: Record<string, Json | undefined>,
  stages: Array<Record<string, Json | undefined>>,
): Promise<string> {
  const { data, error } = await supabase.rpc("criar_funil_custom_com_etapas" as never, {
    p_funil: withoutUndefined(pipeline),
    p_etapas: stages.map(withoutUndefined),
  } as never);

  if (error) throw error;
  return data as string;
}

export async function createCustomPipelineStage(
  input: Record<string, Json | undefined>,
): Promise<string> {
  const { data, error } = await supabase.rpc("fn_etapa_custom_criar" as never, {
    p_input: withoutUndefined(input),
  } as never);

  if (error) throw error;
  return data as string;
}

export async function updateCustomPipelineRecord(
  pipelineId: string,
  patch: Record<string, Json | undefined>,
): Promise<void> {
  const { error } = await supabase.rpc("fn_funil_custom_atualizar" as never, {
    p_id: pipelineId,
    p_patch: withoutUndefined(patch),
  } as never);

  if (error) throw error;
}

export async function updateCustomPipelineStage(
  stageId: string,
  patch: Record<string, Json | undefined>,
): Promise<void> {
  const { error } = await supabase.rpc("fn_etapa_custom_atualizar" as never, {
    p_id: stageId,
    p_patch: withoutUndefined(patch),
  } as never);

  if (error) throw error;
}
