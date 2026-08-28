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
// ── DESFECHO É FATO DO NEGÓCIO, POSIÇÃO É FATO DO CARD ─────────────────────
// ADR-0023, Emenda 1 (2026-08-28). O bloco anterior dizia o contrário —
// "ganhar e perder são movimentos, não campos; encerrar é chegar na etapa
// terminal" — e aquilo era verdade enquanto o desfecho fosse DERIVADO da etapa.
//
// Deixou de ser. `deals.outcome` (open|won|lost) é a fonte, e o card não se
// move ao ganhar. As duas perguntas são diferentes e cada uma tem UMA resposta:
//
//   Onde está o Negócio?     pipeline_entries.stage_key
//   Ganhou ou perdeu?        deals.outcome
//
// O "duas verdades" que o ADR original combatia era duas respostas para a MESMA
// pergunta — foi por isso que `deals.pipeline_id`/`stage_id` caíram. Desfecho
// nunca foi posição.
//
// O que forçou: 283 dos 396 funis ativos (71%) não têm etapa `won`, e a versão
// anterior desta ação — que movia o card para a etapa terminal — falhava em
// todos eles, pedindo ao usuário que remodelasse o funil para caber na
// ferramenta.
//
// `deals.won` continua atualizado, por TRIGGER, porque oito arquivos do front o
// leem. Ele é espelho, nunca fonte.

async function encerrarNegocio(input: ActionInput, papel: "won" | "lost"): Promise<ActionResult> {
  const { supabase, organizationId, entryId, dealId: dealIdDaExecucao, params } = input;
  const rotulo = papel === "won" ? "ganhar" : "perder";

  if (!entryId && !dealIdDaExecucao) {
    // Sem negócio declarado não há o que encerrar — e escolher um por chute é
    // o erro mais caro possível aqui: fecharia a venda errada.
    return {
      success: false,
      error: `Nenhum negócio na execução — ${rotulo} exige um gatilho de funil`,
      retryable: false,
    };
  }

  // ── O negócio, materializando a linha se preciso ──────────────────────────
  //
  // ANTES desta versão, a ação movia o card para a etapa terminal do funil. Ela
  // falhava em 283 dos 396 funis ativos (71%), que não têm etapa `won` — e a
  // mensagem "o funil não tem etapa de ganho" pedia ao usuário que remodelasse
  // o funil para caber na ferramenta.
  //
  // Agora o desfecho mora no NEGÓCIO (migration 20270904000000). O card NÃO se
  // move: ganhar é um fato sobre o negócio, não uma posição no board, e é isso
  // que permite ganhar em qualquer etapa.
  let dealId = dealIdDaExecucao ?? null;
  // Nomeado em vez de inline: com `| null` na inicialização, `typeof entry`
  // colapsa para `never` e o acesso a `deal_id` lá embaixo não compila.
  type EntradaMinima = { id: string; organization_id: string; deal_id: string | null };
  let entry: EntradaMinima | null = null;

  if (!dealId && entryId) {
    const { data, error } = await supabase
      .from("pipeline_entries")
      .select("id, organization_id, deal_id")
      .eq("id", entryId)
      .maybeSingle();

    if (error) return { success: false, error: error.message, retryable: true };
    if (!data || data.organization_id !== organizationId) {
      return { success: false, error: `Negócio ${entryId} não encontrado nesta organização`, retryable: false };
    }
    entry = data as EntradaMinima;
    dealId = (data.deal_id as string | null) ?? null;

    if (!dealId) {
      // 26,6% das entradas em prod não têm linha em `deals`. Decisão do CTO
      // (2026-08-28): materializar em vez de falhar — o workflow não pode
      // quebrar por um detalhe de modelagem que o usuário não conhece.
      const { data: novoId, error: gerErr } = await supabase
        .rpc("garantir_negocio_da_entrada", { p_entry_id: entryId });
      if (gerErr) return { success: false, error: gerErr.message, retryable: true };
      dealId = novoId as unknown as string;
    }
  }

  if (!dealId) {
    return { success: false, error: `Não foi possível resolver o negócio para ${rotulo}`, retryable: false };
  }

  // ── Idempotência ──────────────────────────────────────────────────────────
  //
  // Lida ANTES de escrever, e não por conta do custo: escrever `outcome` que já
  // vale dispara a transição, e a transição é o que grava no caderno de vendas.
  // Como o caderno é append-only (ADR-0017 §4), um retry do motor viraria uma
  // segunda venda que ninguém consegue apagar.
  const { data: atual, error: leituraErr } = await supabase
    .from("deals")
    .select("id, outcome, organization_id")
    .eq("id", dealId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (leituraErr) return { success: false, error: leituraErr.message, retryable: true };
  if (!atual) {
    return { success: false, error: `Negócio ${dealId} não encontrado nesta organização`, retryable: false };
  }

  if (atual.outcome === papel) {
    return {
      success: true,
      message: `Negócio já estava como ${papel === "won" ? "ganho" : "perdido"}`,
      data: { deal_id: dealId, outcome: papel, idempotent: true },
    };
  }

  const patch: Record<string, unknown> = {
    outcome: papel,
    outcome_source: "workflow",
    outcome_at: new Date().toISOString(),
  };
  if (papel === "lost" && typeof params.lossReason === "string" && params.lossReason.trim()) {
    patch.loss_reason = params.lossReason.trim();
  }

  const { error: upErr } = await supabase
    .from("deals")
    .update(patch)
    .eq("id", dealId)
    .eq("organization_id", organizationId)
    // Trava de concorrência: se outro caminho decidiu o desfecho entre a leitura
    // e esta escrita, o UPDATE não pega linha nenhuma e nada é gravado no
    // caderno. Sem isso, dois workflows no mesmo negócio emitem duas vendas.
    .eq("outcome", atual.outcome);

  if (upErr) return { success: false, error: upErr.message, retryable: true };

  return {
    success: true,
    message: `Negócio marcado como ${papel === "won" ? "ganho" : "perdido"}`,
    data: {
      deal_id: dealId,
      entry_id: entryId ?? null,
      outcome: papel,
      // O card fica onde está — ganhar não é mais uma posição no board.
      moved: false,
      deal_materializado: entry?.deal_id === null,
    },
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
