import { supabase } from "@/integrations/supabase/client";

/**
 * A posição livre para a PRÓXIMA etapa de um funil.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 * Os dois editores de etapa criavam com `position: localStages.length` — o
 * tamanho da lista que a TELA mostra. E a tela mostra só etapa ativa.
 *
 * Etapa excluída não sai da tabela: `useDeleteCustomPipelineStage` e a irmã de
 * sistema fazem `update({ is_active: false })`, e a linha **continua ocupando a
 * posição dela**. Basta excluir uma etapa que não seja a última para o contador
 * de ativas apontar para uma posição já tomada — e aí o INSERT bate em
 * `pipeline_stages_pipeline_id_position_key UNIQUE (pipeline_id, position)`.
 *
 * Medido no PROD em 2026-09-04: funil "Condomínio" (Pesco Automação) com
 * `novo`=0 (ativa), `em_andamento`=1 (INATIVA), `concluido`=2 (ativa). Duas
 * ativas → o editor pedia `position = 2` → colidia com `concluido`. Três funis
 * em duas orgs estavam nesse estado, sem conseguir criar etapa nenhuma.
 *
 * O erro chegava ao usuário como **"Já existe uma etapa com esse nome"**, o que
 * mandou a investigação para o lado errado (nome duplicado entre funis) —
 * ver `mensagemDeConflitoDeEtapa`.
 *
 * ── POR QUE `max + 1` E NÃO `count(ativas)` ─────────────────────────────────
 * `max(position) + 1` sobre TODAS as linhas do funil (ativas e inativas) é a
 * única regra que não pode colidir, porque não depende de as posições serem
 * densas — e elas não são. A migration `20270906001000` renumerou as inativas
 * para a faixa `1000+` ("headroom para os editores"), mas isso foi backfill de
 * uma vez: toda exclusão posterior volta a deixar a linha inativa no meio.
 * Confirmado no PROD — a Qualificação da Café Jurerê tem posições `0..14` E
 * `1000..1004` na mesma tabela.
 *
 * A etapa nova continua nascendo no FIM da lista visível, que é o que o editor
 * promete: as ativas vivem abaixo das inativas na numeração, e o reordenar por
 * arrasto renumera as ativas para `0..n-1` logo em seguida.
 */
export async function proximaPosicaoDeEtapa(
  escopo:
    | { pipelineId: string }
    | { organizationId: string; pipelineType: string },
): Promise<number> {
  let query = supabase
    .from("pipeline_stages")
    .select("position")
    .order("position", { ascending: false })
    .limit(1);

  if ("pipelineId" in escopo) {
    query = query.eq("pipeline_id", escopo.pipelineId);
  } else {
    query = query
      .eq("organization_id", escopo.organizationId)
      .eq("pipeline_type", escopo.pipelineType);
  }

  const { data, error } = await query;

  // Falha de leitura não pode impedir a criação: sem resposta, cai no
  // comportamento antigo (0) e a UNIQUE do banco continua sendo o gate real —
  // agora com uma mensagem honesta quando ela dispara.
  if (error) return 0;

  const maior = data?.[0]?.position;
  return typeof maior === "number" ? maior + 1 : 0;
}

/**
 * Traduz uma violação de unicidade de etapa para o que ela REALMENTE é.
 *
 * 🚨 O código antigo fazia `error.message?.includes("duplicate")` e devolvia
 * "Já existe uma etapa com esse nome" para QUALQUER `duplicate key`. Três
 * uniques convivem em `pipeline_stages` (medidas no PROD):
 *
 *   · `pipeline_stages_pipeline_id_stage_key_key`     (pipeline_id, stage_key)
 *   · `pipeline_stages_pipeline_id_position_key`      (pipeline_id, position)
 *   · `pipeline_stages_organization_id_pipeline_type_stage_key_key` (legada)
 *
 * Só a primeira e a terceira falam de NOME. A do meio falava de posição e
 * chegava ao usuário como nome duplicado — foi o que fez o defeito ser lido
 * como "o sistema não deixa repetir nome entre funis", coisa que o banco nunca
 * impôs para funis diferentes.
 */
export function mensagemDeConflitoDeEtapa(error: unknown): string | null {
  const mensagem =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";

  if (!mensagem.toLowerCase().includes("duplicate")) return null;

  if (mensagem.includes("_position_key")) {
    return "Não foi possível posicionar a etapa. Recarregue o funil e tente de novo.";
  }
  if (mensagem.includes("stage_key")) {
    return "Já existe uma etapa com esse nome neste funil";
  }
  return "Já existe uma etapa com esse nome neste funil";
}
