/**
 * Shared helpers for WhatsApp action handlers.
 * Extracted from workflow-action-handler.ts to be reused by all send_whatsapp_* handlers.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getTimeBasedVariables } from "../time-variables.ts";
import { getPipeEntry } from "../pipeline-adapter.ts";
import { getStageDoNegocio, entryIdDoContexto } from "../negocio-subject.ts";
import { getWhatsAppProvider } from "../whatsapp-client.ts";
import { personalizationName, personalizationFirstName, isPlaceholderLeadName, tidyEmptyVarGaps } from "../lead-name.ts";
import { normalizeBrazilianPhone } from "../whatsapp-dispatch.ts";
import type { ActionResult } from "./types.ts";
import {
  resolveRoutedInstance,
  isInstanceLive,
  type RoutedInstance,
  type RoutingNodeConfig,
} from "../instance-routing.ts";

/** Reexport: a definição de "instância viva" mora em `_shared/instance-routing.ts`. */
export { isInstanceLive };

// ─── WhatsApp instance resolution ──────────────────────────────────────────

/**
 * Resultado da resolução, no formato que o handler já devolve. Falha vira
 * `ActionResult` não-retentável, nunca exceção: o executor lê `retryable` para
 * decidir se reenvia, e uma exceção atravessando a fronteira do handler
 * quebraria esse contrato.
 */
export type InstanceResolution =
  | { ok: true; instanceId: string; instanceName: string; instance: RoutedInstance }
  | { ok: false; failure: ActionResult };

/**
 * Resolve a Instance de saída do nó, obedecendo a Instance Routing Policy
 * declarada nele (ADR-0025).
 *
 * Antes daqui a escolha era do banco: as Instances vivas da Organization
 * ordenadas por `last_connection_at`, e a primeira levava. Determinístico, mas
 * sem nenhuma relação com o Lead — ele escrevia para um número e recebia a
 * automação de outro, e a escolha mudava sozinha quando outro número
 * reconectava. A regra agora vive em `_shared/instance-routing.ts` e é a mesma
 * para os onze pontos de envio do Workflow.
 *
 * Toda falha é **não-retentável**: sem número resolvido, tentar de novo em 30s
 * não muda nada, e contra uma sessão morta o Uazapi responde 5xx a cada
 * `/send/text` — três retentativas viram a tempestade documentada no M1.
 */
export async function getWhatsAppInstance(
  supabase: SupabaseClient,
  organizationId: string,
  node: RoutingNodeConfig | undefined,
  leadId?: string | null,
  /**
   * O universo de provedores que ESTE nó aceita. Omitido = todos os que o
   * roteamento alcança, chips e canal oficial (issue #1700). Só
   * `send_to_number` estreita, e o porquê está lá.
   */
  providers?: readonly string[],
): Promise<InstanceResolution> {
  const resolved = await resolveRoutedInstance(supabase, {
    organizationId,
    leadId: leadId ?? null,
    node: node ?? {},
    providers,
  });

  if (!resolved.ok) {
    return {
      ok: false,
      failure: { success: false, error: resolved.message, retryable: false },
    };
  }

  return {
    ok: true,
    instanceId: resolved.instance.id,
    instanceName: resolved.instance.instance_name,
    instance: resolved.instance,
  };
}

// ─── Lead phone resolution ─────────────────────────────────────────────────

export async function getLeadPhone(supabase: SupabaseClient, leadId: string): Promise<string | null> {
  const { data } = await supabase.from("leads").select("phone").eq("id", leadId).maybeSingle();
  if (!data?.phone) return null;
  let phone = String(data.phone).replace(/\D/g, "");
  if (!phone.startsWith("55")) phone = "55" + phone;
  return phone;
}

// ─── Recipient reachability (WhatsApp existence pre-flight) ─────────────────

