import type { ActionInput, ActionResult } from "./types.ts";
import { getPipeEntry } from "../pipeline-adapter.ts";

/**
 * create_deal — cria um negócio (`deals`) vinculado ao lead da execução.
 *
 * Guardas:
 * - lead obrigatório (o negócio nasce vinculado — `source_lead_id`)
 * - `dealSkipIfOpenExists` (default true): não cria segundo negócio ABERTO para o lead
 * - `metadata.workflow_execution_id` marca a origem → o trigger `deal_created`
 *   propaga como parent execution e o chain_depth (máx. 5) corta o laço
 *   create_deal → deal_created → create_deal.
 */
export async function createDeal(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;

  if (!leadId) {
    return { success: false, error: "create_deal requires a lead in the execution", retryable: false };
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, name, company, responsible_id, sdr_id, closer_id, sale_responsible_id, pre_sale_responsible_id")
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (leadError) return { success: false, error: leadError.message };
  if (!lead) return { success: false, error: `Lead ${leadId} not found in org`, retryable: false };

  // ── Dedup: negócio aberto já existente ──
  const skipIfOpen = params.dealSkipIfOpenExists !== false;
  if (skipIfOpen) {
    const { data: existing } = await supabase
      .from("deals")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("source_lead_id", leadId)
      .is("won", null)
      .is("deleted_at", null)
      .limit(1);

    if (existing?.length) {
      return {
        success: true,
        message: `Skipped: lead already has an open deal (${existing[0].id})`,
        data: { deal_id: existing[0].id, skipped: true },
      };
    }
  }

  // ── Título (já resolvido pelo router; fallback defensivo) ──
  const title =
    (params.dealTitleTemplate as string)?.trim() ||
    `Negócio — ${lead.name ?? lead.company ?? "sem nome"}`;

  // ── Valor: fixo ou o valor da proposta (pipeline_entries propostas → metadata.sale_value) ──
  let value = 0;
  if (params.dealValueMode === "proposal") {
    const propEntry = await getPipeEntry(supabase, leadId, organizationId, "propostas");
    const saleValue = (propEntry?.metadata as Record<string, unknown> | undefined)?.sale_value;
    value = Number(saleValue ?? 0) || 0;
  } else {
    value = Number(params.dealValue ?? 0) || 0;
  }

  // ── Responsável ──
  const ownerId =
    params.dealOwnerMode === "specific"
      ? ((params.dealOwnerId as string) || null)
      : (lead.responsible_id ||
         lead.sale_responsible_id ||
         lead.closer_id ||
         lead.pre_sale_responsible_id ||
         lead.sdr_id ||
         null);

  // ── Previsão de fechamento ──
  const closeDays = Number(params.dealExpectedCloseDays ?? 0) || 0;
  const expectedCloseDate =
    closeDays > 0
      ? new Date(Date.now() + closeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : null;

  const probabilityRaw = Number(params.dealProbability ?? 50);
  const probability = Number.isFinite(probabilityRaw)
    ? Math.min(100, Math.max(0, Math.round(probabilityRaw)))
    : 50;

  const { data: deal, error } = await supabase
    .from("deals")
    .insert({
      organization_id: organizationId,
      title,
      value,
      probability,
      owner_id: ownerId,
      source_lead_id: leadId,
      // Procedência canônica (CHECK deals_source_check + trigger fn_deals_exige_procedencia)
      source: "workflow",
      expected_close_date: expectedCloseDate,
      notes: (params.dealNotes as string) || null,
      metadata: {
        created_by: "workflow",
        workflow_execution_id: (params._executionId as string) ?? null,
      },
    })
    .select("id, title, value")
    .single();

  if (error) return { success: false, error: error.message };

  return {
    success: true,
    message: `Deal "${deal.title}" created`,
    data: {
      deal_id: deal.id,
      negocio_id: deal.id,
      negocio_titulo: deal.title,
      negocio_valor: deal.value,
    },
  };
}

// ─── O vocabulário do Negócio (fatia 5) ─────────────────────────────────────
//
// Até aqui a categoria "Negócios" do editor tinha UM gatilho e UMA ação, e
// nenhum dos 130 workflows ativos usava. "Quando ganhar o negócio, faça X" não
// era desenhável. Estas quatro ações fecham o mínimo: encerrar (dos dois
// jeitos), corrigir o valor e trocar o dono.
//
// ── GANHAR E PERDER SÃO MOVIMENTOS, NÃO CAMPOS ─────────────────────────────
// ADR-0023 §4/§5: a posição mora no card e avançar é um move. Encerrar é chegar
// na etapa terminal do funil — é o que os botões "Ganhou"/"Perdeu" do card do
// Negócio fazem. Escrever `deals.won` sem mover deixaria o card parado numa
// etapa aberta com o negócio marcado como fechado: duas verdades sobre a mesma
// coisa, que é o defeito que o ADR foi escrito para matar.
//
// `deals.won` é atualizado JUNTO quando existe linha em `deals`, porque a
// Carteira e o ledger leem de lá. Mas ele é consequência, não a fonte.

/** A etapa terminal do funil do negócio, pelo papel. */
async function etapaTerminal(
  supabase: ActionInput["supabase"],
  pipelineId: string,
  organizationId: string,
  papel: "won" | "lost",
): Promise<string | null> {
  const { data: pipeline } = await supabase
    .from("pipelines")
    .select("slug, type")
    .eq("id", pipelineId)
    .maybeSingle();

  if (pipeline?.type === "system") {
    const { data } = await supabase
      .from("pipeline_stages")
      .select("stage_key")
      .eq("organization_id", organizationId)
      .eq("pipeline_type", pipeline.slug)
      .eq("stage_role", papel)
      .eq("is_active", true)
      .order("position")
      .limit(1)
      .maybeSingle();
    return (data?.stage_key as string) ?? null;
  }

  const { data } = await supabase
    .from("custom_pipeline_stages")
    .select("stage_key")
    .eq("pipeline_id", pipelineId)
    .eq("stage_role", papel)
    .order("position")
    .limit(1)
    .maybeSingle();
  return (data?.stage_key as string) ?? null;
}

async function encerrarNegocio(input: ActionInput, papel: "won" | "lost"): Promise<ActionResult> {
  const { supabase, organizationId, entryId, params } = input;
  const rotulo = papel === "won" ? "ganhar" : "perder";

  if (!entryId) {
    // Sem negócio declarado não há o que encerrar — e escolher um por chute é
    // o erro mais caro possível aqui: fecharia a venda errada.
    return {
      success: false,
      error: `Nenhum negócio na execução — ${rotulo} exige um gatilho de funil`,
      retryable: false,
    };
  }

  const { data: entry, error } = await supabase
    .from("pipeline_entries")
    .select("id, organization_id, pipeline_id, stage_key, deal_id")
    .eq("id", entryId)
    .maybeSingle();

  if (error) return { success: false, error: error.message, retryable: true };
  if (!entry || entry.organization_id !== organizationId) {
    return { success: false, error: `Negócio ${entryId} não encontrado nesta organização`, retryable: false };
  }

  const destino = await etapaTerminal(supabase, entry.pipeline_id as string, organizationId, papel);
  if (!destino) {
    // 83 funis custom em prod não têm etapa terminal. Falhar explícito é melhor
    // que inventar uma: o card ficaria num limbo que ninguém desenhou.
    return {
      success: false,
      error: `O funil deste negócio não tem etapa de ${papel === "won" ? "ganho" : "perda"}`,
      retryable: false,
    };
  }

  if (entry.stage_key === destino) {
    return {
      success: true,
      message: `Negócio já estava em ${destino}`,
      data: { entry_id: entryId, stage: destino, idempotent: true },
    };
  }

  const { error: upErr } = await supabase
    .from("pipeline_entries")
    .update({ stage_key: destino })
    .eq("id", entryId);
  if (upErr) return { success: false, error: upErr.message, retryable: true };

  if (entry.deal_id) {
    const patch: Record<string, unknown> = { won: papel === "won", closed_at: new Date().toISOString() };
    if (papel === "lost" && typeof params.lossReason === "string" && params.lossReason.trim()) {
      patch.loss_reason = params.lossReason.trim();
    }
    // Falha aqui NÃO derruba a ação: a posição — que é a verdade (ADR-0023 §5)
    // — já foi escrita, e reportar erro faria o motor retentar um move que já
    // aconteceu.
    const { error: dealErr } = await supabase.from("deals").update(patch).eq("id", entry.deal_id);
    if (dealErr) console.warn(`[deal-operations] ${rotulo}: posição movida mas deals não atualizou:`, dealErr.message);
  }

  return {
    success: true,
    message: `Negócio movido para ${destino}`,
    data: { entry_id: entryId, stage: destino, deal_id: entry.deal_id ?? null },
  };
}

/** `win_deal` — encerra o negócio da execução como ganho. */
export function winDeal(input: ActionInput): Promise<ActionResult> {
  return encerrarNegocio(input, "won");
}

/** `lose_deal` — encerra o negócio da execução como perdido. */
export function loseDeal(input: ActionInput): Promise<ActionResult> {
  return encerrarNegocio(input, "lost");
}

/**
 * `set_deal_value` — grava o valor do negócio.
 *
 * Exige linha em `deals`: valor é dinheiro e mora na identidade, não na
 * posição. 26% dos cards não têm essa linha, e para eles a ação falha dizendo
 * isso — melhor que gravar em `metadata` e criar uma segunda fonte de valor.
 */
export async function setDealValue(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, dealId, params } = input;

  if (!dealId) {
    return { success: false, error: "Nenhum negócio com identidade na execução — set_deal_value exige `deals`", retryable: false };
  }

  const bruto = params.dealValue ?? params.value;
  const valor = Number(bruto);
  if (!Number.isFinite(valor) || valor < 0) {
    return { success: false, error: `Valor inválido: ${String(bruto)}`, retryable: false };
  }

  const { error } = await supabase
    .from("deals")
    .update({ value: valor })
    .eq("id", dealId)
    .eq("organization_id", organizationId);

  if (error) return { success: false, error: error.message, retryable: true };
  return { success: true, message: `Valor do negócio: ${valor}`, data: { deal_id: dealId, value: valor } };
}

/**
 * `set_deal_owner` — troca o dono do negócio.
 *
 * Escreve nos DOIS lugares de propósito: `deals.owner_id` é quem responde pelo
 * dinheiro, `pipeline_entries.assigned_to` é quem aparece no card. Deixar um só
 * atualizado é como o board e o relatório passam a discordar sobre de quem é a
 * venda.
 */
export async function setDealOwner(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, entryId, dealId, params } = input;

  const ownerId = (params.dealOwnerId as string) || (params.ownerId as string) || null;
  if (!ownerId) return { success: false, error: "dealOwnerId não configurado no nó", retryable: false };

  const { data: membro } = await supabase
    .from("team_members")
    .select("id, organization_id")
    .eq("id", ownerId)
    .maybeSingle();
  if (!membro || membro.organization_id !== organizationId) {
    return { success: false, error: "Responsável não pertence a esta organização", retryable: false };
  }

  if (!entryId && !dealId) {
    return { success: false, error: "Nenhum negócio na execução", retryable: false };
  }

  if (entryId) {
    const { error } = await supabase
      .from("pipeline_entries")
      .update({ assigned_to: ownerId })
      .eq("id", entryId)
      .eq("organization_id", organizationId);
    if (error) return { success: false, error: error.message, retryable: true };
  }

  if (dealId) {
    const { error } = await supabase
      .from("deals")
      .update({ owner_id: ownerId })
      .eq("id", dealId)
      .eq("organization_id", organizationId);
    if (error) return { success: false, error: error.message, retryable: true };
  }

  return { success: true, message: "Responsável do negócio atualizado", data: { entry_id: entryId ?? null, deal_id: dealId ?? null, owner_id: ownerId } };
}
