import type { ActionInput, ActionResult } from "./types.ts";
import {
  upsertPipeEntry,
  upsertPipeEntryDetailed,
  updatePipeEntryById,
  resolvePipeline,
  isPipelineResolutionError,
} from "../pipeline-adapter.ts";
import type { PipeSlug, ResolvedPipeline } from "../pipeline-adapter.ts";

/** Slugs de funil de SISTEMA que têm caminho próprio (mover_negocio/upsert por slug). */
const SYSTEM_PIPE_SLUGS = ["whatsapp", "confirmacao", "propostas"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StageRow {
  id: string;
  stage_key: string;
  is_final_positive: boolean | null;
  target_pipeline_id: string | null;
  target_stage_id: string | null;
  target_pipe_type: string | null;
  target_stage_key: string | null;
}

const STAGE_COLUMNS =
  "id, stage_key, is_final_positive, target_pipeline_id, target_stage_id, target_pipe_type, target_stage_key";

/**
 * Resolve a etapa-alvo DENTRO do funil resolvido — aceita o UUID da etapa
 * (`pipeline_stages.id`, o que o editor novo grava) OU a `stage_key` legada
 * (o que todos os nós salvos carregam). `pipeline_stages` é a tabela ÚNICA de
 * etapas pós-20270906001000 — cobre funil de sistema e custom com uma consulta.
 *
 * Devolve `null` quando a etapa não existe no funil (o chamador decide se isso
 * é erro — paridade com o comportamento antigo: sistema só reprova quando o
 * funil TEM etapas cadastradas).
 */
async function resolveStageDoFunil(
  supabase: ActionInput["supabase"],
  organizationId: string,
  pipelineId: string,
  stageRef: string,
): Promise<{ match: StageRow | null; activeCount: number; activeKeys: string[] }> {
  const { data: rows } = await supabase
    .from("pipeline_stages")
    .select(STAGE_COLUMNS + ", is_active")
    .eq("pipeline_id", pipelineId)
    .eq("organization_id", organizationId);

  // `as unknown as`: o select é string dinâmica (STAGE_COLUMNS + is_active) e o
  // parser do postgrest-js não infere as colunas — a asserção descreve o runtime.
  const all = (rows ?? []) as unknown as Array<StageRow & { is_active: boolean | null }>;
  const ativas = all.filter((s) => s.is_active !== false);
  const wanted = stageRef.trim();

  // Por UUID casa qualquer linha (paridade com o `.eq("id", ...)` antigo do
  // ramo custom, que não filtrava is_active); por key só etapa ATIVA (paridade
  // com o validador antigo do ramo sistema), case-insensitive.
  const match = UUID_RE.test(wanted)
    ? all.find((s) => s.id === wanted) ?? null
    : ativas.find((s) => s.stage_key?.toLowerCase() === wanted.toLowerCase()) ?? null;

  return { match, activeCount: ativas.length, activeKeys: ativas.map((s) => s.stage_key) };
}

/** Teto de linhas lidas por `(pipeline_id, lead_id)` — espelha `PIPELINE_ENTRY_READ_CAP`. */
const CUSTOM_PIPE_ENTRY_READ_CAP = 50;

/**
 * Lê TODAS as entries de `(pipeline_id, lead_id)` na projeção canônica e
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
 * "Aberto" vem do papel da etapa projetado em `negocio_projetado`.
 * Nunca mover um negócio GANHO para fora da etapa de ganho — é o que dispara
 * `sale_reversed`, que é irreversível (decisão G do CTO).
 */
async function readActiveCustomPipeEntry(
  supabase: ActionInput["supabase"],
  organizationId: string,
  pipelineId: string,
  leadId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("negocio_projetado")
    .select("id, stage_role")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .eq("pipeline_id", pipelineId)
    .eq("pipeline_type", "custom")
    .order("stage_changed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(CUSTOM_PIPE_ENTRY_READ_CAP);

  // Falha de leitura NÃO pode virar "não existe": aqui isso criaria um negócio
  // duplicado a cada erro transitório, sem ninguém para desfazer.
  if (error) throw error;

  const rows = (data ?? []) as Array<{ id: string; stage_role: string | null }>;
  const isClosed = (row: (typeof rows)[number]) =>
    row.stage_role === "won" || row.stage_role === "lost";

  return rows.find((row) => !isClosed(row)) ?? rows[0] ?? null;
}

/**
 * Põe o lead na etapa do funil custom: anda o card aberto se houver, senão cria.
 *
 * Ler e depois criar não é atômico — webhook e outra execução podem criar o
 * card entre as duas coisas. O índice `uq_pipeline_entries_um_card_sem_negocio`
 * recusa o segundo com 23505; aí o card de quem ganhou É o card, e relemos
 * para andar com ele em vez de falhar a ação.
 */
async function moverOuCriarCardCustom(
  supabase: ActionInput["supabase"],
  organizationId: string,
  pipelineId: string,
  leadId: string,
  stageId: string,
  now: string,
): Promise<void> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const existingEntry = await readActiveCustomPipeEntry(supabase, organizationId, pipelineId, leadId);
    if (existingEntry) {
      const { error } = await supabase.rpc("fn_entrada_custom_atualizar", {
        p_entry_id: existingEntry.id,
        p_patch: { stage_id: stageId, stage_changed_at: now },
      });
      if (error) throw error;
      return;
    }
    const { error } = await supabase.rpc("fn_entrada_custom_criar", {
      p_lead_id: leadId,
      p_organization_id: organizationId,
      p_pipeline_id: pipelineId,
      p_stage_id: stageId,
      p_entered_at: now,
      p_stage_changed_at: now,
    });
    if (!error) return;
    if (error.code !== "23505" || tentativa > 0) throw error;
  }
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
  alvo: ResolvedPipeline,
  stageKey: string,
): Promise<ActionResult | null> {
  const { supabase, organizationId, leadId, entryId } = input;
  const slug: PipeSlug = alvo.slug;
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

  // Mesmo funil: é só andar de etapa. Chamar `mover_negocio` aqui gastaria uma
  // RPC para escrever `pipeline_id` com o valor que já está lá.
  if (entry.pipeline_id === alvo.id) {
    const ok = await updatePipeEntryById(supabase, entryId, { stageKey });
    if (!ok) return { success: false, error: `Falha ao mover o negócio ${entryId} para ${stageKey}`, retryable: true };
    return {
      success: true,
      message: `Negócio movido para ${slug}/${stageKey}`,
      data: { target_stage: stageKey, target_pipe: slug, entry_id: entryId, moved: "stage" },
    };
  }

  // Funil diferente: MOVE de verdade, pela mesma RPC que a tela usa. Ela recusa
  // destino de outra org, e é ela que passa pela etapa de sucesso da origem
  // quando o chamador pede — aqui não pedimos, porque quem chamou já está NA
  // etapa que disparou o workflow. Destino CUSTOM é aceito desde
  // `20271119000002_preserve_closed_card_on_forwarding.sql`: a RPC valida a
  // etapa em `pipeline_stages`, que é a tabela única pós-20270906001000.
  // Card sem negócio indo para funil onde o lead já tem um é FUNDIDO no de lá:
  // a RPC devolve o id que sobreviveu, e é ele que vai no resultado.
  const { data: movedId, error: rpcError } = await supabase.rpc("mover_negocio", {
    p_entry_id: entryId,
    p_target_pipeline_id: alvo.id,
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
    data: {
      target_stage: stageKey,
      target_pipe: slug,
      entry_id: typeof movedId === "string" ? movedId : entryId,
      moved: "pipeline",
    },
  };
}

/**
 * O ÚNICO negócio aberto do lead fora do funil de destino, se houver exatamente um.
 *
 * Existe por causa do gatilho da pessoa (`lead_created` e irmãos): ele não tem
 * `entryId` (`types.ts:20`), então `moverNegocioQueDisparou` não sabe qual card
 * mover e o ramo custom acabava CRIANDO um — o lead ficava com um card aberto
 * em cada funil (chamado 52b4f4ca, Rafthel).
 *
 * Quando o lead tem um só negócio aberto, não há o que chutar: é aquele. Com
 * zero ou com dois ou mais, devolve `null` e o chamador faz o de sempre —
 * escolher por heurística qual dos dois sai do funil seria pior que duplicar.
 *
 * Três recusas deliberadas:
 *   · negócio GANHO/PERDIDO não é candidato. Tirar um ganho da etapa de ganho
 *     dispara `sale_reversed`, que é irreversível (decisão G do CTO);
 *   · se o lead JÁ tem card aberto no destino, manda o de lá — o lead já está
 *     aqui, e esvaziar um funil que ninguém citou não é o pedido;
 *   · só funil `custom`. Puxar o card para fora de um funil de SISTEMA
 *     (whatsapp/confirmacao/propostas) tem semântica e espelhos próprios; fica
 *     de fora até ser pedido.
 */
async function acharNegocioAbertoUnicoForaDoDestino(
  input: ActionInput,
  destinoPipelineId: string,
): Promise<string | null> {
  const { supabase, organizationId, leadId } = input;
  if (!leadId) return null;

  const { data, error } = await supabase
    .from("negocio_projetado")
    .select("id, pipeline_id, stage_role")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .eq("pipeline_type", "custom")
    .limit(CUSTOM_PIPE_ENTRY_READ_CAP);

  // Mesma regra do resto do arquivo: falha de leitura não pode virar "não tem
  // negócio", senão um soluço de rede vira card duplicado permanente.
  if (error) throw error;

  const rows = (data ?? []) as Array<{ id: string; pipeline_id: string; stage_role: string | null }>;
  // `stage_role` nulo conta como aberto — mesma leitura de `readActiveCustomPipeEntry`.
  const abertos = rows.filter((row) => row.stage_role !== "won" && row.stage_role !== "lost");

  if (abertos.some((row) => row.pipeline_id === destinoPipelineId)) return null;
  return abertos.length === 1 ? abertos[0].id : null;
}

/**
 * Move o negócio do lead para a etapa pedida de um funil CUSTOM, quando dá para
 * saber qual negócio é. Devolve `null` quando não dá — aí o chamador cai no
 * `moverOuCriarCardCustom` de sempre.
 */
async function moverNegocioEmFunilCustom(
  input: ActionInput,
  alvo: ResolvedPipeline,
  stageKey: string,
): Promise<ActionResult | null> {
  const doGatilho = await moverNegocioQueDisparou(input, alvo, stageKey);
  if (doGatilho) return doGatilho;

  // Veio `entryId` e ele não serviu (outra org, outro lead, inexistente): não
  // é hora de eleger OUTRO card — o contexto já disse qual era, e estava errado.
  if (input.entryId) return null;

  const unico = await acharNegocioAbertoUnicoForaDoDestino(input, alvo.id);
  if (!unico) return null;

  return await moverNegocioQueDisparou({ ...input, entryId: unico }, alvo, stageKey);
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

  const targetPipeRef = String((params.target_pipe as string) || "").trim();
  if (!targetPipeRef) {
    return { success: false, error: "No target funnel configured" };
  }
  const rawStageRef = String(targetStage).trim();
  const normalizedStage = rawStageRef.toLowerCase();

  // ── Destinos que NÃO são funil (fora do adapter, comportamento inalterado) ──
  if (targetPipeRef === "upsell_base") {
    await supabase.from("upsell_clients").update({ tipo_cliente_tempo: normalizedStage }).eq("lead_id", leadId);
    return {
      success: true,
      message: `Lead movido para ${normalizedStage} no funil ${targetPipeRef}`,
      data: { target_stage: normalizedStage, target_pipe: targetPipeRef },
    };
  }
  if (targetPipeRef === "upsell_gestao") {
    await supabase.from("upsell_clients").update({ gestao_stage: normalizedStage }).eq("lead_id", leadId);
    return {
      success: true,
      message: `Lead movido para ${normalizedStage} no funil ${targetPipeRef}`,
      data: { target_stage: normalizedStage, target_pipe: targetPipeRef },
    };
  }
  if (targetPipeRef === "campanha") {
    const { data: campStage } = await supabase
      .from("campanha_stages")
      .select("id")
      .ilike("name", normalizedStage)
      .limit(1)
      .maybeSingle();
    if (campStage) {
      await supabase.from("campanha_leads").update({ stage_id: campStage.id }).eq("lead_id", leadId);
    }
    return {
      success: true,
      message: `Lead movido para ${normalizedStage} no funil ${targetPipeRef}`,
      data: { target_stage: normalizedStage, target_pipe: targetPipeRef },
    };
  }

  // ── Funil de verdade: UMA resolução para qualquer ref (SCRUM-627) ──────────
  // uuid (sistema OU custom), slug, alias legado (`pipe_whatsapp`,
  // `qualificacao`) — tudo passa pelo `resolvePipeline` do adapter (SCRUM-623).
  //
  // Degradações que MUDARAM aqui, de propósito:
  //   · uuid/slug inexistente: antes caía no ramo custom e morria em "Etapa
  //     customizada não encontrada"; agora o erro é tipado e nomeia o funil.
  //   · funil INATIVO: antes o ramo custom movia mesmo assim; agora recusa
  //     (`pipeline_inactive`) — mover card para funil desligado é escrever onde
  //     ninguém olha.
  //   · falha transitória de lookup: `retryable: true`, o pool tenta de novo.
  let pipeline: ResolvedPipeline;
  try {
    pipeline = await resolvePipeline(supabase, organizationId, targetPipeRef);
  } catch (e) {
    if (isPipelineResolutionError(e)) {
      return {
        success: false,
        error: `Funil de destino não resolvido (${e.code}): "${targetPipeRef}"`,
        retryable: e.code === "pipeline_lookup_failed",
      };
    }
    throw e;
  }

  const { match: stageRow, activeCount, activeKeys } = await resolveStageDoFunil(
    supabase, organizationId, pipeline.id, rawStageRef,
  );

  // Funil de sistema tem caminho próprio por causa do fallback: quando não dá
  // para agir pelo negócio, aqui se cai no `upsertPipeEntryDetailed` (por slug
  // de sistema), e no ramo custom no `moverOuCriarCardCustom` (por stage_id).
  // O MOVE em si é o mesmo nos dois desde o chamado 52b4f4ca — `mover_negocio`
  // aceita destino custom. O gate é por SLUG, não por `type` (ADR-0034: type
  // não decide comportamento; o slug de sistema é único por org).
  if (SYSTEM_PIPE_SLUGS.includes(pipeline.slug)) {
    // Paridade com o validador antigo: funil sem NENHUMA etapa cadastrada não
    // reprova (o executor sempre foi permissivo aqui — ver node-requirements).
    if (!stageRow && activeCount > 0) {
      return {
        success: false,
        error: `Etapa inválida para funil ${pipeline.slug}. Válidas: ${activeKeys.join(", ")}`,
      };
    }
    const finalStage = stageRow?.stage_key ?? normalizedStage;

    // SCRUM-202: o espelho `leads.pipe_whatsapp` saiu daqui. O UPDATE em
    // `pipeline_entries` dispara `trg_sync_whatsapp_stage_to_lead` em depth 1
    // e grava a coluna com o mesmo valor — escrever de novo era duplicação.
    // Primeiro o negócio que disparou; o caminho por lead é o fallback.
    const doNegocio = await moverNegocioQueDisparou(input, pipeline, finalStage);
    if (doNegocio) return doNegocio;

    const result = await upsertPipeEntryDetailed(supabase, {
      leadId, orgId: organizationId, slug: pipeline.id, stageKey: finalStage,
    });
    if (result.status !== "created" && result.status !== "updated") {
      return { success: false, error: `Falha ao atualizar pipeline_entries para ${pipeline.slug}/${finalStage}` };
    }
    return {
      success: true,
      message: `Lead movido para ${finalStage} no funil ${pipeline.slug}`,
      data: { target_stage: finalStage, target_pipe: targetPipeRef },
    };
  }

  // ── Funil custom ────────────────────────────────────────────────────────────
  // A etapa aqui é obrigatória de verdade (o INSERT/UPDATE grava `stage_id`):
  // sem linha, o comportamento antigo já era erro — mantido, agora aceitando
  // stage_key além do uuid.
  if (!stageRow) {
    return {
      success: false,
      error: `Etapa customizada ${rawStageRef} não encontrada no pipeline ${pipeline.id}`,
    };
  }

  const now = new Date().toISOString();

  // ── Avançar é MOVE, não cópia (ADR-0023 §4) ────────────────────────────────
  // Antes do chamado 52b4f4ca só o ramo de sistema tentava mover o negócio; o
  // custom ia direto para o upsert, que põe o lead no destino e deixa o card de
  // origem onde está — duas posições abertas para o mesmo negócio.
  //
  // A etapa vai pela KEY, não pelo uuid: a RPC grava o que receber em
  // `stage_key`, e um uuid cru ali é o bug do card invisível que a SCRUM-617
  // teve que curar. O par fica coerente porque o espelho `trg_pe_stage_mirror`
  // re-resolve `stage_id` a partir de (pipeline_id, stage_key).
  // Sem `stage_key` utilizável sobra o caminho por `stage_id`, que é exato.
  const stageKeyAlvo = (stageRow.stage_key ?? "").trim();
  const movido = stageKeyAlvo ? await moverNegocioEmFunilCustom(input, pipeline, stageKeyAlvo) : null;
  if (movido && !movido.success) return movido;

  if (!movido) {
    await moverOuCriarCardCustom(supabase, organizationId, pipeline.id, leadId, stageRow.id, now);
  }

  // Auto-transition on is_final_positive
  if (stageRow.is_final_positive) {
    if (stageRow.target_pipeline_id && stageRow.target_stage_id) {
      await moverOuCriarCardCustom(
        supabase, organizationId, stageRow.target_pipeline_id, leadId, stageRow.target_stage_id, now,
      );
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

  return {
    success: true,
    message: `Lead movido para ${stageRow.stage_key || stageRow.id} no funil ${pipeline.name}`,
    data: {
      target_stage: rawStageRef,
      target_pipe: targetPipeRef,
      // Aditivo: `target_stage`/`target_pipe` seguem no formato de sempre (ref
      // cru), e quem moveu acrescenta o card que sobreviveu — a RPC funde
      // quando o destino já tinha um, então o id pode não ser o de entrada.
      ...(movido ? { entry_id: movido.data?.entry_id, moved: movido.data?.moved } : {}),
    },
  };
}