/**
 * Verify a recipient number is on WhatsApp BEFORE an automated outbound send.
 *
 * Why: automation first-contact (e.g. Meta Ads lead-form leads) often carries
 * mistyped / non-WhatsApp Brazilian mobiles. Uazapi answers /send/text with an
 * opaque HTTP 500 for those, which the workflow executor then retries 3× over
 * ~8 min before terminal-failing — a noisy "outage"-looking failure for what is
 * really bad recipient data. A cheap /chat/check up front turns that into a
 * clean, immediate, non-retryable skip.
 *
 * Safety contract (never drop a deliverable message):
 *  - Numbers we have ANY prior WhatsApp history with are assumed valid (skip the
 *    check entirely — fast path for established conversations).
 *  - Providers without a check capability (Evolution / Meta Cloud) are never
 *    gated.
 *  - ANY failure of the check itself (instance disconnected 500, RPC/network
 *    error) is treated as UNKNOWN → reachable, so the send still proceeds.
 *  - Only an explicit `isInWhatsapp === false` gates the send.
 */
export async function assertRecipientReachable(
  supabase: SupabaseClient,
  instance: unknown,
  phone: string,
  organizationId?: string,
): Promise<{ reachable: boolean; reason?: string }> {
  try {
    if (await hasPriorWhatsAppHistory(supabase, phone, organizationId)) {
      return { reachable: true };
    }
    const provider = await getWhatsAppProvider(instance as never, supabase);
    // await INSIDE the try so a checkNumbers rejection is caught by the guard.
    return await reachabilityFromProvider(provider, phone);
  } catch {
    // Unknown — never "not reachable". Fall through to the send.
    return { reachable: true };
  }
}

/**
 * Same as {@link assertRecipientReachable} but for callers that already hold a
 * resolved provider (outbound-sender, followup-sender) — avoids a redundant
 * provider/credential resolution.
 */
export async function assertRecipientReachableWithProvider(
  supabase: SupabaseClient,
  provider: { checkNumbers?: (n: string[]) => Promise<Array<{ number: string; isInWhatsapp: boolean }>> },
  phone: string,
  organizationId?: string,
): Promise<{ reachable: boolean; reason?: string }> {
  try {
    if (await hasPriorWhatsAppHistory(supabase, phone, organizationId)) {
      return { reachable: true };
    }
    return await reachabilityFromProvider(provider, phone);
  } catch {
    return { reachable: true };
  }
}

/** Fast path: a number we've already exchanged messages with is known-valid. */
async function hasPriorWhatsAppHistory(
  supabase: SupabaseClient,
  phone: string,
  organizationId?: string,
): Promise<boolean> {
  let query = supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("phone_number", phone);
  // Org-scope the lookup for index selectivity + defense-in-depth (RLS already
  // isolates, but the explicit filter keeps the query tenant-pinned).
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data } = await query.limit(1).maybeSingle();
  return Boolean(data);
}

function reachabilityFromProvider(
  provider: { checkNumbers?: (n: string[]) => Promise<Array<{ number: string; isInWhatsapp: boolean }>> },
  phone: string,
): { reachable: boolean; reason?: string } | Promise<{ reachable: boolean; reason?: string }> {
  if (!provider?.checkNumbers) return { reachable: true };
  const digits = (s: string) => String(s).replace(/\D/g, "");
  return provider.checkNumbers([phone]).then((results) => {
    const verdict =
      results.find((r) => digits(r.number) === digits(phone)) ?? results[0];
    if (verdict && verdict.isInWhatsapp === false) {
      return { reachable: false, reason: "Recipient number is not on WhatsApp" };
    }
    return { reachable: true };
  });
}

/**
 * Thin wrapper for action handlers: returns a terminal (non-retryable) failure
 * ActionResult when the recipient is provably not on WhatsApp, or null to let
 * the send proceed.
 */
export async function recipientGate(
  supabase: SupabaseClient,
  instance: unknown,
  phone: string,
  organizationId?: string,
): Promise<ActionResult | null> {
  const verdict = await assertRecipientReachable(supabase, instance, phone, organizationId);
  if (verdict.reachable) return null;
  return {
    success: false,
    error: verdict.reason ?? "Recipient is not on WhatsApp",
    retryable: false,
  };
}

// ─── Send-failure classification (duplicate-safety) ────────────────────────

