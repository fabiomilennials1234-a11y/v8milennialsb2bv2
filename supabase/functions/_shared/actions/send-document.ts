/**
 * AI Action handler — envio de documento ao lead via WhatsApp.
 *
 *  - Busca o doc em copilot_agent_documents
 *  - Gera URL assinada (1h)
 *  - Resolve provider/instância via whatsapp-dispatch.resolveDispatchContext
 *  - Despacha sendMedia (image/video/document)
 *  - Registra mensagem outgoing em whatsapp_messages
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ActionResult } from "./types.ts";
import { resolveDispatchContext, DispatchResolutionError } from "../whatsapp-dispatch.ts";
import { isCopilotCanceled, logCopilotCancellation } from "../copilot/cancellation.ts";
import { logEvent } from "../error-boundary.ts";
import {
  DELIVERED_AT_KEY,
  isDeliveredSend,
  SUPPRESSED_AT_KEY,
  SUPPRESSED_REASON_KEY,
} from "../copilot/document-delivery.ts";

/**
 * Carimba o desfecho REAL do envio no payload da própria ação.
 *
 * `process-ai-actions` grava `status='completed'` sempre que `result.success`
 * é true — e a supressão devolve `success: true`. Sem este carimbo, entregue e
 * suprimido ficam indistinguíveis no banco, o gate de dedup passa a se
 * alimentar das próprias supressões, e a seção "Documentos já enviados" do
 * prompt manda o modelo AFIRMAR ao lead um envio que nunca aconteceu.
 *
 * Fire-and-forget de propósito: falha em carimbar não pode derrubar um envio
 * que já saiu no WhatsApp do lead.
 */
