import type { ActionInput, ActionResult } from "./types.ts";
import { upsertPipeEntry, upsertPipeEntryDetailed, tryResolvePipelineId, updatePipeEntryById } from "../pipeline-adapter.ts";
import type { PipeSlug } from "../pipeline-adapter.ts";

const STANDARD_PIPES = ["whatsapp", "confirmacao", "propostas", "upsell_base", "upsell_gestao", "campanha"];

/** Teto de linhas lidas por `(pipeline_id, lead_id)` — espelha `PIPELINE_ENTRY_READ_CAP`. */
const CUSTOM_PIPE_ENTRY_READ_CAP = 50;

/**
 * Lê TODAS as entries de `(pipeline_id, lead_id)` em `custom_pipe_entries` e
 * devolve a corrente, tolerando N linhas.
 *
 * Este caminho é o do Copilot e dos workflows — roda sem ninguém olhando, o que
 * torna o defeito pior aqui do que na UI. Antes do M1 o par era único; depois
 * dele, `.maybeSingle()` com N linhas zera `data` e devolve PGRST116, o código
 * lia "não existe" e INSERIA outra: duplicador determinístico, automático.
 *
 * Regra do corrente: primeiro ABERTO; se todos fechados, o mais recente — a mesma
 * de `readActiveCustomPipeEntry` (`src/modules/pipelines/lib/stageTransition.ts`)
 * e de `pickActiveEntry` (`../pipeline-adapter.ts`), de propósito: se o Copilot e
 * o kanban discordarem sobre QUAL negócio é o corrente, a tela mostra um e a
 * automação move outro.
 *
 * "Aberto" vem do papel da etapa: `custom_pipe_entries` não tem `closed_at`.
 * Nunca mover um negócio GANHO para fora da etapa de ganho — é o que dispara
 * `sale_reversed`, que é irreversível (decisão G do CTO).
 */