/**
 * Decide whether a failed WhatsApp send is safe to retry.
 *
 * A WhatsApp send is NOT idempotent: Uazapi answers `/send/*` with HTTP 500 or a
 * 15s timeout for some sends that were in fact delivered. Retrying those
 * ambiguous failures re-delivers the message — the SC Beauty "4× Bom dia"
 * incident (2026-07-07). So we only allow a retry when we can be SURE the
 * message never left: the breaker blocked it, no instance was resolved, or a
 * rate/credential guard tripped BEFORE the provider call. Anything else (5xx,
 * timeout, network) is ambiguous and treated as terminal to guarantee
 * at-most-once delivery.
 */
export function isRetryableSendFailure(error: string | undefined | null): boolean {
  const e = (error ?? "").toLowerCase();
  if (!e) return false;
  // Provably NOT delivered — send was blocked before reaching WhatsApp.
  if (e.includes("circuit breaker open")) return true;
  if (e.includes("instance not available") || e.includes("no_instance") ||
      e.includes("no whatsapp instance")) return true;
  if (e.includes("rate limit") || e.includes("rate_limited")) return true;
  if (e.includes("provider error") || e.includes("token is required")) return true;
  // Ambiguous (5xx / timeout / network): the message may already be delivered.
  // Retrying would duplicate it — fail terminally instead.
  return false;
}

// ─── Rate limit enforcement ────────────────────────────────────────────────

export async function enforceWhatsAppRateLimit(
  supabase: SupabaseClient,
  instanceId: string,
): Promise<void> {
  const MIN_INTERVAL_MS = 3000;
  const { data: lastMsg } = await supabase
    .from("whatsapp_messages")
    .select("timestamp")
    .eq("instance_id", instanceId)
    .eq("direction", "outgoing")
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastMsg?.timestamp) {
    const elapsed = Date.now() - new Date(lastMsg.timestamp).getTime();
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - elapsed));
    }
  }
}

// ─── Persistência da mensagem de saída ─────────────────────────────────────

/**
 * O provedor já grava sozinho a linha da mensagem que acabou de enviar?
 *
 * O canal oficial grava: `NotificameProvider.persist()` escreve em
 * `channel_messages` no mesmo instante do envio, porque é de lá que a caixa
 * oficial lê. Os legados não gravam nada — quem envia é que escreve a linha de
 * `whatsapp_messages`, e é o que os handlers fazem.
 *
 * ⚠️ Gravar dos dois lados NÃO é redundância inofensiva. A linha de
 * `whatsapp_messages` nasce com `remote_jid` no formato da Uazapi, à espera de
 * um eco `fromMe` que nunca vem, e nunca recebe o `status_event` que o callback
 * do canal oficial escreve em `channel_messages`. Ela fica órfã: a conversa
 * mostra a mensagem duas vezes, e a cópia órfã mente sobre o status para sempre.
 *
 * O nó de template já tomava essa decisão à mão (`send-whatsapp-rich.ts`).
 * Aqui ela vira regra nomeada, porque a partir do #1690 QUALQUER nó pode nomear
 * o canal oficial e cair neste mesmo caminho.
 */
export function providerPersistsOwnMessages(
  provider: string | null | undefined,
): boolean {
  return provider === "notificame";
}

/** Uma mensagem que a automação ACABOU de entregar, pronta para virar linha. */
export type OutboundMessage = {
  organizationId: string;
  instanceId: string;
  /**
   * Provedor da Instance que enviou. Obrigatório de propósito: é o que decide
   * se esta linha deve existir, e um campo opcional deixaria um ponto de envio
   * novo duplicar em silêncio. `deno check _shared/` cobre os sete pontos.
   */
  provider: string | null | undefined;
  /** O id devolvido pelo provider no `/send`. Ver `persistOutboundMessage`. */
  providerMessageId?: string | null;
  /** Telefone do destinatário; normalizado aqui antes de virar `remote_jid`. */
  phone: string;
  /** Como o chat vai renderizar: `image`, `video`, `conversation`, `poll`, … */
  messageType: string;
  content?: string | null;
  /** Omitido (não `null`) quando a mensagem não carrega mídia. */
  mediaUrl?: string | null;
  leadId?: string | null;
  /** Prefixo do id sintético de último recurso. Default `wf`. */
  fallbackIdPrefix?: string;
  /**
   * Rótulo de origem da linha. Default `workflow` — o valor de quem chamava isto
   * antes de existir o parâmetro, então omitir preserva o comportamento.
   *
   * O universo é fechado pelo CHECK do banco: `manual | copilot | workflow`.
   * `manual` está deliberadamente FORA do tipo. Gravar `manual` aqui seria pedir
   * ao gatilho que pausasse o Copilot — o oposto do que esta função existe para
   * fazer —, e nenhum chamador desta função é humano: todos são automação que
   * acabou de entregar uma mensagem.
   */
  sentSource?: "workflow" | "copilot";
};