async function stampActionOutcome(
  supabase: SupabaseClient,
  actionId: string | null,
  basePayload: Record<string, unknown>,
  outcome: Record<string, unknown>,
): Promise<void> {
  if (!actionId) return;
  try {
    const { error } = await supabase
      .from("pending_ai_actions")
      .update({ payload: { ...basePayload, ...outcome } })
      .eq("id", actionId);
    if (error) {
      console.warn("[executeSendDocument] Failed to stamp action outcome:", error.message);
    }
  } catch (e) {
    console.warn("[executeSendDocument] Failed to stamp action outcome:", e);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `%`, `_` e `\` são curingas no ILIKE — escapar antes de interpolar. */
function escapeIlikeLiteral(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

/**
 * Resolve um `document_id` que veio como NOME de arquivo em vez de UUID.
 *
 * O modelo escolhe o arquivo pelo nome na descrição da tool e, sob pressão,
 * devolve esse nome no campo do id. Sem esta resolução o envio falha em
 * silêncio: `.eq("id", "Thermo Selagem - PRODUTO 1.jpg")` não casa nada, a ação
 * vira "Document not found" e a bolha de texto já afirmou "te mandei a foto".
 *
 * Escopado por `organization_id` (fronteira de tenant). Documentos de agentes
 * diferentes da MESMA org podem repetir `file_name` — e nesse caso apontam para
 * o mesmo `file_path`, então o arquivo entregue é o mesmo. Match exato
 * case-insensitive primeiro, depois parcial.
 */
export async function resolveDocumentIdByName(
  supabase: SupabaseClient,
  organizationId: string,
  raw: string,
): Promise<string | null> {
  const name = (raw ?? "").trim();
  if (!name || name.length > 300) return null;

  const exact = await supabase
    .from("copilot_agent_documents")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "ready")
    .ilike("file_name", escapeIlikeLiteral(name))
    .limit(1);
  if (exact.data?.[0]?.id) return exact.data[0].id as string;

  const partial = await supabase
    .from("copilot_agent_documents")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "ready")
    .ilike("file_name", `%${escapeIlikeLiteral(name)}%`)
    .limit(1);
  return (partial.data?.[0]?.id as string) ?? null;
}

/**
 * Resgata um UUID **bem formado mas inexistente** — o modelo trocou um dígito.
 *
 * `resolveDocumentIdByName` acima só entra quando o campo NÃO parece um UUID.
 * Quando o modelo copia o id da descrição da tool e erra um caractere, o valor
 * passa no `UUID_RE`, o `.eq("id", …)` não casa nada e a ação morre em
 * "Document not found" — depois de 3 retries, porque o erro é determinístico e
 * nenhum retry vai consertar um dígito. Medido na Forever Bella em 02/09: o
 * modelo pediu `c3213b6b-3e3a-…` duas vezes; o arquivo real é `c3213b6b-3f3a-…`
 * (`Banho de Verniz - PRODUTO 1.png`). Duas ações mortas, duas fotos que o lead
 * pediu e nunca viu.
 *
 * Critério deliberadamente estreito: **um único** documento da org a exatamente
 * **um** caractere de distância. Com dois candidatos a distância 1 não há como
 * saber qual o modelo quis, e mandar o arquivo errado para o cliente é pior que
 * não mandar — nesse caso devolve null e o erro segue.
 */
export async function resolveDocumentIdByNearMiss(
  supabase: SupabaseClient,
  organizationId: string,
  raw: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("copilot_agent_documents")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "ready");
  if (!data?.length) return null;

  const target = raw.toLowerCase();
  const near = data
    .map((row) => String(row.id))
    .filter((id) => {
      if (id.length !== target.length) return false;
      let diff = 0;
      for (let i = 0; i < id.length; i++) {
        if (id[i] !== target[i] && ++diff > 1) return false;
      }
      return diff === 1;
    });

  return near.length === 1 ? near[0] : null;
}

/**
 * Checks if a document was already sent in a conversation.
 * Used as hard dedup gate before dispatching the actual send.
 *
 * Two layers:
 *   1. pending_ai_actions — primary gate scoped per conversation+document.
 *   2. whatsapp_messages fallback — only when filePath provided. Catches the
 *      edge case where the pending_ai_action row was lost (manual delete,
 *      schema migration) but the media was already delivered. Matches the
 *      exact media via media_url ILIKE on the storage path basename.
 *
 * Earlier revisions had a fallback that blocked on "any outgoing AI message
 * within 1h" — that fired on every text reply and silently skipped every
 * legitimate video. The match must be on the document itself, not on
 * unrelated chatter.
 */
export async function checkDocumentAlreadySent(
  supabase: SupabaseClient,
  conversationId: string,
  documentId: string,
  leadId?: string | null,
  filePath?: string | null,
  currentActionId?: string | null,
): Promise<boolean> {
  // Exclude the current action's own row from the dedup query. `claim_pending_ai_actions`
  // sets status='processing' before the executor runs, so without this guard the gate
  // would always match itself and silently skip every legitimate send.
  let query = supabase
    .from("pending_ai_actions")
    .select("id, payload")
    .eq("conversation_id", conversationId)
    .eq("action_type", "send_document")
    .in("status", ["completed", "processing"]);

  if (currentActionId) {
    query = query.neq("id", currentActionId);
  }

  const { data } = await query;

  if (data && data.length > 0) {
    // Só conta como duplicata a ação que REALMENTE entregou. Antes daqui,
    // uma supressão gravava `completed` e virava a prova que suprimia a
    // próxima — o gate se auto-alimentava e a conversa nunca mais recebia
    // aquele arquivo. Ver _shared/copilot/document-delivery.ts.
    const isDuplicate = data.some(
      (row: any) =>
        (row.payload as Record<string, unknown>)?.document_id === documentId &&
        isDeliveredSend(row.payload as Record<string, unknown>),
    );

    if (isDuplicate) {
      logEvent("copilot_duplicate_document_blocked", {
        tags: {
          "copilot.document_id": documentId,
          "copilot.conversation_id": conversationId,
        },
      }).catch(() => {});
      return true;
    }
  }

  if (!leadId || !filePath) return false;

  const { data: lead } = await supabase
    .from("leads")
    .select("phone")
    .eq("id", leadId)
    .single();

  if (!lead?.phone) return false;

  const basename = filePath.split("/").pop();
  if (!basename) return false;

  // The stored media_url is a Supabase signed URL whose object path is
  // URL-encoded (spaces → %20, accents → %XX). The raw basename has literal
  // spaces, so a `%${basename}%` ILIKE never matches an encoded URL and the
  // fallback silently let every re-send through (2026-06-02 incident: same
  // video delivered 3×). Match against the encoded form actually present in
  // the URL.
  const encodedBasename = encodeURIComponent(basename);

  const { data: sentMessages } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("phone_number", lead.phone)
    .eq("direction", "outgoing")
    .eq("sent_by_ai", true)
    .in("message_type", ["document", "image", "video", "audio"])
    .ilike("media_url", `%${encodedBasename}%`)
    .gte("timestamp", new Date(Date.now() - 3600_000).toISOString())
    .limit(1);

  if (sentMessages && sentMessages.length > 0) {
    logEvent("copilot_duplicate_document_blocked_whatsapp_fallback", {
      tags: {
        "copilot.document_id": documentId,
        "copilot.conversation_id": conversationId,
        "copilot.lead_id": leadId,
      },
    }).catch(() => {});
    return true;
  }

  return false;
}

// ─── Atomic send lock (idempotência de entrega) ────────────────────────────
//
// O gate checkDocumentAlreadySent acima é uma checagem read-then-act: não é
// race-free. O process-ai-actions mata a ação aos 30s (ACTION_TIMEOUT_MS) mas
// NÃO aborta o provider.sendMedia em voo — o envio completa no provider mesmo
// após o timeout, a ação é marcada failed e o cron re-claim reenvia. Resultado:
// N entregas idênticas (incidente 2026-06-02, vídeo 3×).
//
// Este lock atômico (INSERT ON CONFLICT DO NOTHING via RPC) garante AT-MOST-ONCE
// por AÇÃO: a 1ª tentativa reserva e envia; retries/órfãos DA MESMA AÇÃO colidem
// no lock e viram no-op. Liberado apenas em falha REAL de envio, para não travar
// um retry legítimo.
//
// 🚨 2026-09-03: o escopo passou de (conversa, documento) para (conversa,
// documento, AÇÃO). O que o incidente de 2026-06-02 exige é que a MESMA linha
// re-clamada pelo cron não entregue duas vezes — e o re-claim reusa o mesmo
// `actionId`, então a proteção fica intacta. Ancorar em (conversa, documento)
// fazia o lock valer por 24h para QUALQUER pedido futuro: o lead pedia a foto de
// novo, o modelo chamava a tool de novo, nascia uma ação NOVA — e ela morria
// contra o lock de uma entrega de horas antes. Pedido novo do lead = ação nova =
// lock novo. Duplicata dentro do MESMO turno não chega aqui: `buildIdempotencyKey`
// já a barra no enfileiramento, com o `document_id` na chave.
const SEND_DOCUMENT_LOCK_TTL_SECONDS = 24 * 60 * 60; // 24h — cobre o ciclo de retry inteiro da ação

function buildSendDocumentLockKey(
  conversationId: string | null,
  leadId: string,
  documentId: string,
  actionId: string | null,
): string {
  const scope = conversationId ? `conv:${conversationId}` : `lead:${leadId}`;
  // Sem actionId (chamada fora do worker) o lock recai no escopo antigo — é o
  // caminho sem re-claim, então não há retry automático de que se defender.
  const attempt = actionId ? `:action:${actionId}` : "";
  return `send_document:${scope}:${documentId}${attempt}`;
}

async function acquireSendDocumentLock(
  supabase: SupabaseClient,
  organizationId: string,
  lockKey: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("copilot_v2_acquire_dedup_lock", {
    p_dedup_key: lockKey,
    p_org_id: organizationId,
    p_window_seconds: SEND_DOCUMENT_LOCK_TTL_SECONDS,
  });
  if (error) {
    // Fail-open: erro transitório no lock não pode bloquear envio legítimo.
    // O custo de uma mídia repetida é menor que o de uma mídia que nunca chega.
    console.warn("[executeSendDocument] dedup lock acquire failed:", error.message);
    return true;
  }
  return data === true;
}

async function releaseSendDocumentLock(
  supabase: SupabaseClient,
  lockKey: string,
): Promise<void> {
  const { error } = await supabase
    .from("copilot_v2_dedup_locks")
    .delete()
    .eq("dedup_key", lockKey);
  if (error) console.warn("[executeSendDocument] dedup lock release failed:", error.message);
}

export async function executeSendDocument(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  organizationId: string,
  leadId: string | null,
  conversationId: string | null = null,
  actionId: string | null = null,
): Promise<ActionResult> {
  let documentId = payload.document_id as string;
  const caption = payload.caption as string | undefined;

  if (!documentId) {
    return { success: false, error: "document_id is required" };
  }

  if (!leadId) {
    return { success: false, error: "lead_id is required to send document" };
  }

  // 1. Buscar documento e metadados (antes do gate — fallback whatsapp_messages
  //    precisa do file_path pra fazer match preciso via media_url ILIKE).
  //
  //    O modelo às vezes manda o NOME do arquivo ("Thermo Selagem - PRODUTO 1.jpg")
  //    no lugar do UUID listado na tool. Antes disso o envio morria aqui em
  //    silêncio: a bolha de texto afirma "te mandei a foto" e nada sai, sem erro
  //    visível pra ninguém. Medido em 2026-08-25 na org Forever Bella: 6 de 511
  //    envios traziam file_name ou UUID inexistente. `resolveDocumentReference`
  //    faz o mesmo que `decide-action.ts#resolveRecoveredMedia` já fazia para o
  //    caminho do sanitizer — aqui cobre a tool-call direta.
  const resolvedId = UUID_RE.test(documentId)
    ? documentId
    : await resolveDocumentIdByName(supabase, organizationId, documentId);

  if (!resolvedId) {
    return { success: false, error: `Document not found: no document matches "${documentId}"` };
  }
  if (resolvedId !== documentId) {
    logEvent("copilot_document_id_resolved_by_name", {
      tags: {
        "copilot.document_raw": documentId.slice(0, 120),
        "copilot.document_id": resolvedId,
        "copilot.organization_id": organizationId,
      },
    }).catch(() => {});
    // A partir daqui o id canônico é o resolvido: dedup, lock e payload usam ele.
    documentId = resolvedId;
  }

  const fetchDoc = (id: string) =>
    supabase
      .from("copilot_agent_documents")
      .select("id, file_name, file_path, mime_type, organization_id, file_type")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();

  let { data: doc, error: docError } = await fetchDoc(documentId);

  // UUID bem formado que não existe: o modelo errou um dígito ao copiar o id.
  // Retry não conserta — ou resgatamos aqui, ou a foto pedida nunca sai.
  if (!doc && UUID_RE.test(documentId)) {
    const rescuedId = await resolveDocumentIdByNearMiss(supabase, organizationId, documentId);
    if (rescuedId) {
      logEvent("copilot_document_id_rescued_near_miss", {
        tags: {
          "copilot.document_raw": documentId,
          "copilot.document_id": rescuedId,
          "copilot.organization_id": organizationId,
        },
      }).catch(() => {});
      documentId = rescuedId;
      ({ data: doc, error: docError } = await fetchDoc(rescuedId));
    }
  }

  if (docError || !doc) {
    return { success: false, error: `Document not found: ${docError?.message || "not found"}` };
  }

  // 2. Reenvio pedido pelo lead SEMPRE vale — o gate vitalício virou TELEMETRIA.
  //
  // 🚨 2026-09-03, decisão do produto: "se o cliente pediu a imagem, manda a
  // imagem". O gate abaixo bloqueava por (conversa, documento) SEM recorte de
  // tempo: uma vez entregue, aquele arquivo nunca mais saía naquela conversa,
  // nem quando o lead pedia de novo horas depois. Medido na Forever Bella em
  // 02/09: as 3 fotos foram entregues às 17:27–17:29 e, na segunda rodada às
  // 19:29–19:36, as 9 novas tentativas dos MESMOS arquivos foram suprimidas —
  // o lead pediu 4 vezes, o Jefferson anunciou 4 vezes e nada saiu.
  //
  // O que continua protegendo contra entrega dupla é o lock atômico logo antes
  // do despacho (SEND_DOCUMENT_LOCK_WINDOW_SECONDS), que é race-free e cobre a
  // janela real do incidente de 2026-06-02 (worker mata aos 30s sem abortar o
  // `sendMedia` em voo → cron re-claim reenvia). O gate vitalício NUNCA foi essa
  // proteção: é read-then-act, e portanto nunca foi race-free.
  //
  // Mantido como observação para não perder o sinal de laço do modelo.
  if (conversationId) {
    checkDocumentAlreadySent(supabase, conversationId, documentId, leadId, doc.file_path, actionId)
      .then((repeat) => {
        if (!repeat) return;
        logEvent("copilot_document_resent_on_request", {
          tags: {
            "copilot.document_id": documentId,
            "copilot.conversation_id": conversationId,
            "copilot.organization_id": organizationId,
          },
        }).catch(() => {});
      })
      .catch(() => {});
  }

  // 3. Gerar URL assinada (valida por 1 hora)
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from("agent-documents")
    .createSignedUrl(doc.file_path, 3600);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return {
      success: false,
      error: `Failed to generate signed URL: ${signedUrlError?.message || "unknown"}`,
    };
  }

  // 4. Buscar telefone do lead e instância WhatsApp
  const { data: lead } = await supabase
    .from("leads")
    .select("phone")
    .eq("id", leadId)
    .single();

  if (!lead?.phone) {
    return { success: false, error: "Lead has no phone number" };
  }

  // RC-cancel: gate antes de enviar via provider. SEND_DOCUMENT é enfileirado
  // em pending_ai_actions e processado por process-ai-actions (cron 1min).
  // Janela: user pode desligar "IA" entre AgentEngine decidir o envio e o
  // worker pegar a ação — sem este gate, o documento ainda é entregue mesmo
  // depois do toggle off. Fonte canônica: phone_ai_preferences > leads.ai_disabled.
  const cancelCheck = await isCopilotCanceled(supabase, organizationId, lead.phone);
  if (cancelCheck.canceled) {
    logCopilotCancellation({
      organizationId,
      gate: "ai_action_send",
      leadId,
      conversationId: conversationId ?? undefined,
      phone: lead.phone,
      source: cancelCheck.source,
    });
    return {
      success: false,
      error: "Copilot disabled for lead — send_document skipped",
    };
  }

  // Find the correct instance: prefer the one linked to the conversation's agent.
  let preferredInstanceId: string | null = null;

  if (conversationId) {
    const { data: conv } = await supabase
      .from("conversations")
      .select("agent_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (conv?.agent_id) {
      const { data: linkedInst } = await supabase
        .from("whatsapp_instances")
        .select("id, status")
        .eq("copilot_agent_id", conv.agent_id)
        .eq("organization_id", organizationId)
        .in("status", ["open", "connected"])
        .limit(1)
        .maybeSingle();
      if (linkedInst?.id) preferredInstanceId = linkedInst.id;
    }
  }

  let ctx;
  try {
    ctx = await resolveDispatchContext(supabase, {
      organization_id: organizationId,
      phone: lead.phone,
      preferred_instance_id: preferredInstanceId,
      require_connected: true,
      // Etapa B: quando flag user_write_instance_strict ON, força vínculo via
      // responsável; OFF mantém precedência legada acima.
      lead_id: leadId,
    });
  } catch (e) {
    const err = e as InstanceType<typeof DispatchResolutionError>;
    return { success: false, error: err.message };
  }

  const { provider, instance, normalizedPhone: phone } = ctx;

  // Idempotência atômica: reserva o envio (conversa, documento) ANTES de
  // despachar. Retry após timeout / órfão de envio colide aqui e vira no-op.
  const lockKey = buildSendDocumentLockKey(conversationId, leadId, documentId, actionId);
  const lockAcquired = await acquireSendDocumentLock(supabase, organizationId, lockKey);
  if (!lockAcquired) {
    console.debug("[executeSendDocument] Send already in-flight/done (lock held), skipping:", {
      lockKey,
    });
    await stampActionOutcome(supabase, actionId, payload, {
      document_id: documentId,
      [SUPPRESSED_AT_KEY]: new Date().toISOString(),
      [SUPPRESSED_REASON_KEY]: "send_lock_held",
    });
    return {
      success: true,
      message: "Document send already in-flight or completed — skipped",
      data: { skipped: true, reason: "send_lock_held" },
    };
  }

  // Detect media type based on file_type column (image/video/document)
  const fileType = (doc as any).file_type || "document";
  let mediaType: "image" | "video" | "document" = "document";
  let messageType = "document";
  if (fileType === "image" || (doc.mime_type && doc.mime_type.startsWith("image/"))) {
    mediaType = "image";
    messageType = "image";
  } else if (fileType === "video" || (doc.mime_type && doc.mime_type.startsWith("video/"))) {
    mediaType = "video";
    messageType = "video";
  }

  try {
    const sendResult = await provider.sendMedia({
      number: phone,
      type: mediaType,
      file: signedUrlData.signedUrl,
      filename: doc.file_name,
      caption: caption || undefined,
      trackSource: "ai-action-send-document",
      trackId: doc.id,
    });

    // Registrar mensagem de saída
    try {
      const { error: insertErr } = await supabase.from("whatsapp_messages").upsert(
        {
          organization_id: organizationId,
          instance_id: instance.id,
          message_id:
            sendResult.message_id ||
            `doc_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          remote_jid: `${phone}@s.whatsapp.net`,
          phone_number: phone,
          direction: "outgoing",
          message_type: messageType,
          content:
            caption ||
            `[${messageType === "image" ? "Imagem" : messageType === "video" ? "Video" : "Documento"}: ${doc.file_name}]`,
          media_url: signedUrlData.signedUrl,
          status: "sent",
          timestamp: new Date().toISOString(),
          sent_by_ai: true,
          sent_source: "copilot",
        },
        { onConflict: "message_id,instance_id", ignoreDuplicates: false },
      );
      if (insertErr)
        console.warn("[executeSendDocument] Failed to log outgoing message:", insertErr);
    } catch (e) {
      console.warn("[executeSendDocument] Failed to log outgoing message:", e);
    }

    // Carimba a ENTREGA: é este carimbo que autoriza o gate a barrar um
    // reenvio e a seção "Documentos já enviados" a citar o arquivo pelo nome.
    // Grava também o `document_id` canônico — quando o modelo manda o NOME do
    // arquivo, o payload original guarda o nome e o gate nunca casava.
    await stampActionOutcome(supabase, actionId, payload, {
      document_id: documentId,
      file_name: doc.file_name,
      [DELIVERED_AT_KEY]: new Date().toISOString(),
    });

    return {
      success: true,
      message: `Documento "${doc.file_name}" enviado com sucesso`,
      data: { file_name: doc.file_name, message_id: sendResult.message_id },
    };
  } catch (error) {
    // UazapiError é objeto plano (não instância de Error) → String(error) daria
    // "[object Object]" e perderia o motivo real. Extrai message/status/code/raw.
    let detail: string;
    if (error instanceof Error) {
      detail = error.message;
    } else if (error && typeof error === "object") {
      const e = error as Record<string, unknown>;
      const parts: string[] = [];
      if (e.message) parts.push(String(e.message));
      if (e.status) parts.push(`status=${e.status}`);
      if (e.provider_code) parts.push(`code=${e.provider_code}`);
      if (e.raw) parts.push(`raw=${JSON.stringify(e.raw)}`);
      detail = parts.length > 0 ? parts.join(" | ") : JSON.stringify(error);
    } else {
      detail = String(error);
    }
    // Falha REAL de envio → libera o lock para permitir retry legítimo.
    // (Timeout no nível do worker NÃO chega aqui: o provider.sendMedia segue em
    // voo, o lock permanece e bloqueia o reenvio — comportamento desejado.)
    await releaseSendDocumentLock(supabase, lockKey);
    return {
      success: false,
      error: `Failed to send document: ${detail}`,
    };
  }
}