async function readActiveCustomPipeEntry(
  supabase: ActionInput["supabase"],
  pipelineId: string,
  leadId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("custom_pipe_entries")
    .select("id, stage:custom_pipeline_stages(stage_role)")
    .eq("lead_id", leadId)
    .eq("pipeline_id", pipelineId)
    .order("stage_changed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(CUSTOM_PIPE_ENTRY_READ_CAP);

  // Falha de leitura NÃO pode virar "não existe": aqui isso criaria um negócio
  // duplicado a cada erro transitório, sem ninguém para desfazer.
  if (error) throw error;

  // `as unknown as` e não `as` direto: `stage:custom_pipeline_stages(stage_role)`
  // é embed MUITOS-PARA-UM (`custom_pipe_entries.stage_id → custom_pipeline_stages.id`),
  // então em tempo de execução o PostgREST devolve objeto (ou null) — que é o que
  // esta asserção diz. O parser de tipos do postgrest-js, porém, infere ARRAY para
  // embed com alias, e TS recusa a ponte entre os dois formatos (TS2352).
  //
  // A asserção descreve o runtime corretamente; o desvio por `unknown` é só para
  // atravessar a inferência. Trocar a query para agradar o parser mudaria
  // comportamento, e `isClosed` aqui embaixo decide se um negócio GANHO sai da
  // etapa de ganho — o gatilho de `sale_reversed`, irreversível (decisão G do CTO).
  const rows = (data ?? []) as unknown as Array<{ id: string; stage: { stage_role: string } | null }>;
  const isClosed = (row: (typeof rows)[number]) =>
    row.stage?.stage_role === "won" || row.stage?.stage_role === "lost";

  return rows.find((row) => !isClosed(row)) ?? rows[0] ?? null;
}

/**
 * Mover O NEGÓCIO QUE DISPAROU, quando a execução sabe qual é.
 *
 * ── POR QUE ISTO EXISTE ───────────────────────────────────────────────────
 * O caminho de sempre (`upsertPipeEntryDetailed`) trabalha por
 * `(lead, funil de destino)`: acha a entrada daquele lead naquele funil, e se
 * não houver, CRIA. Duas coisas erradas sob o ADR-0023:
 *
 *   1. **escolhe o negócio por chute.** Com dois negócios do mesmo lead, quem
 *      decide é `pickActiveEntry` ("o aberto, senão o mais recente") — e não o
 *      negócio cuja etapa mudou e acionou o workflow;
 *   2. **avançar de funil vira CÓPIA.** O card de origem fica onde está e nasce
 *      um gêmeo no destino. ADR-0023 §4 diz o contrário: "o Negócio guarda uma
 *      posição por vez, e avançar é um MOVE, não uma cópia". A tela já move —
 *      pela RPC `mover_negocio`, desde a fatia 2 do lead↔negócio. A automação
 *      continuava copiando, e é ela quem roda sem ninguém olhando.
 *
 * Devolve `null` quando não dá para agir pelo negócio (sem `entryId`, entrada
 * de outra org/outro lead, funil de destino inexistente). Aí o chamador cai no
 * caminho de sempre — degradar para o comportamento antigo é sempre melhor do
 * que não mover nada.
 */
async function moverNegocioQueDisparou(
  input: ActionInput,
  slug: PipeSlug,
  stageKey: string,
): Promise<ActionResult | null> {
  const { supabase, organizationId, leadId, entryId } = input;
  if (!entryId) return null;

  const { data: entry, error } = await supabase
    .from("pipeline_entries")
    .select("id, organization_id, lead_id, pipeline_id, stage_key")
    .eq("id", entryId)
    .maybeSingle();

  // Falha de LEITURA não pode virar "não tem negócio": cair no caminho antigo
  // por causa de um erro transitório é exatamente como se cria card duplicado.
  if (error) {
    return { success: false, error: `Falha ao ler o negócio ${entryId}: ${error.message}`, retryable: true };
  }
  if (!entry) return null;

  // Defesa em profundidade: este handler roda com service-role (RLS fora) e é
  // reusado por 30 tipos de ação. O `entryId` chega de um gatilho de banco, mas
  // conferir org e lead custa nada e fecha o caminho de um context forjado.
  if (entry.organization_id !== organizationId) return null;
  if (leadId && entry.lead_id !== leadId) return null;

  const alvo = await tryResolvePipelineId(supabase, organizationId, slug);
  if (!alvo) return null;

  // Mesmo funil: é só andar de etapa. Chamar `mover_negocio` aqui gastaria uma
  // RPC para escrever `pipeline_id` com o valor que já está lá.
  if (entry.pipeline_id === alvo) {
    const ok = await updatePipeEntryById(supabase, entryId, { stageKey });
    if (!ok) return { success: false, error: `Falha ao mover o negócio ${entryId} para ${stageKey}`, retryable: true };
    return {
      success: true,
      message: `Negócio movido para ${slug}/${stageKey}`,
      data: { target_stage: stageKey, target_pipe: slug, entry_id: entryId, moved: "stage" },
    };
  }

  // Funil diferente: MOVE de verdade, pela mesma RPC que a tela usa. Ela recusa
  // destino custom e destino de outra org, e é ela que passa pela etapa de
  // sucesso da origem quando o chamador pede — aqui não pedimos, porque quem
  // chamou já está NA etapa que disparou o workflow.
  const { error: rpcError } = await supabase.rpc("mover_negocio", {
    p_entry_id: entryId,
    p_target_pipeline_id: alvo,
    p_target_stage_key: stageKey,
    p_stage_origem: null,
    p_assigned_to: null,
  });

  if (rpcError) {
    return { success: false, error: `mover_negocio recusou: ${rpcError.message}`, retryable: true };
  }

  return {
    success: true,
    message: `Negócio movido para ${slug}/${stageKey}`,
    data: { target_stage: stageKey, target_pipe: slug, entry_id: entryId, moved: "pipeline" },
  };
}

export async function moveStage(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;

  if (!leadId) {
    return { success: false, error: "leadId é obrigatório para moveStage" };
  }

  const targetStage = params.target_stage as string;
  if (!targetStage) {
    return { success: false, error: "target_stage é obrigatório" };
  }

  const targetPipe = (params.target_pipe as string) || "whatsapp";
  const normalizedStage = String(targetStage).trim().toLowerCase();

  // Stage validation for standard pipes
  if (STANDARD_PIPES.includes(targetPipe) && targetPipe !== "upsell_base" && targetPipe !== "upsell_gestao" && targetPipe !== "campanha") {
    const { data: stages } = await supabase
      .from("pipeline_stages")
      .select("stage_key")
      .eq("organization_id", organizationId)
      .eq("pipeline_type", targetPipe)
      .eq("is_active", true);

    const validKeys = (stages || []).map((s: { stage_key: string }) => s.stage_key);
    if (validKeys.length > 0 && !validKeys.some((k: string) => k.toLowerCase() === normalizedStage)) {
      return {
        success: false,
        error: `Etapa inválida para funil ${targetPipe}. Válidas: ${validKeys.join(", ")}`,
      };
    }
  }

  const finalStage = normalizedStage;

  switch (targetPipe) {
    case "whatsapp":
    case "confirmacao":
    case "propostas": {
      // SCRUM-202: o espelho `leads.pipe_whatsapp` saiu daqui. O UPDATE em
      // `pipeline_entries` dispara `trg_sync_whatsapp_stage_to_lead` em depth 1
      // e grava a coluna com o mesmo valor — escrever de novo era duplicação.
      // Primeiro o negócio que disparou; o caminho por lead é o fallback.
      const doNegocio = await moverNegocioQueDisparou(input, targetPipe as PipeSlug, finalStage);
      if (doNegocio) return doNegocio;

      const result = await upsertPipeEntryDetailed(supabase, {
        leadId, orgId: organizationId, slug: targetPipe as PipeSlug, stageKey: finalStage,
      });
      if (result.status !== "created" && result.status !== "updated") {
        return { success: false, error: `Falha ao atualizar pipeline_entries para ${targetPipe}/${finalStage}` };
      }
      break;
    }
    case "upsell_base":
      await supabase.from("upsell_clients").update({ tipo_cliente_tempo: finalStage }).eq("lead_id", leadId);
      break;
    case "upsell_gestao":
      await supabase.from("upsell_clients").update({ gestao_stage: finalStage }).eq("lead_id", leadId);
      break;
    case "campanha": {
      const { data: campStage } = await supabase
        .from("campanha_stages")
        .select("id")
        .ilike("name", finalStage)
        .limit(1)
        .maybeSingle();
      if (campStage) {
        await supabase.from("campanha_leads").update({ stage_id: campStage.id }).eq("lead_id", leadId);
      }
      break;
    }
    default: {
      // Custom pipeline — targetPipe is the pipeline UUID
      const customPipelineId = targetPipe;
      const { data: stageRow } = await supabase
        .from("custom_pipeline_stages")
        .select("id, is_final_positive, target_pipeline_id, target_stage_id, target_pipe_type, target_stage_key")
        .eq("id", targetStage)
        .eq("pipeline_id", customPipelineId)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (!stageRow) {
        return { success: false, error: `Etapa customizada ${targetStage} não encontrada no pipeline ${customPipelineId}` };
      }

      const existingEntry = await readActiveCustomPipeEntry(supabase, customPipelineId, leadId);

      const now = new Date().toISOString();
      if (existingEntry) {
        await supabase
          .from("custom_pipe_entries")
          .update({ stage_id: targetStage, stage_changed_at: now })
          .eq("id", existingEntry.id);
      } else {
        await supabase.from("custom_pipe_entries").insert({
          lead_id: leadId,
          organization_id: organizationId,
          pipeline_id: customPipelineId,
          stage_id: targetStage,
          entered_at: now,
          stage_changed_at: now,
        });
      }

      // Auto-transition on is_final_positive
      if (stageRow.is_final_positive) {
        if (stageRow.target_pipeline_id && stageRow.target_stage_id) {
          const targetEntry = await readActiveCustomPipeEntry(
            supabase,
            stageRow.target_pipeline_id,
            leadId,
          );
          if (targetEntry) {
            await supabase.from("custom_pipe_entries")
              .update({ stage_id: stageRow.target_stage_id, stage_changed_at: now })
              .eq("id", targetEntry.id);
          } else {
            await supabase.from("custom_pipe_entries").insert({
              lead_id: leadId, organization_id: organizationId,
              pipeline_id: stageRow.target_pipeline_id, stage_id: stageRow.target_stage_id,
              entered_at: now, stage_changed_at: now,
            });
          }
        } else if (stageRow.target_pipe_type && stageRow.target_stage_key) {
          const transPipe = stageRow.target_pipe_type;
          const transStage = stageRow.target_stage_key;
          if (transPipe === "whatsapp" || transPipe === "confirmacao" || transPipe === "propostas") {
            // SCRUM-202: espelho `leads.pipe_whatsapp` removido — o
            // `upsertPipeEntry` abaixo já dispara o gatilho de sync.
            await upsertPipeEntry(supabase, {
              leadId, orgId: organizationId, slug: transPipe as PipeSlug, stageKey: transStage,
            });
          } else if (transPipe === "upsell_base") {
            await supabase.from("upsell_clients").update({ tipo_cliente_tempo: transStage }).eq("lead_id", leadId);
          } else if (transPipe === "upsell_gestao") {
            await supabase.from("upsell_clients").update({ gestao_stage: transStage }).eq("lead_id", leadId);
          }
        }
      }
      break;
    }
  }

  return {
    success: true,
    message: `Lead movido para ${finalStage} no funil ${targetPipe}`,
    data: { target_stage: finalStage, target_pipe: targetPipe },
  };
}