/**
 * Grava em `whatsapp_messages` a mensagem que a automação acabou de enviar.
 *
 * **O `message_id` tem de ser o do provider.** É essa a peça central, não um
 * detalhe de higiene: quando o eco `fromMe` volta pelo webhook, ele entra com
 * `onConflict: "message_id,instance_id"` e `ignoreDuplicates: true`. Com o id
 * real, o eco colide com esta linha, vira DO NOTHING, e o que escrevemos aqui
 * sobrevive inteiro — inclusive o `sent_source` (`workflow` ou `copilot`, nunca
 * `manual`), que é o que impede o `trg_human_pause_on_manual_send` de pausar o
 * Copilot do lead a cada mensagem disparada por automação. Com um id sintético
 * não há colisão: o eco insere uma SEGUNDA linha, com `sent_source` no default
 * `manual`, e o gatilho dispara.
 *
 * `ignoreDuplicates: false` (merge), e não `true`: o eco pode chegar ANTES do
 * retorno do `/send`. Se este upsert virasse no-op nesse caso, a linha ficaria
 * rotulada `manual` / `sent_by_ai=false` para sempre. Com merge, quem enviou
 * corrige o rótulo de quem enviou.
 *
 * ⚠️ DÍVIDA CONHECIDA — o merge conserta o RÓTULO, não a PAUSA
 * ---------------------------------------------------------
 * A corrida com o eco não é só cosmética, e o limite tem de ficar declarado com
 * precisão:
 *
 *  - A colisão por `message_id` real mata a DUPLICATA **sempre** — chegue o eco
 *    antes ou depois, existe uma linha só.
 *  - Ela só evita a PAUSA DO COPILOT quando a NOSSA escrita chega primeiro.
 *
 * Por quê: `trg_human_pause_on_manual_send` é AFTER **INSERT** FOR EACH ROW (não
 * UPDATE) e só PAUSA quando as três batem — `direction = 'outgoing'` AND
 * `COALESCE(sent_source,'manual') = 'manual'` AND
 * `COALESCE(sent_by_ai,false) = false`. Se o eco insere primeiro,
 * ele entra com `sent_source` no default `manual` e `sent_by_ai=false`: o
 * gatilho dispara e grava `human_paused_until` em `phone_ai_preferences` e em
 * `conversations`. Nosso upsert chega depois como UPDATE — não refaz o INSERT,
 * logo não refaz o gatilho, e o efeito colateral já commitado NÃO é desfeito.
 * O Copilot daquele lead fica pausado por causa de uma mídia que a automação
 * enviou.
 *
 * Não é hipótese: já foi medido eco chegando **1,5 s antes** do retorno do
 * `/send`.
 *
 * A correção real é no gate do gatilho (distinguir eco de envio humano), muda
 * comportamento do Copilot e é decisão do CTO — fora deste módulo. Registrado
 * aqui para que ninguém leia o merge como se resolvesse a corrida inteira.
 *
 * Falha de escrita nunca derruba a action: a mensagem já está no WhatsApp do
 * cliente, e devolver erro aqui só provocaria retentativa — ou seja, mensagem
 * duplicada para o lead por causa de um problema nosso de banco.
 */
export async function persistOutboundMessage(
  supabase: SupabaseClient,
  msg: OutboundMessage,
): Promise<void> {
  // Ver `providerPersistsOwnMessages`: gravar aqui duplicaria a mensagem.
  if (providerPersistsOwnMessages(msg.provider)) return;

  // `remote_jid` alimenta as ações de mensagem da UI (reagir, editar, apagar),
  // que devolvem esse número ao Uazapi — um jid sem o 55 produz ação que falha.
  // (`normalized_phone` é preenchida por gatilho; isto aqui é só sobre o jid.)
  // Normalização que falha não pode custar a mensagem: fica o valor original.
  let phone = msg.phone;
  try {
    phone = normalizeBrazilianPhone(msg.phone) ?? msg.phone;
  } catch {
    phone = msg.phone;
  }

  // Provider sem id de volta é raro (medido: 1 em 3427 envios de workflow em 3
  // dias). Nesse caso grava-se assim mesmo, com id sintético: o eco vai criar
  // uma duplicata, mas duplicata rara é preferível a mensagem que ninguém vê.
  const messageId =
    msg.providerMessageId || `${msg.fallbackIdPrefix ?? "wf"}_${crypto.randomUUID()}`;

  const row: Record<string, unknown> = {
    organization_id: msg.organizationId,
    instance_id: msg.instanceId,
    message_id: messageId,
    remote_jid: `${phone}@s.whatsapp.net`,
    phone_number: phone,
    direction: "outgoing",
    message_type: msg.messageType,
    content: msg.content ?? null,
    timestamp: new Date().toISOString(),
    status: "sent",
    sent_by_ai: true,
    sent_source: msg.sentSource ?? "workflow",
  };
  // Coluna ausente do payload fica de fora do UPDATE do upsert. Omitir preserva
  // o que o eco já tiver gravado ali, em vez de sobrescrever com null.
  if (msg.mediaUrl !== undefined && msg.mediaUrl !== null) row.media_url = msg.mediaUrl;
  if (msg.leadId) row.lead_id = msg.leadId;

  try {
    const { error } = await supabase
      .from("whatsapp_messages")
      .upsert(row, { onConflict: "message_id,instance_id", ignoreDuplicates: false });
    if (error) {
      // `error.message` do PostgREST fica FORA do log de propósito: a linha que
      // falhou carrega `phone_number`, `remote_jid` e o `content` da mensagem
      // para o lead, e violação de constraint no Postgres costuma ecoar os
      // valores da chave no detalhe do erro. `error.code` identifica a classe da
      // falha (23505, 23503, 42501, …) sem carregar PII; o resto do contexto é
      // só id e tipo, o bastante para achar a linha por conta própria.
      console.error(
        "[whatsapp-helpers] persistOutboundMessage failed:",
        JSON.stringify({
          code: error.code ?? "unknown",
          organization_id: msg.organizationId,
          instance_id: msg.instanceId,
          message_type: msg.messageType,
        }),
      );
    }
  } catch (err) {
    // Caminho de transporte (fetch abortado, DNS, TLS), não resposta do
    // PostgREST: aqui a mensagem descreve a falha de rede e não ecoa a linha.
    // Ainda assim, só `name`/`message` — nunca o payload.
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[whatsapp-helpers] persistOutboundMessage threw:", detail);
  }
}

// ─── Track ID builder ──────────────────────────────────────────────────────

export function buildTrackId(params: Record<string, unknown>): string {
  const executionId = params._executionId as string | undefined;
  const nodeId = params._nodeId as string | undefined;
  return `wf-${executionId || "unknown"}-${nodeId || "action"}`;
}

// ─── Variable substitution ─────────────────────────────────────────────────

export async function resolveVariables(
  supabase: SupabaseClient,
  leadId: string,
  template: string,
  executionContext?: Record<string, unknown>,
): Promise<string> {
  if (!template || !template.includes("{{")) return template;

  // First pass: resolve execution context variables
  if (executionContext) {
    for (const [key, val] of Object.entries(executionContext)) {
      if (val !== null && val !== undefined && typeof val !== "object") {
        template = template.replaceAll(`{{${key}}}`, String(val));
      }
    }
    if (!template.includes("{{")) return template;
  }

  const { data: lead } = await supabase
    .from("leads")
    // Uma única string literal, não concatenação: `"a, " + "b"` tem tipo `string`
    // em TypeScript (o compilador não junta literais com `+`), e o parser de
    // tipos do postgrest-js só sabe ler um literal. Com `string` ele devolve
    // `ParserError`, a linha vira `GenericStringError` e TODO acesso a coluna
    // aqui embaixo virava um TS2339. O texto enviado ao servidor é idêntico.
    .select("name, company, email, phone, qualification_score, rating, sdr_id, closer_id, responsible_id, organization_id, faturamento, segment, urgency, notes, origin")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return template;

  // ADR-0023 §10: `{estagio}` é a etapa do NEGÓCIO, não a coluna espelho do lead.
  // `leads.pipe_whatsapp` não pode ser lida aqui a partir do L2: quando o negócio
  // sai de Oportunidades por MOVE, o gatilho resolve o slug por `NEW.pipeline_id`
  // e não escreve — a coluna CONGELA na última etapa de whatsapp. A mensagem sairia
  // com uma etapa que o negócio não ocupa mais, e ninguém veria campo vazio para
  // desconfiar.
  // Desde a fatia 3 do sujeito da automação: a etapa é a do negócio QUE
  // DISPAROU, lida do `context`. O funil `whatsapp` era chumbado — ver
  // `getStageDoNegocio`.
  const estagioDoNegocio = await getStageDoNegocio(
    supabase, leadId, lead.organization_id as string, entryIdDoContexto(executionContext),
  );

  let result = template;

  const vars: Record<string, string> = {
    nome:       personalizationName(lead.name),
    primeiro_nome: personalizationFirstName(lead.name),
    empresa:    lead.company || "",
    email:      lead.email || "",
    telefone:   lead.phone || "",
    estagio:    estagioDoNegocio,
    score:      String(lead.qualification_score ?? ""),
    rating:     String(lead.rating ?? ""),
    faturamento: String(lead.faturamento ?? ""),
    segmento:   lead.segment || "",
    urgencia:   lead.urgency || "",
    observacoes: lead.notes || "",
    origem:     lead.origin || "",
  };

  if (template.includes("{{saudacao}}") || template.includes("{{data_hoje}}") || template.includes("{{hora_atual}}")) {
    const timeVars = getTimeBasedVariables();
    vars.saudacao = timeVars.saudacao;
    vars.data_hoje = timeVars.data;
    vars.hora_atual = timeVars.hora;
  }

  if (template.includes("{{sdr}}") && lead.sdr_id) {
    const { data: member } = await supabase
      .from("team_members")
      .select("name")
      .eq("id", lead.sdr_id)
      .maybeSingle();
    vars.sdr = member?.name || "";
  }

  if (template.includes("{{closer}}") && lead.closer_id) {
    const { data: member } = await supabase
      .from("team_members")
      .select("name")
      .eq("id", lead.closer_id)
      .maybeSingle();
    vars.closer = member?.name || "";
  }

  if (
    (template.includes("{{responsavel}}") ||
      template.includes("{{responsavel_telefone}}")) &&
    lead.responsible_id
  ) {
    const { data: member } = await supabase
      .from("team_members")
      .select("name, phone")
      .eq("id", lead.responsible_id)
      .maybeSingle();
    vars.responsavel = (member as { name?: string; phone?: string })?.name || "";
    vars.responsavel_telefone = (member as { name?: string; phone?: string })?.phone || "";
  }

  if (template.includes("{{nome_empresa_crm}}") && lead.organization_id) {
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", lead.organization_id)
      .maybeSingle();
    vars.nome_empresa_crm = org?.name || "";
  }

  if (template.includes("{{data_reuniao}}")) {
    const confEntry = await getPipeEntry(supabase, leadId, lead.organization_id, "confirmacao");
    const rawDate = (confEntry?.metadata as Record<string, unknown>)?.meeting_date as string | undefined;
    vars.data_reuniao = rawDate
      ? new Date(rawDate).toLocaleDateString("pt-BR")
      : "";
  }

  if (template.includes("{{valor_proposta}}")) {
    const propEntry = await getPipeEntry(supabase, leadId, lead.organization_id, "propostas");
    const saleValue = (propEntry?.metadata as Record<string, unknown>)?.sale_value as number | undefined;
    vars.valor_proposta = saleValue != null
      ? new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(saleValue)
      : "";
  }

  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, val);
  }

  // Campaign variables
  if (template.includes("{{campanha_nome}}") || template.includes("{{campanha_estagio}}")) {
    const { data: campLead } = await supabase
      .from("campanha_leads")
      .select("campanha_id, stage_id, campanhas(name), campanha_stages(name)")
      .eq("lead_id", leadId)
      .limit(1)
      .maybeSingle();
    if (campLead) {
      vars.campanha_nome = (campLead as any).campanhas?.name || "";
      vars.campanha_estagio = (campLead as any).campanha_stages?.name || "";
    }
  }

  // AI variables
  if (template.includes("{{ai_")) {
    const { data: aiSummary } = await supabase
      .from("conversation_summaries")
      .select("summary, sentiment, lead_temperature, next_action")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (aiSummary) {
      vars.ai_resumo = (aiSummary as any).summary || "";
      vars.ai_sentimento = (aiSummary as any).sentiment || "";
      vars.ai_temperatura = (aiSummary as any).lead_temperature || "";
      vars.ai_proxima_acao = (aiSummary as any).next_action || "";
    }
  }

  // Second pass for late-bound vars
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, val);
  }

  // Custom fields: {{custom.campo}}
  const customMatches = result.match(/\{\{custom\.([^}]+)\}\}/g);
  if (customMatches) {
    const orgId = lead.organization_id;
    for (const match of customMatches) {
      const fieldName = match.replace("{{custom.", "").replace("}}", "");
      let val = "";
      if (orgId) {
        const { data: field } = await supabase
          .from("lead_custom_fields")
          .select("id")
          .eq("organization_id", orgId)
          .eq("field_name", fieldName)
          .maybeSingle();
        if (field) {
          const { data: fv } = await supabase
            .from("lead_custom_field_values")
            .select("value")
            .eq("lead_id", leadId)
            .eq("field_id", field.id)
            .maybeSingle();
          val = fv?.value || "";
        }
      }
      result = result.replaceAll(match, val);
    }
  }

  // Tags: {{tag.<name>}} → echoes the tag name if the Lead carries that tag, else "".
  const tagMatches = result.match(/\{\{tag\.([^}]+)\}\}/g);
  if (tagMatches) {
    const { data: leadTags } = await supabase
      .from("lead_tags")
      .select("tags(name)")
      .eq("lead_id", leadId);
    // O parser de tipos do postgrest-js não conhece a cardinalidade do embed:
    // sem o `Database` gerado ele chuta ARRAY para `tags(name)`. A relação é
    // muitos-para-um (`lead_tags.tag_id → tags.id`) e o PostgREST devolve
    // OBJETO — é o que este código sempre leu, e o que os testes deste arquivo
    // encenam. A asserção corrige o palpite do parser; o `unknown` no meio é
    // exigência do compilador, já que os dois formatos não se sobrepõem.
    //
    // Asserção e não `.returns<>()` de propósito: `.returns()` é método DE
    // RUNTIME do builder, e chamá-lo só para ajustar tipo quebrou os três testes
    // de `{{tag.X}}` (os dublês de teste não o implementam). Num módulo que 78
    // funções importam, ajuste de tipo não deveria acrescentar chamada nenhuma.
    const tagRows = (leadTags ?? []) as unknown as Array<{ tags: { name: string | null } | null }>;
    const tagNames = new Set(
      tagRows
        .map((lt) => lt.tags?.name)
        .filter((n): n is string => Boolean(n)),
    );
    for (const match of tagMatches) {
      const tagName = match.replace("{{tag.", "").replace("}}", "");
      result = result.replaceAll(match, tagNames.has(tagName) ? tagName : "");
    }
  }

  // A suppressed placeholder name (see personalizationName) leaves a punctuation
  // gap like "Boa tarde , tudo bem?" — clean it only when we actually blanked one.
  if (isPlaceholderLeadName(lead.name)) result = tidyEmptyVarGaps(result);

  return result;
}
